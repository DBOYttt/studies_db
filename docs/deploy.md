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

Generate secrets with `openssl rand -hex 32`. They must be URL-safe: the passwords are embedded in
`mysql://` URLs and compose interpolation, and characters such as `@ / # ? % : $ \ ; &` or spaces break them.

Fill in: `MARIADB_ROOT_PASSWORD` and `DB_RO_PASSWORD` (keep the passwords inside
`DATABASE_URL` / `DATABASE_RO_URL` in sync), Discord values, `BACKUP_DIR`.
`STORAGE_DIR` is forced to `/data/storage` by compose; it must be absolute in production
(the apps throw at startup otherwise).

Website uploads for events are written by the `web` container (user `node`, uid 1000) to
`$STORAGE_DIR/uploads`. The `storage` volume is created by root, so the one-shot `migrate` service
creates that directory on every `compose up`, owned by uid 1000 with mode 0750 (the bot runs as root and
can read and delete the files). Without it every upload answers 503. If you run the apps outside compose,
create `uploads/` yourself with an owner that matches the web process.

The `worker` service does not load `.env` as a whole: compose passes it only `DATABASE_URL`,
`UNITIME_ICAL_URL` and the optional `UNITIME_EXAM_ICAL_URL` / `WORKER_CONCURRENCY` / `SOFFICE_BIN` / `PDFTOTEXT_BIN` (and forces
`STORAGE_DIR`). It opens files named by DB rows, so it should not hold the Discord token or other secrets.
If you add a worker setting, list it under `worker.environment` in `compose.yaml`.

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

### Upgrading to the class/group hierarchy (migration 0004)

Migration 0004 drops the old `subject_lecturers` table after copying it into classes, so take a
backup first:

1. `scripts/backup.sh`
2. `pnpm db:migrate` (or the `migrate` container on `compose up`); this includes the topic
   backfill into classes/groups
3. re-register slash commands: `pnpm --filter @studies/bot register` (`/lecturer assign` now
   takes class/group)

### Upgrading to `/setup` (admin role by name)

`ADMIN_ROLE_ID` is gone: the admin role is now looked up by name, `ADMIN_ROLE_NAME` (default `Studies Admin`).
Either set `ADMIN_ROLE_NAME` to your existing admin role's name or rename that role to `Studies Admin`. Re-invite
the bot with the new permission integer from the bot README (adds Manage Channels + Manage Roles, and for the forum
posts Send Messages, Attach Files and Manage Threads) and re-register
slash commands (`pnpm --filter @studies/bot register`).

### Upgrading to the pinned admin role (migration 0007)

Admin commands now check a role id stored in the DB (`bot_settings`) instead of the role name, so a copied role
with the same name no longer grants access. After deploying: run `pnpm db:migrate` (or let the `migrate`
container run on `compose up`), then run `/setup` once as a member with Manage Server. It adopts the existing
`ADMIN_ROLE_NAME` role and pins its id; until then every admin command except `/setup` answers "Brak uprawnień.".

### Upgrading to the admin panel (migration 0008, `studies_rw`)

Set both `DB_RW_PASSWORD` and `DATABASE_RW_URL` (`mysql://studies_rw:<pw>@mariadb:3306/studies`, URL-safe
password) in `.env`, run `pnpm db:migrate` (or let the `migrate` container run on `compose up`) to create the
`studies_rw` user, then run `/setup` once so the bot has the admin role id.

The two variables do different things. `DATABASE_RW_URL` on the `web` container is what enables the console:
without it `/api/admin/sql` answers 503. `DB_RW_PASSWORD` only controls whether `migrate` creates `studies_rw`
and resets its password and grants (without it migrate logs "admin SQL console disabled" and leaves an existing
user alone). To turn the console off, unset `DATABASE_RW_URL` and recreate `web`; to also remove the user, run
`DROP USER 'studies_rw'@'%';` as root.

`studies_rw` may not INSERT into `materials` nor UPDATE its file columns (`storage_path`, `preview_path`,
`sha256`, `size_bytes`). Migrate resets the user's grants on every run with `DB_RW_PASSWORD` set, so an
existing deployment picks this up on its next `migrate` run (with the password set). Console DELETEs follow the foreign keys:
deleting a subject also deletes its classes, groups, class lecturers and plan sessions, deleting a material
deletes its jobs (prefer setting `deleted_at`).

### Upgrading to the Discord panels (migration 0009, `user_groups`)

1. `pnpm db:migrate` (or let the `migrate` container run on `compose up`); 0009 adds `user_groups`
   ("Moje grupy", shared by the web and the bot).
2. Re-register slash commands: `pnpm --filter @studies/bot register` (new `/panel` and `/admin`).
3. Grant the bot's existing role **Pin Messages** (Server Settings → Roles) before running `/setup`; without it
   Discord refuses to create `#panel` and `#admin-panel` (their overwrites grant Pin Messages to the bot).
4. Run `/setup` once; it creates both channels and pins the panels.

Details (admin command visibility, panel channels) are in `apps/bot/README.md`.

### Upgrading to schedule events (migrations 0010-0016)

1. `scripts/backup.sh`, then `pnpm db:migrate` (or let the `migrate` container run on `compose up`). The migrations
   add events and their links to topics (and make `topics.subject_id` nullable), the `v_events` view, recurring
   series, reminder preferences and logs, and `web_uploads`.
2. Re-register slash commands: `pnpm --filter @studies/bot register` (new `/event`).
3. Restart the bot, then run `/setup` once: it creates the `#wydarzenia` forum and adds the event type tags to the
   subject forums. Permissions the bot needs are listed in `apps/bot/README.md`.
4. Website uploads write to `$STORAGE_DIR/uploads`, which the `migrate` service prepares with the right owner
   (see Configure above). The bot removes sent files and cleans up anything older than 24 h.

### Upgrading to the English interface (round 1b)

After deploying, run `pnpm --filter @studies/bot register` once (command descriptions changed), then re-run `/setup`: it
renames the legacy Polish-titled info posts and updates a stale `#wydarzenia` topic.

## Tagi forum

The bot builds the class/group hierarchy from the tags of forum posts. `/setup` creates the forums and these
tags from the DB; for forums made by hand create them yourself (exact names):

- class tags: Wykład, Laboratorium, Ćwiczenia, Projekt, Seminarium
- group tags: Gr. 1 … Gr. N (one per group; accepted variants: Gr3, Gr. 3, Grupa 3, G3)

Other tags (Kolokwium, Egzamin, ...) stay plain tags. `pnpm db:migrate` (and the `migrate`
container on `compose up`) also runs the one-time backfill that assigns existing topics to
classes and groups from their current tags; re-running it is safe.

## Plan zajęć (UniTime)

Set `UNITIME_ICAL_URL` in `.env` to the UniTime iCalendar export URL to enable the timetable sync. The
worker syncs at start-up only if the last run is older than 6 hours, then every 6 hours, and within a
minute after an admin runs the bot's `/plan sync` (the only way to request a sync; the web UI has none).
The URL is a secret: it is never stored in the database or logged (only its host is), so keep it out of
version control. Without it the sync is disabled and the worker logs that once at start.

The optional `UNITIME_EXAM_ICAL_URL` is a second UniTime feed (the exam timetable), equally secret. The
worker reads it right after the main feed in the same runs and stores every entry as an exam session. Each
feed only removes its own rows, and an empty exam feed changes nothing. If this feed fails, the main feed
is still synced and the status shows `Exam timetable: <error>`. It is used only when `UNITIME_ICAL_URL`
is set too.

**Migrating an existing database to 0006.** Migration 0006 adds `UNIQUE(email)` to `lecturers`; if
duplicates exist it fails and leaves the migration half-applied. Before migrating, run

```sql
SELECT LOWER(email), COUNT(*) FROM lecturers WHERE email IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
```

and fix any duplicates first (edit or clear the e-mail of all but one lecturer).

**Linking imported subjects to Discord.** Subjects created by the import have no forum channel. An admin
links one with `/subject add channel:<forum> code:<code of the imported subject>`; Discord requires the
other options too, but the existing name, semester and ECTS are kept. Codes are generated from initials
(e.g. PJP, P40, AM) and are visible via `/subject list` or the `v_subjects` view.

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
`studies_db_storage` (compose pins `name: studies_db`, so it does not depend on the checkout dir); override with `STORAGE_VOLUME`. Nightly at 03:00:

```cron
0 3 * * * /path/to/studies_db/scripts/backup.sh >> /var/log/studies-backup.log 2>&1
```

or a systemd timer with `OnCalendar=*-*-* 03:00:00` running the same script. Rootless podman: run
it as the same user that owns the containers.

`backup.sh` runs under bash with `pipefail`, runs the dump with the password read inside the container
(not visible in `ps`), verifies the dump (`gzip -t` + `Dump completed` trailer) before keeping it, and
prunes old dumps only after success. It reads only `BACKUP_DIR` from `.env` (never sources it).

## Surviving a server reboot (rootless podman)

```sh
loginctl enable-linger <user>                      # user services/timers run without a login session
systemctl --user enable --now podman-restart.service   # restarts containers with restart policies at boot
```

Linger is also required for container healthchecks, which use systemd user timers. `depends_on`
conditions (`service_healthy`, `service_completed_successfully`) need podman-compose >= 1.1.

## Verification status

The image builds and individual containers were verified with `podman build`/`podman run`; the
full `podman compose` flow was not run on the dev machine (no compose provider), so do the first
`compose up` and the Discord DOCX upload check on the server.
