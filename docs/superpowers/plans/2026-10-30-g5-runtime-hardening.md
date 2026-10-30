# G5 Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close audit group G5 (R1–R12 in `docs/audits/2026-10-30/security-runtime.md`). Production services stop using DB root, `soffice` can't pull in linked local files, storage readers refuse symlinks, and the compose stack is least-privilege, pinned and segmented.

**Architecture:**
- Grants live in `packages/db` and are created by the migrate CLI, like the existing `studies_ro`/`studies_rw` users.
- Worker conversion hardening lives in `apps/worker`.
- The symlink-safe file opener lives in `packages/db/src/files.ts`, and web and bot use it.
- Container and compose changes are config, verified by building the images and by a throwaway smoke stack.

**Tech Stack:** MariaDB 11 grants, LibreOffice headless, Node fs, Podman/Compose, Next 16 headers.

**Spec:** `docs/audits/2026-10-30/security-runtime.md` (R1–R12) and `FINDINGS.md` (G5).

## Global Constraints

- The dev setup must keep working unchanged: dev `.env` may keep using root, and the new app user is created only when `DB_APP_PASSWORD` is set.
- **Never run the migrate CLI against the dev server's scratch DBs.** Its user step REVOKEs the server-global `studies_ro`/`studies_rw`. DB-backed tests use the existing test helpers, as the RO/RW user tests do.
- No `drizzle-kit push`. Never touch `.env`; read `.env.example` and `.env.prod.example` only.
- Commits as DBOYttt, unsigned (`git -c commit.gpgsign=false commit`), with no AI trailers. Never push.
- UI and log strings English.

## Review Focus

1. **Grant coverage.** `studies_app` needs every privilege web, bot and worker actually use. Grep for `GET_LOCK`, `KILL`, `information_schema`, `SET STATEMENT`, transactions with `FOR UPDATE`/`LOCK IN SHARE MODE`, and `TRUNCATE`; a missing grant is an outage.
2. **The storage opener** must reject a symlink anywhere in the path, not only at the leaf, and still serve normal files, including files written before this change.
3. **Container changes:** a read-only root FS must not break Next, which writes `.next/cache`, nor `soffice` (profile, temp dir) or the bot (canvas fonts, temp files).
4. **Bot as non-root:** it must still write `originals/` and read and delete `uploads/` on an existing volume, whose files are owned by root.
5. **The smoke stack must never touch the dev `studies-mariadb` container** or its volume.

## Rulings (the cost if wrong is in brackets)

- **R1 (one user):** a single `studies_app` user for web, bot and worker, with DML on the app database only (`SELECT, INSERT, UPDATE, DELETE ON <db>.*`, no FILE, GRANT, DDL, `mysql.*` or SUPER). The per-column worker user is parked. [The worker keeps DML on every table.]
- **`MARIADB_ROOT_HOST` stays `%`:** migrate connects over the network. The network split (Task 4) keeps root unreachable from cloudflared. [Root is reachable from the backend containers.]
- **R3 (one uid):** web, bot and worker share uid 1000 (user `node`). Separate uids are parked. The opener's symlink refusal is the control. [A worker compromise can still write uploads.]
- **R2 (separate container):** not done (parked as before). The profile hardening and the size cap are done.

---

### Task 1: Least-privilege app user (R1)

**Files:**
- Create: `packages/db/src/app-user.ts`, modelled on the existing RO/RW user modules (find them via `studies_rw` in `packages/db/src`).
- Modify:
  - `packages/db/src/cli/migrate.ts`, or wherever the RO/RW users are created;
  - `.env.prod.example`;
  - `.env.example`: the commented `DB_APP_PASSWORD` line.
- Test: `packages/db/test/app-user.test.ts`.

**Interfaces:**
- Produces: `ensureAppUser(adminConn, { database, password, user = 'studies_app' })`. It uses the same reset pattern as RO/RW: create if missing, `REVOKE ALL`, then `GRANT SELECT, INSERT, UPDATE, DELETE ON \`<db>\`.* TO …`.
- The migrate CLI calls it when `DB_APP_PASSWORD` is set.

- [ ] **Step 1: write the failing test** against the test DB, using the existing RO/RW test pattern. Use a dedicated user name such as `studies_app_t`, so you never touch shared global users.
  - Create the user and connect as it.
  - Assert that INSERT/UPDATE/DELETE/SELECT on an app table work, `SELECT GET_LOCK('x',1)` works, and `SELECT * FROM v_subjects` works.
  - Assert that `CREATE TABLE`, `SELECT * FROM mysql.user`, `SELECT … INTO OUTFILE` and `GRANT` all fail with an access error.
  - Clean up the user.
- [ ] **Step 2:** grep the app code (Review Focus 1) and list every privileged statement found. Add a test for any that needs more than DML.
- [ ] **Step 3:** implement, run the test file alone, typecheck db.
- [ ] **Step 4:** in `.env.prod.example`, set `DATABASE_URL=mysql://studies_app:<hex-app>@mariadb:3306/studies` and `DB_APP_PASSWORD=<hex-app>`, and add a note that root stays only in `MARIADB_ROOT_PASSWORD` (mariadb and migrate).
- [ ] **Step 5:** commit `feat(db): least-privilege studies_app user for the services`.

### Task 2: Conversion hardening (R2 partial, R6 PDF cap)

**Files:**
- Modify: `apps/worker/src/convert.ts`, `apps/worker/src/exec.ts` if needed.
- Create: `apps/worker/src/soffice-profile.ts`, which writes `user/registrymodifications.xcu` into the per-run profile dir.
- Test:
  - `apps/worker/test/convert-hardening.test.ts`, skipped when no `soffice` is on PATH;
  - a unit test of the XCU content.

**Interfaces:**
- Produces:
  - `writeHardenedProfile(profileDir): Promise<void>`;
  - `MAX_PREVIEW_BYTES = 200 * 1024 * 1024`. A larger produced PDF fails the job with `Preview too large.` and is deleted.
- The XCU sets:
  - `/org.openoffice.Office.Writer/Content/Update/Link` = 2 (never);
  - `/org.openoffice.Office.Calc/Content/Update/Link` = 2;
  - `/org.openoffice.Office.Common/Security/Scripting/MacroSecurityLevel` = 3;
  - `DisableMacrosExecution` = true;
  - `/org.openoffice.Office.Common/Security/Scripting/BlockUntrustedRefererLinks` = true.
  - Check each path name against LibreOffice's official registry schema (the `officecfg` docs) and say in the report which ones you verified.

- [ ] **Step 1: write the failing tests.**
  - The XCU contains each item.
  - A `.fodt` with a `<text:section>` that has a `text:section-source xlink:href="file:///<tmpdir>/secret.txt"` (the file holds a random token) converts to a PDF whose `pdftotext` output lacks the token.
  - Note in the report whether the unhardened default leaked it; run the converter once with the profile seeding disabled.
  - A produced PDF over the cap fails the job: inject a small cap for the test.
- [ ] **Step 2:** implement, then run the worker tests one file at a time, plus the worker typecheck.
- [ ] **Step 3:** commit `fix(worker): harden the LibreOffice profile and cap preview size`.

### Task 3: Symlink-safe storage reads (R3)

**Files:**
- Modify:
  - `packages/db/src/files.ts`;
  - `apps/web/lib/http-files.ts`;
  - `apps/bot/src/events/uploads.ts`;
  - any other reader of `resolveInStorage` paths that streams content to users or to Discord (grep).
- Test: `packages/db/test/files.test.ts` (or the existing files test), plus the web http-files tests and the bot uploads tests.

**Interfaces:**
- Produces: `openInStorage(root: string, rel: string): Promise<{ handle: FileHandle; size: number }>`. It:
  - resolves with `resolveInStorage`;
  - checks that `realpath(abs)` starts with `realpath(root) + sep`;
  - opens with `O_RDONLY | O_NOFOLLOW`;
  - requires `fstat` to report a regular file.

  On violation it throws `StorageAccessError`, which callers map to their not-found response or failure.

- [ ] **Step 1: write the failing tests** in a temp storage dir:
  - a regular file opens;
  - a leaf symlink to `/etc/hosts` is refused;
  - a symlinked directory component (`uploads -> /etc`) is refused;
  - a FIFO or directory is refused.
  - Web: a preview route over a symlinked preview returns 404.
  - Bot: an upload whose temp file is a symlink fails with the existing safe message and is not sent.
- [ ] **Step 2:** implement and switch the readers to streams from the handle (`handle.createReadStream()`). Keep ETag and Range behaviour.
- [ ] **Step 3:** run the touched test files one at a time, then typecheck db, web and bot.
- [ ] **Step 4:** commit `fix(files): storage readers refuse symlinks and non-regular files`.

### Task 4: Containers and compose (R4–R9)

**Files:**
- Modify:
  - `compose.yaml`;
  - `apps/bot/Containerfile`, `apps/web/Containerfile`, `apps/worker/Containerfile`, `packages/db/Containerfile`;
  - `apps/bot/package.json` (move `tsx` to dependencies if the start command needs it);
  - `.containerignore`, `.dockerignore`, `.gitignore`;
  - `package.json` (`packageManager` with an integrity hash via `corepack use pnpm@12.11.2`).

**Rules:**
- **Environment (R4):** web, bot and migrate get explicit `environment:` lists instead of `env_file`, with only the variables each one reads. Find them by grepping `process.env` in the app plus `packages/db`.
  - web: `DATABASE_URL`, `DATABASE_RO_URL`, `DATABASE_RW_URL`, `DISCORD_GUILD_ID`, `WEB_BASE_URL`, `STORAGE_DIR`, `UNITIME_IMPORT_HOSTS`, plus anything else the grep finds. No feed URLs: set `UNITIME_IMPORT_HOSTS` instead, and document that operators must list the feed hosts there.
  - bot and migrate: what they read.
- **Bot (R5):** runs as `USER node`, with prod deps only (or a pruned second stage).
  - Migrate makes the storage dirs that the bot writes or deletes owned by 1000:1000: `chown -R 1000:1000 /data/storage/originals /data/storage/uploads` (GNU `-R` does not follow symlinks; keep `-P` explicit).
- **Hardening (R6):**
  - bot, worker and web get `read_only: true`, `tmpfs` for `/tmp` (size 512m) plus any dir the app writes (Next: `/app/apps/web/.next/cache` or wherever the build lives; check the web Containerfile), `cap_drop: [ALL]` and `security_opt: [no-new-privileges:true]`;
  - worker gets `cpus: "1.5"`;
  - web and bot get `mem_limit` (1g);
  - web gets a healthcheck using `node -e "fetch('http://127.0.0.1:3000/login-info').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`;
  - cloudflared gets `depends_on: web: condition: service_healthy`.
- **Networks (R7):** `edge` holds cloudflared and web. `backend` holds mariadb, migrate, web, bot and worker. Bot and worker need egress, so leave `backend` non-internal.
- **Pinning (R8):**
  - Pin `mariadb:11`, `node:22-bookworm-slim` and `cloudflared` by digest (`podman pull` + `podman image inspect --format '{{.Digest}}'`), keeping the tag in a comment.
  - Drop `MARIADB_AUTO_UPGRADE` only if the pin makes it pointless. Keep it otherwise, since upgrades happen when the digest is bumped.
- **Ignore files (R9):** `**/.env` and `**/.env.*` with `!.env.example` and `!.env.prod.example` in both container ignore files; add `.env.*` with the same exceptions to `.gitignore`.

- [ ] **Step 1: apply the changes.**
- [ ] **Step 2:** run `podman compose config` (exit 0), then build all four images: `podman build -f <Containerfile> .`, which tags nothing shared.
- [ ] **Step 3: smoke stack.** Use a scratch override file in the scratchpad (not committed) that renames the mariadb `container_name` to `studies-smoke-mariadb`, and project name `studies_smoke` (`podman compose -p studies_smoke -f compose.yaml -f <override> --env-file <scratch env> --profile app up -d mariadb migrate web worker`). The scratch env holds random passwords and no Discord token.
  - migrate completes;
  - web becomes healthy;
  - the worker stays up;
  - `podman exec` into web shows `id -u` = 1000 and a read-only root, and `curl`/`fetch` of `/login-info` returns 200.
  - In mariadb, `SHOW GRANTS FOR studies_app` shows DML only.
  - Then `podman compose -p studies_smoke … down -v`.
  - The bot can't start without a token: build it and run `podman run --rm --read-only --tmpfs /tmp <bot image> id -u` (expect 1000) to check the user.
  - Record every command and its result in the report.
- [ ] **Step 4:** commit `chore(deploy): least-privilege, pinned, segmented compose stack`.

### Task 5: Headers, backups and dev tooling (R10–R12) and docs

**Files:**
- Modify:
  - `apps/web/lib/security-headers.ts` and its test;
  - `scripts/backup.sh`;
  - `.mcp.json`;
  - `docs/deploy.md`;
  - `CLAUDE.md` (Deployment section);
  - `docs/audits/2026-10-30/FINDINGS.md`: a "Fixed" note on G5 with commit refs.

- [ ] **Step 1:**
  - Add the headers `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` and `Cross-Origin-Opener-Policy: same-origin` to the global headers, with a test.
  - `scripts/backup.sh` starts with `umask 077` and runs `chmod 700` on the backup dir.
  - `.mcp.json` pins the exact current versions of `@upstash/context7-mcp` and `@playwright/mcp`. Read them with `npm view <pkg> version`.
- [ ] **Step 2: write the `docs/deploy.md` upgrade section** "Upgrading to the G5 hardening":
  1. Set `DB_APP_PASSWORD` and change `DATABASE_URL` to `studies_app`.
  2. Set `UNITIME_IMPORT_HOSTS` to include the feed hosts.
  3. Rebuild everything.
  4. Migrate re-owns `originals/` and `uploads/`.
  5. The services now run read-only and cloudflared is on its own network.
  6. Rollback: point `DATABASE_URL` back at root.
- [ ] **Step 3: update the CLAUDE.md Deployment section** in one or two terse sentences: the app user, read-only containers, networks.
- [ ] **Step 4:** run the web tests for the headers, `pnpm lint` and `pnpm check:lang`.
- [ ] **Step 5:** commit `chore: security headers, backup permissions, pinned MCP servers, G5 docs`.
