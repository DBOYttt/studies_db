# Deployment (single home server, Compose + Cloudflare Tunnel)

Nothing is published on the host: the web container only `expose`s 3000 on the compose network and
`cloudflared` connects outward to Cloudflare.

## Prerequisites

Compose provider (not installed by default with podman):

```sh
sudo dnf install podman-compose      # or install docker compose
```

## 1. Configure

```sh
cp .env.prod.example .env
```

Fill in: strong `MARIADB_ROOT_PASSWORD` and `DB_RO_PASSWORD` (keep the passwords inside
`DATABASE_URL` / `DATABASE_RO_URL` in sync), Discord values, `BACKUP_DIR`.
`STORAGE_DIR` is forced to `/data/storage` by compose; it must be absolute in production
(the apps throw at startup otherwise).

## 2. Cloudflare Tunnel

1. Cloudflare Zero Trust dashboard -> Networks -> Tunnels -> Create tunnel (Cloudflared).
2. Copy the token into `.env` as `TUNNEL_TOKEN`.
3. Public hostname: `<hostname>` -> service `http://web:3000`.
4. Set `WEB_BASE_URL=https://<hostname>` in `.env`.

## 3. Run

```sh
podman compose --profile app up -d --build                  # local full stack
podman compose --profile app --profile prod up -d --build   # + cloudflared
podman compose ps   # mariadb healthy, migrate exited 0, bot/worker/web running
```

To check locally, temporarily add `ports: ["3000:3000"]` to `web`, then
`curl -sI localhost:3000/` should redirect to `/login-info`.

Register slash commands once (see apps/bot README) if commands changed.

## Dev DB

`pnpm db:up` (plain `podman run`, container `studies-mariadb`) is unchanged. Do not run it
alongside the compose `mariadb` (same container name). To get the dev port mapping from compose:
`podman compose -f compose.yaml -f compose.dev.yaml up -d mariadb` (127.0.0.1:3307 only).
The production profile never publishes the DB port.

## FULLTEXT note

The DB runs with `--innodb-ft-min-token-size=2`. Changing this on an existing database requires
rebuilding FULLTEXT indexes (`OPTIMIZE TABLE <t>` after the restart, or drop and recreate the index).

## Backups

`scripts/backup.sh` dumps the DB (`mariadb-dump --single-transaction`), rsyncs the storage volume
to `$BACKUP_DIR/storage/`, and deletes dumps older than 14 days. The volume name defaults to
`studies_db_storage` (`<project dir>_storage`); override with `STORAGE_VOLUME`. Nightly at 03:00:

```cron
0 3 * * * /path/to/studies_db/scripts/backup.sh >> /var/log/studies-backup.log 2>&1
```

or a systemd timer with `OnCalendar=*-*-* 03:00:00` running the same script. Rootless podman: run
it as the same user that owns the containers.

## Verification status

The image builds and individual containers were verified with `podman build`/`podman run`; the
full `podman compose` flow was not run on the dev machine (no compose provider), so do the first
`compose up` and the Discord DOCX upload check on the server.
