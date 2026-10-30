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
creates that directory on every `compose up`, owned by uid 1000 with mode 0750 (the bot runs as uid 1000 too
and can read and delete the files). Without it every upload answers 503. If you run the apps outside compose,
create `uploads/` yourself with an owner that matches the web process.

The `worker` service does not load `.env` as a whole: compose passes it only `DATABASE_URL`,
`UNITIME_ICAL_URL` and the optional `UNITIME_EXAM_ICAL_URL` / `WORKER_CONCURRENCY` / `SOFFICE_BIN` / `PDFTOTEXT_BIN` (and forces
`STORAGE_DIR`). It opens files named by DB rows, so it should not hold the Discord token or other secrets.
If you add a worker setting, list it under `worker.environment` in `compose.yaml`.

The worker image runs as user `node` (uid 1000) and writes only `$STORAGE_DIR/previews`, which the `migrate`
service creates and hands to uid 1000 on every `compose up` (existing previews included). It reads the
originals the bot (uid 1000) writes. Compose caps the worker at `mem_limit`
(`WORKER_MEM_LIMIT`, default `2g`) and `pids_limit: 512`, and `soffice`/`pdftotext` get only `PATH`, a
throwaway `HOME`, `LANG` and `TMPDIR`, never `DATABASE_URL`. Known residual risk: conversions still have network
access (the worker needs the DB and the UniTime feed). Cutting it off needs a separate conversion container
without a network, which is deferred.

### Admin role position (security)

`/setup` creates the `Studies Admin` role at the bottom of the role list and warns about it. Anyone with
Manage Roles can give themselves a role below their own highest role, and this one carries bot admin, web
admin and the read-write SQL console. After the first `/setup`, drag the role above every role held by people
who must not be admins (Server Settings → Roles), and give Manage Roles (and Manage Server, which can run
`/setup`) only to admins. A banned user is refused on every Discord admin path even if they keep the role.

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

Check the web container with `podman compose ps` (`web` must be `healthy`). Nothing is published on the host
and the image has no curl, so to query it directly use
`podman exec studies_db_web_1 node -e "fetch('http://127.0.0.1:3000/login-info').then(r=>console.log(r.status))"`
(container name may differ; see `podman ps`).

Register slash commands once if commands changed. The bot image has no pnpm, so on the server run
`podman compose --profile app run --rm bot node --import tsx src/register-commands.ts`.

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

### Upgrading to timetable assessments (migrations 0018-0020)

1. `pnpm db:migrate` (or let the `migrate` container run on `compose up`); it adds `class_marks`,
   `class_mark_skips`, their `v_*` views, and `class_sessions.kind` / `source`.
2. Optional: set `UNITIME_EXAM_ICAL_URL` (the exam timetable feed, see "Plan zajęć" below) and recreate `worker`.
3. Re-run `/setup` so the pinned `#panel` message gets the "Entry quizzes" row. Slash command definitions did
   not change, so there is nothing to register.

### Upgrading to the bot and worker hardening (2026-10-25 audit)

1. Rebuild and recreate the stack (`podman compose --profile app up -d --build`). The `migrate` service now also
   chowns `$STORAGE_DIR/previews` to uid 1000 before the worker (now user `node`) starts; without it new
   previews fail with `EACCES`.
2. Check the admin role's position (see "Admin role position" above).
3. Discord attachments over 50 MiB, or past 500 MiB per user per hour (counted by the time the message was
   posted), are skipped with a log line and a ⚠️ reaction, and not mirrored. A second rename of an event post
   within 10 minutes waits until the 10 minutes are up; the bot then renames it on its own.
4. Migrations 0021 (`v_materials` hides files of deleted topics) and 0022 (indexes on `bot_requests`,
   `admin_audit` and `materials`) run with the `migrate` service. 0022 builds indexes, so on a large
   `admin_audit` table the migrate step takes a little longer.
5. File originals are now cached by the browser for a year (they never change for an id). Logging out asks
   the browser to clear the site's cache (`Clear-Site-Data: "cache"`), but that is best-effort: not every
   browser honours it, and a session that simply expires never sends it.
6. Migrations 0023 and 0024 make search ignore `ł` like the other diacritics: 0023 adds the stored
   generated column `materials.search_text` (a copy of `extracted_text` with `ł` folded), 0024 folds
   `ł` in `search_name` and moves the `ft_materials` FULLTEXT index to `(search_name, search_text)`.
   Both rebuild `materials`, and `search_text` roughly doubles the space the extracted text takes, so
   take a backup first (`scripts/backup.sh`) and expect the migrate step to take longer on a large table.
   If 0024 fails at `ADD FULLTEXT` (after its `DROP INDEX`), it is not recorded and a re-run fails at
   `DROP INDEX`. Fix the cause, re-create the index by hand, then re-run migrate (it drops and re-adds the
   index and records 0024):

   ```sql
   ALTER TABLE `materials` ADD FULLTEXT `ft_materials` (`search_name`, `search_text`);
   ```

### Upgrading to admin panel round 2 (migration 0025)

1. Migration 0025 only adds `bot_requests.report` (`ADD COLUMN`, instant on MariaDB 10.3+, no data step);
   it runs with the `migrate` service.
2. Redeploy `bot` together with `web`. An old bot never takes the new `setup`, `setup_dry_run` and `resync`
   requests, so the Sync page would show them as queued and say the bot is not responding.
3. No `pnpm --filter @studies/bot register` is needed: no command definitions changed.
4. The first `/setup` must come from Discord. Until it has pinned the admin role (`admin_role_id`), web
   requests fail with `Run /setup from Discord first.`.
5. The boot catch-up now holds the `/setup` lock for its whole run, so a `/setup` (or a web setup) right
   after a restart may answer that setup is already running; try again when the catch-up is done.

### Upgrading to the 2026-10-30 audit fixes

1. No migration. Rebuild and recreate `web` and `bot` (`podman compose --profile app up -d --build`).
2. My groups can be imported from a personal UniTime iCal link. `UNITIME_IMPORT_HOSTS` lists the allowed
   hosts (comma-separated, default `plan.agh.edu.pl`); the hosts of `UNITIME_ICAL_URL` and
   `UNITIME_EXAM_ICAL_URL` are importable too. `web` and `bot` make outbound HTTPS requests to these hosts,
   so allow them if egress is filtered. An import is capped at 5000 calendar entries.
3. The digest thread in `#wydarzenia` is now named `📅 Reminders`. An existing thread keeps its old name
   `📅 Przypomnienia` until you rename it by hand.

### Upgrading to the G5 hardening (2026-10-30 audit, R1-R12)

Back up first (`scripts/backup.sh`). Steps, in order:

1. **App DB user.** Set `DB_APP_PASSWORD` (URL-safe) in `.env` and change `DATABASE_URL` to
   `mysql://studies_app:<pw>@mariadb:3306/studies`. `migrate` creates `studies_app` (DML on the `studies`
   database only, no DDL, FILE or GRANT); web, bot and worker connect as it. Root stays only in
   `MARIADB_ROOT_PASSWORD`, used by `mariadb` and `migrate`.
2. **Import hosts.** web and bot no longer get `UNITIME_ICAL_URL` / `UNITIME_EXAM_ICAL_URL`, so the feed hosts
   are not importable automatically. If a feed is on a host other than `plan.agh.edu.pl`, set
   `UNITIME_IMPORT_HOSTS` to the full comma-separated list **including `plan.agh.edu.pl`**: a non-empty value
   replaces the default.
3. **No `env_file` any more.** Each service gets only the variables listed under its `environment:` in
   `compose.yaml`. Anything you added to `.env` for a service (`TZ`, `NODE_OPTIONS`, `HTTP(S)_PROXY`, ...) no
   longer reaches it; list it there. `.env` must now hold `DATABASE_URL`, `DATABASE_RO_URL`, `WEB_BASE_URL`,
   `DB_RO_PASSWORD`, `MARIADB_ROOT_PASSWORD` and `TUNNEL_TOKEN` even for `ps`, `logs` and `down`: compose
   refuses to interpolate otherwise (this includes the dev override `-f compose.dev.yaml`).
4. **Recreate, don't just restart.** The containers move from the implicit default network to
   `studies_db_edge` / `studies_db_backend`, and the bot image changed:

   ```sh
   podman compose --profile app --profile prod down        # never with -v: it deletes the DB and file volumes
   podman compose --profile app --profile prod up -d --build
   podman network rm studies_db_default                    # only if it is left behind
   ```

   Rebuild everything: the web image build (`next build`) needs more than about 2 GB of RAM in the build
   host or VM. It was never built end to end on the dev machine, so the first real build is on the server.
5. **Storage ownership.** The bot now runs as uid 1000 (it was root). On every `up`, `migrate` chowns
   `originals/`, `uploads/` and `tmp/` (recursively, without following symlinks) and `previews/` to
   1000:1000, so existing root-owned originals are covered and no manual step is needed. The volume root
   stays root-owned. The walk touches only metadata but grows with the archive. Outside compose, give those
   four directories to the user the apps run as.
6. **Read-only services.** bot, worker and web run with a read-only root filesystem, all capabilities dropped
   and `no-new-privileges`; only `/tmp` (512 MB tmpfs), web's `.next/cache` (512 MB tmpfs) and
   `/data/storage` are writable. Anything that writes elsewhere fails with `EROFS`, by design. The Next
   cache is lost on restart. `cloudflared` is read-only and cap-dropped too. cloudflared is on its own
   `edge` network (shared only with `web`); mariadb, migrate and the apps are on `backend`, which is not
   internal (mariadb still has egress).
7. **Health and the tunnel.** cloudflared starts only once `web` is healthy (a `GET /login-info` inside the
   container), and `up` waits for that. Podman runs healthchecks through systemd timers, so a rootless host
   needs `loginctl enable-linger <user>` (see "Surviving a server reboot"); without it `web` stays
   `starting` and the tunnel never comes up. The old `curl -sI localhost:3000/` check no longer works
   (nothing is published, no curl in the image); use `podman compose ps` or the `podman exec ... node -e
   "fetch(...)"` command under "Run".
8. **CLI inside containers.** The bot runtime image has no pnpm or corepack. Re-register slash commands on
   the server with `podman compose --profile app run --rm bot node --import tsx src/register-commands.ts` (this replaces
   `pnpm --filter @studies/bot register` in the older sections above). `migrate` no longer has
   `DATABASE_URL` or `WEB_BASE_URL`, so a login link needs them passed in:
   `podman compose --profile app run --rm -e DATABASE_URL=... -e WEB_BASE_URL=... migrate node --import tsx src/cli/login-link.ts <discordUserId>`.
   Note `pnpm db:seed --reset` needs a root `DATABASE_URL` (it TRUNCATEs); `studies_app` cannot.
9. **Resource limits.** web and bot have `mem_limit: 1g`; the worker has `cpus: "1.5"` on top of its 2 GB /
   512 pids. On rootless podman `cpus` needs the `cpu` cgroup controller delegated to the user. Check
   `cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/cgroup.controllers`. If `cpu` is missing, add
   `/etc/systemd/system/user@.service.d/delegate.conf` with
   `[Service]` / `Delegate=memory pids cpu cpuset io` and reboot, or the worker will not start.
10. **Pinned images.** mariadb (11.8.9 at its digest), `node:22-bookworm-slim` and cloudflared (2026.10.6) are
    pinned by index digest and no longer move with `--pull` or a rebuild. Bump a digest on purpose: read the
    index digest with `podman manifest inspect <image>:<tag>` (not `podman image inspect`'s `.Digest`, which
    is the local platform's manifest). `MARIADB_AUTO_UPGRADE` runs `mariadb-upgrade` when the mariadb digest
    changes, so run `scripts/backup.sh` before bumping it. cloudflared no longer self-updates: bump it
    regularly. `packageManager` carries a sha512 now; very old local corepack versions may refuse pnpm 12
    (the images are fine).
11. **Migrate resets the app grants.** Every `migrate` run does REVOKE then GRANT for `studies_app`, so new
    connections can fail for a few milliseconds. Compose runs `migrate` before the services start; if you
    re-run it by hand against a live stack, accept that blip.
12. **First-deploy checklist (not verified locally).** Build `apps/web/Containerfile` on the server (the local
    2 GB podman VM could not finish `next build`), then check: cloudflared starts read-only once `web` is
    healthy; the bot renders a plan image (`/plan`) on its read-only root; an admin edit that revalidates a
    page (e.g. renaming a subject) shows the new value; a document preview converts.
13. **Rollback.** Point `DATABASE_URL` back at root (`mysql://root:<MARIADB_ROOT_PASSWORD>@mariadb:3306/studies`)
    and recreate the services. The storage ownership change is harmless for a root process.

Also changed: responses carry `Permissions-Policy` (camera, microphone, geolocation and payment off) and
`Cross-Origin-Opener-Policy: same-origin`; `scripts/backup.sh` uses `umask 077` and makes `BACKUP_DIR` mode
0700; `.mcp.json` pins `@upstash/context7-mcp` and `@playwright/mcp` to exact versions (dev tooling only).

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
