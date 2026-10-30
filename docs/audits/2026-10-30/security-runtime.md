# Security review: runtime and supply chain (2026-10-30)

Scope: dependencies (`pnpm audit`, `pnpm outdated -r`), Containerfiles and ignore files, `compose.yaml`, the migrate step and DB grants, worker subprocesses, `STORAGE_DIR` path handling, secrets and logging, production env defaults, Next.js headers and CSP. This was a static review. I ran no tests, migrations, builds or containers, and did not read `.env`.

Baseline: `docs/audits/2026-10-25/security-runtime.md`, `security-bot.md`, `security-web.md` and `FINDINGS.md`. Fixed items are not reported again (see "Fixes that held").

Counts: high 0, medium 2, low 7, info 3.

## Dependencies

- `pnpm audit --prod`: **No known vulnerabilities found.** The same for `pnpm audit` (all deps): 0 advisories in 367 packages (111 prod, 193 dev).
- The overrides in `pnpm-workspace.yaml` are still in place, and the lock resolves `undici@6.29.1` and `esbuild@0.25.12`/`0.28.2`. Only `esbuild` is allowed to run build scripts (`allowBuilds`).
- `pnpm outdated -r` shows only patch and minor bumps: `mysql2` 3.24.5→3.24.6, `react`/`react-dom` 19.3.0→19.3.1, `@napi-rs/canvas` 1.0.10→1.0.13, `pdfjs-dist` 6.3.289→6.4.299 (pinned exactly), `@codemirror/view`, `geist`, plus dev tools (`vite`, `vitest`, `@playwright/test`, `biome`). `@dagrejs/dagre` 1.1.8→3.1.3 is a major bump. None of these fixes a published advisory. `next@16.4.3` is the latest version. Suggestion: take the `mysql2`, `react` and `pdfjs-dist` bumps in the next routine update. pdf.js parses untrusted PDFs in the browser, so keep it current.

## Findings

### R1 [medium] Web, bot and worker connect to MariaDB as `root`
- Where: `.env.prod.example:9` (`DATABASE_URL=mysql://root:<hex-root>@mariadb:3306/studies`); `compose.yaml:88` passes that URL to the worker, and `compose.yaml:38,70,112` pass it to migrate, bot and web through `env_file`; `docs/deploy.md` ("keep the passwords inside `DATABASE_URL` … in sync"). The main pools are opened in `packages/db/src/client.ts:9`, `apps/web/lib/db.ts:22` and `apps/worker/src/index.ts:24`.
- Scenario: the read-only and read-write consoles are carefully confined (`studies_ro`, `studies_rw`), but every other DB access runs as `root@'%'`, which has FILE, GRANT, CREATE USER, SUPER and access to `mysql.*`. That includes the worker, which feeds untrusted Office documents to `soffice`. The impact of any bug in one service grows to the whole database server:
  - a code-execution bug in a conversion (see R2);
  - a future injection in the main pool;
  - a compromised npm dependency in web or bot.
  An attacker could then rewrite or delete `admin_audit`, mint `sessions` rows for `is_admin` users, create a new privileged user, change the `studies_ro`/`studies_rw` grants, or use `SELECT … INTO OUTFILE` to write files inside the mariadb container. `MARIADB_ROOT_HOST` is left at its default `%`, so root logins work from every container on the compose network.
- Fix:
  - Have migrate (still as root through `DATABASE_ADMIN_URL`) create least-privilege users, the same way it creates `studies_ro`/`studies_rw`:
    - `studies_app` for web and bot: SELECT/INSERT/UPDATE/DELETE on the app tables only, with no FILE, GRANT or DDL;
    - `studies_worker`: SELECT on `materials`, UPDATE only on `preview_path` and `extracted_text`, write on `jobs`, the plan-sync tables (`class_sessions` and what the sync touches), DELETE on `sessions`, `login_tokens` and `bot_requests` for the purges, and nothing else.
  - Point `DATABASE_URL` at those users in `.env.prod.example` and `docs/deploy.md`.
  - Keep the root password only in the `mariadb` and `migrate` services.

### R2 [medium, suspected] A conversion can read the worker's `DATABASE_URL`, and the LibreOffice profile is not hardened against linked content
- Where: `apps/worker/src/exec.ts:11-22,32-36` (`childEnv`), `apps/worker/src/convert.ts:30-43` (fresh default profile per run), `apps/worker/Containerfile:16` (the worker and its children share user `node`), `compose.yaml:88`.
- Scenario: the 2026-10-25 fix gives `soffice`/`pdftotext` a minimal environment, which protects only against a child that reads its own env. The worker's node process is PID 1 in the container and runs as the same uid, and its initial environment stays readable at `/proc/1/environ`. Deleting it from `process.env` does not remove it there. That leaves two paths:
  - **Code execution.** A LibreOffice code-execution bug in a document posted to Discord can read `/proc/1/environ`, which holds `DATABASE_URL`. Today that is DB root (R1). The same applies to the UniTime feed URLs.
  - **Linked content, no exploit needed.** This one is a guess and not tested. Each run uses a fresh profile with default settings: link updates on load, macro security level and `BlockUntrustedRefererLinks` are not set. An ODT/DOCX with a linked section or linked graphic pointing at `file:///proc/1/environ`, or at `file:///data/storage/originals/<sha>` of a file from another subject, may be rendered into the preview PDF. That preview is served to every logged-in student and indexed by `pdftotext`. This is about local files, not network access, so it is separate from the network isolation that was deferred last round.
- Fix:
  - Seed each run's profile with a `registrymodifications.xcu` that turns off link updates (Writer and Calc `Content/Update/Link` = never), sets `Office.Common/Security/Scripting/MacroSecurityLevel` to the highest level with `DisableMacrosExecution=true`, and sets `BlockUntrustedRefererLinks=true`.
  - Add a regression test: a document with a linked section to `file:///etc/hostname` must not show that text in the produced PDF.
  - Longer term (the deferred R7 item): run conversions under a different uid, or in a separate container with no DB credentials, no network, and only the input file and an output dir mounted.

### R3 [low] Storage paths are checked by text only, and file readers follow symlinks
- Where:
  - `packages/db/src/files.ts:122-127`: `resolveInStorage` compares the path as text and never resolves symlinks;
  - `apps/web/lib/http-files.ts:204-212,246-248`: `stat` and `createReadStream` follow symlinks;
  - `apps/bot/src/events/uploads.ts:71-76,189`: the bot (root) streams `uploads/<name>` to Discord;
  - `compose.yaml:53-58`: `uploads/` and `previews/` are both owned by uid 1000, which is the uid of both web and worker.
- Scenario: after a conversion compromise (R2), the worker uid can write both `previews/` and `uploads/`. It plants `uploads/<uuid>` as a symlink to `/proc/self/environ` or `/etc/shadow`, and with the root DB (R1) inserts a `web_uploads` row plus an `event_upload` request. The bot runs as root and follows the link (`createReadStream` does not stop at a size-0 `/proc` file), so it posts the bot container's `DISCORD_TOKEN`, `MARIADB_ROOT_PASSWORD` and `TUNNEL_TOKEN` (R4) into a Discord thread. On the web side, a symlinked preview exposes any regular file readable by `node` in the web container. `/proc` files report size 0 there, so the web environment itself does not leak this way. This needs a prior compromise, but it turns a contained worker bug into a stolen Discord token. Checked and safe: migrate's `chown -R` (GNU coreutils `-R` implies `-P` and no dereference, so it does not follow planted links).
- Fix:
  - In the readers, open with `O_NOFOLLOW`, then `fstat` the descriptor, or call `lstat` plus `realpath` and require the real path to stay under the storage root.
  - Give web (uploads) and worker (previews) different uids.
  - Run the bot as non-root (R5).

### R4 [low] Every app container gets the whole `.env`
- Where: `compose.yaml:38` (migrate), `:70` (bot), `:112` (web): `env_file: .env`. Only the worker has an explicit list (`:87-94`).
- Scenario: the internet-facing `web` container holds `MARIADB_ROOT_PASSWORD`, `DISCORD_TOKEN`, `TUNNEL_TOKEN`, `DB_RO_PASSWORD`/`DB_RW_PASSWORD` and the secret UniTime URLs. By the code (`process.env.*` in `apps/web` and `packages/db`), web reads only `DATABASE_URL`, `DATABASE_RO_URL`, `DATABASE_RW_URL`, `DISCORD_GUILD_ID`, `WEB_BASE_URL`, `STORAGE_DIR` and the UniTime hosts. The bot also gets `TUNNEL_TOKEN` and the RW URL, and migrate gets the Discord token. A file-read or SSRF-to-`/proc` bug in web, or a malicious dependency, therefore leaks the Discord bot token and the tunnel token as well.
- Fix:
  - Give web, bot and migrate an explicit `environment:` list, as the worker has.
  - For web's `importAllowedHosts` (`packages/db/src/unitime/fetch.ts:116-131`), set `UNITIME_IMPORT_HOSTS` explicitly instead of passing the secret feed URLs, which web only reads to get their host names.

### R5 [low] The bot container runs as root, with dev dependencies and the whole repo
- Where: `apps/bot/Containerfile:1-11` (no `USER`, `COPY . .`, `--prod=false`). The same pattern is in `packages/db/Containerfile` (that one needs root for the `chown` step).
- Scenario: the bot parses untrusted Discord content and attachments and renders images with native `@napi-rs/canvas`. As root, any code execution or symlink follow (R3) reads every file in the container and writes anywhere on the storage volume, including `originals/`, which the worker and web treat as trusted. The image also carries `vitest`, `vite`, `drizzle-kit`, `esbuild`, `docs/`, `.claude/` and the seed CLI.
- Fix:
  - Add `USER node` (or a dedicated uid). Make `uploads/` group-shared (for example uid web, gid bot, mode 2770) so the bot can still read and delete uploads, and chown `originals/` to the bot's uid in migrate.
  - Install `tsx` as a dependency and use `--prod`, or prune dev deps in a second stage.

### R6 [low] No container hardening or health checks in compose
- Where: `compose.yaml:65-132`.
- Scenario: no service sets `read_only`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]` or a `tmpfs` for `/tmp`, so a compromised process keeps the default capabilities and a writable root FS. The worker has `mem_limit` and `pids_limit` but nothing else:
  - no `cpus` cap, so a document that keeps `soffice` busy for 120 s on every job, times `WORKER_CONCURRENCY`, starves the host;
  - no bound on disk use: `soffice` output in `/tmp` (container layer) and the preview written to `STORAGE_DIR` have no size cap, so a document that renders to a huge PDF can fill the disk the DB shares.
  Web and bot have no `mem_limit`. Web, bot and worker have no `healthcheck`, and `cloudflared` uses `depends_on: [web]` without `condition: service_healthy`.
- Fix:
  - On bot, worker and web, add `read_only: true`, `tmpfs: [/tmp:size=512m]`, `cap_drop: [ALL]` and `security_opt: [no-new-privileges:true]`.
  - On the worker, add `cpus: "1.5"`.
  - In `convertToPdf`, cap the produced PDF size before the rename.
  - Add a `healthcheck` to web (for example `node -e "fetch('http://127.0.0.1:3000/login-info').then(r=>process.exit(r.ok?0:1))"`) and make cloudflared wait for it.

### R7 [low] Flat network: cloudflared can reach MariaDB, and root accepts logins from any host
- Where: `compose.yaml` (no `networks:`, every service is on the default network), `compose.yaml:124-132` (cloudflared runs a remote-managed tunnel through `TUNNEL_TOKEN`), MariaDB default `MARIADB_ROOT_HOST=%`.
- Scenario: tunnel ingress rules live in the Cloudflare dashboard. Whoever takes over that account, or misconfigures it, can publish `tcp://mariadb:3306` or the bot container through the existing tunnel without touching the server. With R1, the DB root account is then one password away from the internet. A compromised cloudflared image (R8) sits next to the DB in the same way.
- Fix:
  - Put cloudflared and web on an `edge` network, and mariadb, migrate, web, bot and worker on a `backend` network that cloudflared is not on.
  - Bot and worker need outbound internet (Discord, UniTime) and web does not, so if you mark `backend` `internal: true`, add a separate egress network for bot and worker.
  - Optionally set `MARIADB_ROOT_HOST` to the migrate container's network, or use a dedicated migrator user.

### R8 [low] Images and the package manager are not pinned
- Where: `compose.yaml:126` (`cloudflare/cloudflared:latest`), `compose.yaml:11` (`mariadb:11` with `MARIADB_AUTO_UPGRADE: "1"`), every Containerfile (`node:22-bookworm-slim`), `package.json:5` (`"packageManager": "pnpm@12.11.2"` with no `+sha512.` hash, downloaded by `corepack enable` during each build).
- Scenario: a rebuild or `compose pull` silently picks up new upstream images, and the tunnel endpoint (cloudflared) floats on `latest`. A compromised or broken upstream tag goes straight into production with no review. Without the hash, corepack does not verify the pnpm tarball against a known digest.
- Fix: pin images by digest (`image@sha256:…`) and let Renovate or Dependabot propose bumps. Run `corepack use pnpm@12.11.2` to record the integrity hash in `packageManager`. Rebuild the worker image regularly, because LibreOffice and poppler come from Debian packages fixed at build time.

### R9 [low] Ignore files cover `.env` files only at the repo root
- Where: `.containerignore:6-9` and `.dockerignore:6-9` (`.env`, `.env.*`; these patterns only match the context root); `.gitignore` (ignores `.env` at any level, but not `.env.local` or `.env.production`).
- Scenario: Next reads `apps/web/.env*`. A developer `apps/web/.env.local` (or `packages/db/.env`) is copied by `COPY . .` into the bot, worker and migrate images, and into the web build stage, where `next build` loads it. A root `.env.production` or `.env.local` can also be committed by mistake.
- Fix: use `**/.env` and `**/.env.*` with `!.env.example` and `!.env.prod.example` in both container ignore files, and add `.env.*` with the same two exceptions to `.gitignore`.

### R10 [info] Backups are written with the default umask
- Where: `scripts/backup.sh:15-23,37`.
- Scenario: the SQL dump (users, Discord ids, `admin_audit`, `bot_settings`) and the storage copy are created with the caller's umask, often `022`, so they are readable by every user on the host, and they are not encrypted. Session and login tokens are stored hashed, so a dump does not hold usable sessions.
- Fix: `umask 077` at the top of the script and `chmod 700 "$BACKUP_DIR"`. Optionally encrypt the dump (`age` or `gpg`) when it leaves the host.

### R11 [info] Header and CSP leftovers
- Where: `apps/web/lib/security-headers.ts:9-69`, `apps/web/lib/http-files.ts:181`.
- Notes: the headers from the last audit are all present (CSP per ruling R1 with `'unsafe-inline'` scripts, `frame-ancestors 'none'`, nosniff, `X-Frame-Options`, Referrer-Policy, HSTS in production, `poweredByHeader: false`). Still missing:
  - `Permissions-Policy` (for example `camera=(), microphone=(), geolocation=()`);
  - `Cross-Origin-Opener-Policy: same-origin`.
  PDF previews get only `frame-ancestors 'none'`, on purpose, for the browser's PDF plugin. The nonce-based CSP stays a possible later improvement.

### R12 [info] Dev tooling runs MCP servers from `@latest`
- Where: `.mcp.json` (`npx -y @upstash/context7-mcp@latest`, `@playwright/mcp@latest` for every persona).
- Scenario: each session downloads and runs whatever version is newest, on the developer machine that holds the real `.env` and DB. This is a supply-chain risk on the developer side only and does not affect production.
- Fix: pin exact versions.

## Fixes that held (2026-10-25)

- Runtime F1 and web L2: `poweredByHeader: false`; security headers and CSP come from `next.config.ts` `headers()`, with route-owned policies on `/auth/callback` and `/files/*`. `images.unoptimized`.
- Runtime F2 and web L1: `isCrossOrigin` on `/auth/callback` (`route.ts:75`) and `/auth/logout` (`route.ts:9`).
- Bot M3 and ruling R7: the worker image runs as `node`, `childEnv` passes only PATH, HOME, LANG and TMPDIR, the process group is SIGKILLed on timeout, and `mem_limit`/`pids_limit` are set. R2 above covers the gap that remains.
- Web I3: `purgeExpiredAuth` runs daily in the worker.
- Paths taken from DB rows go through `resolveInStorage` in the worker, web file routes, bot `/setup` and uploads. `uploadAbs` requires `uploads/<name>`. `previewRelPath` and `originalRelPath` validate the sha256.
- Risky original MIME types are served as `application/octet-stream` with an attachment disposition. Risky images get a sandbox CSP.
- UniTime fetch: redirects only to the same host, no https→http downgrade, size and time caps, and the URL never appears in errors. User imports are https only, with no userinfo or port and an allow-list of hosts.
- Secrets in logs: no source log prints DB URLs, the Discord token or feed URLs. Only the CLIs (`login-link`, `seed`, `qa`) print one-time login links, on purpose. `jobs.last_error` holds `soffice` stderr (paths only, as before).
- DB grants match CLAUDE.md:
  - `studies_ro` has SELECT on `PUBLIC_VIEWS` only, with `MAX_USER_CONNECTIONS 10` and `MAX_STATEMENT_TIME 5`;
  - `studies_rw` has DML on `CONTENT_TABLES`, column-level grants that exclude `MATERIAL_FILE_COLUMNS`, the event and series link columns and the subject, topic and tag Discord ids, no INSERT on `materials`, SELECT on `PUBLIC_VIEWS`, and `MAX_USER_CONNECTIONS 5` and `MAX_STATEMENT_TIME 5`;
  - both are reset with `REVOKE ALL` on every migrate run;
  - `v_users` exposes only `id`, `display_name` and `created_at`.
- `STORAGE_DIR` must be absolute when `NODE_ENV=production` (`resolveStorageDir`), and every image sets `NODE_ENV=production`, so `secure` cookies and HSTS apply.
- Worker subprocesses take no shell and fixed arguments: `soffice` gets a copied `input.<sanitized ext>` in a fresh temp dir, and `pdftotext` gets an absolute path, so a path can't be read as an option. Timeouts are 120 s and 30 s, stdout is capped at 64 MiB, and text at 1 MiB.

## Not verified

- Runtime F4 from the last round (stack frames in a Server Action's 404 response) still needs a check on a production build (`next start`). Building was out of scope here.
- R2's linked-content path is inferred from LibreOffice's documented defaults. It was not reproduced, because that needs `soffice` and a crafted document.
