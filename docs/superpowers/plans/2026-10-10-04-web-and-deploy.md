# Studies DB — Plan 4: Website & Deployment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Polish-language Next.js website — Discord-link login, subject/topic browsing, inline previews, full-text search, phpMyAdmin-style table browser and a safe read-only SQL console — plus container images and a Compose production profile with Cloudflare Tunnel.

**Architecture:** Server components query `@studies/db` directly (main pool for app data, `studies_ro` pool for tables/SQL console). Security-relevant logic lives in small `lib/` modules with unit tests; pages are thin. Every page and route handler calls `requireUser()`; there is no reliance on Next middleware for auth.

**Tech Stack:** Next.js 16 (App Router, Node runtime), React 19, Tailwind CSS 4, react-pdf 11 (pdf.js), CodeMirror 6 via `@uiw/react-codemirror` + `@codemirror/lang-sql`, Vitest 5, Playwright 1.64, Podman/Compose, cloudflared.

**Spec:** `docs/superpowers/specs/2026-10-10-studies-db-design.md` (§7, §8, §9, §10)

**Depends on:** Plan 1 complete. Plans 2–3 needed only for real data and the deploy task.

## Global Constraints

- All Plan 1 global constraints apply.
- UI language Polish, single locale, no i18n library. Light/dark via `prefers-color-scheme`.
- Session cookie: name `sid`, `httpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, `maxAge` 30 days, `path=/`.
- Unauthenticated → redirect to `/login-info`, which shows: **"Aby wejść, wpisz /link na serwerze Discord rocznika — bot wyśle Ci link logowania."**
- Public routes: `/login-info`, `/auth/callback`. Everything else requires a valid session for a non-banned user.
- Files served only via `/files/[id]/original` and `/files/[id]/preview`, never from `public/`.
- SQL console & tables browser use **only** `DATABASE_RO_URL` (`studies_ro`); limits: single statement, `max_statement_time=5`, **1000** rows, **30 queries/min per session**.
- Tables browser page size **50**.
- Env: `DATABASE_URL`, `DATABASE_RO_URL`, `STORAGE_DIR`, `DISCORD_GUILD_ID` (for "Otwórz w Discordzie" links: `https://discord.com/channels/<guild>/<thread>/<message>`).

## Review Focus

1. **Polish / non-ASCII filenames on download** (`Sprawozdanie – ćw. 3.docx`) — expected: browser saves with the original name. → Task 2 test `contentDisposition` (RFC 5987 `filename*`).
2. **Large PDFs on phones** — pdf.js requests byte ranges; expected: `206 Partial Content` with correct `Content-Range`, invalid range → `416`. → Task 2 tests.
3. **Hostile or heavy SQL** — `SELECT 1; DROP TABLE v_users`, `SELECT SLEEP(10)`, `SELECT * FROM sessions`, `SELECT … INTO OUTFILE '/tmp/x'`, `WITH RECURSIVE` producing millions of rows — expected: clean error message or truncated result within ~5 s, app stays responsive. → Task 3 tests.
4. **Table browser URL tampering** (`/tables/sessions`, `?sort=1;DROP`, `?f_unknown=x`) — expected: 404 for non-public view, unknown sort/filter columns ignored. → Task 3 tests.
5. **Material still `pending` or `failed`** when a student opens the topic — expected: file listed with download button and status label ("Przetwarzanie…" / "Podgląd niedostępny"), no broken viewer. → Task 4 Playwright check.

---

### Task 1: Next.js app, sessions & login flow

**Files:**
- Create: `apps/web/` via `create-next-app` (TypeScript, App Router, Tailwind, no ESLint — Biome is used), then trim boilerplate
- Create: `apps/web/lib/db.ts`, `apps/web/lib/session.ts`
- Create: `apps/web/app/login-info/page.tsx`, `apps/web/app/auth/callback/route.ts`, `apps/web/app/auth/logout/route.ts`, `apps/web/app/(app)/layout.tsx`
- Test: `apps/web/test/session.test.ts`

**Interfaces:**
- Consumes: `createDb`, `consumeLoginToken`, `getSessionUser`, `deleteSession`, `SESSION_TTL_MS` (Plan 1).
- Produces:
  - `getDb(): Db` and `getRoPool(): mysql.Pool` (`lib/db.ts`, module-level singletons, cached on `globalThis` in dev).
  - `SESSION_COOKIE = 'sid'`, `sessionCookieOptions(): ResponseCookie options` (per Global Constraints).
  - `currentUser(): Promise<SessionUser | null>`; `requireUser(): Promise<SessionUser>` — redirects to `/login-info`.
  - `(app)/layout.tsx` — calls `requireUser()`, renders header (logo "Studies DB · TP 4.0", nav: Przedmioty, Szukaj, Tabele, SQL; user avatar + "Wyloguj").
  - `GET /auth/callback?token=` → valid: set cookie, 303 to `/`; invalid: 303 to `/login-info?error=expired` (page shows "Link wygasł lub został już użyty. Wpisz /link ponownie.").
  - `POST /auth/logout` → delete session, clear cookie, 303 to `/login-info`.
- Config: `next.config.ts` `transpilePackages: ['@studies/db']`, `serverExternalPackages: ['mysql2']`, `output: 'standalone'`.

- [ ] **Step 1: Write failing tests** for `sessionCookieOptions()` (dev vs prod `secure`, `maxAge === 30*24*3600`) and for the callback handler (call the exported `GET` with a `NextRequest` against test DB): valid token → 303 `/` + `Set-Cookie: sid=`; reused token → 303 `/login-info?error=expired`.
- [ ] **Step 2:** `pnpm --filter @studies/web test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. Manual: create token via `pnpm --filter @studies/db exec tsx -e` (or `/link` from the bot), open link → lands on `/`.
- [ ] **Step 5:** Commit `feat(web): next app with discord-link sessions`.

---

### Task 2: File streaming with ranges

**Files:**
- Create: `apps/web/lib/http-files.ts`, `apps/web/app/files/[id]/[variant]/route.ts`
- Test: `apps/web/test/http-files.test.ts`

**Interfaces:**
- Produces:
  - `parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null` — single range only (`bytes=a-b`, `bytes=a-`, `bytes=-n`).
  - `contentDisposition(kind: 'inline' | 'attachment', filename: string): string` — `<kind>; filename="<ascii fallback, non-ASCII → _ , quotes stripped>"; filename*=UTF-8''<encodeURIComponent>`.
  - `GET /files/[id]/[variant]` (`variant` ∈ `original|preview`) — `requireUser()`; 404 if material missing/soft-deleted or preview absent; `preview`: `inline`, `application/pdf` for `preview_kind='pdf'` (converted file or original PDF), original mime for image/text (`text/plain; charset=utf-8` for text); `original`: `attachment` with `original_filename`; `Accept-Ranges: bytes`; `206` + `Content-Range` for valid range, `416` for invalid; body via `Readable.toWeb(createReadStream(path, {start,end}))`.

- [ ] **Step 1: Write failing tests:** `parseRange('bytes=0-99', 1000)` → `{0,99}`; `'bytes=900-'` → `{900,999}`; `'bytes=-100'` → `{900,999}`; `'bytes=1000-'` → `'invalid'`; `'bytes=0-1,5-6'` → `'invalid'`; `null` → `null`. `contentDisposition('attachment','Sprawozdanie – ćw. 3.docx')` contains `filename*=UTF-8''Sprawozdanie%20%E2%80%93%20%C4%87w.%203.docx` and an ASCII-only `filename="…"`. Route test (test DB + temp storage + seeded session cookie): 200 full body, 206 with range, 416, 404 for soft-deleted material, redirect (`307`, Next `redirect()`) to `/login-info` without cookie.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): session-checked file streaming with range support`.

---

### Task 3: Read-only SQL engine & table browser backend

**Files:**
- Create: `apps/web/lib/sql-console.ts`, `apps/web/lib/rate-limit.ts`, `apps/web/lib/tables.ts`, `apps/web/lib/csv.ts`
- Create: `apps/web/app/api/sql/route.ts`, `apps/web/app/api/schema/route.ts`
- Test: `apps/web/test/sql-console.test.ts`, `apps/web/test/tables.test.ts`, `apps/web/test/rate-limit.test.ts`, `apps/web/test/csv.test.ts`

**Interfaces:**
- Consumes: `getRoPool()`, `PUBLIC_VIEWS`.
- Produces:
  - `QueryResult = { ok: true; columns: string[]; rows: unknown[][]; truncated: boolean; durationMs: number } | { ok: false; error: string }`
  - `runReadonlyQuery(pool: mysql.Pool, sql: string, opts?: { maxRows?: number; timeoutSec?: number }): Promise<QueryResult>` — defaults 1000 / 5; trims and removes one trailing `;`; empty → `{ok:false,error:'Puste zapytanie.'}`; executes `SET STATEMENT max_statement_time=<t> FOR <sql>` on a dedicated connection via `connection.query(...).stream()`; after `maxRows` rows sets `truncated` and **destroys** the connection (otherwise releases); MariaDB errors returned verbatim (`err.message`); timeout error mapped to `'Przekroczono limit czasu (5 s).'`.
  - `createRateLimiter(limit: number, windowMs: number): { check(key: string, now?: number): boolean }` — sliding window, in-memory.
  - `listViewColumns(pool): Promise<Record<PublicView, string[]>>` — from `information_schema.COLUMNS`, cached 60 s.
  - `browseView(pool, view: string, q: { page?: number; sort?: string; dir?: 'asc'|'desc'; filters?: Record<string,string> }): Promise<{ columns: string[]; rows: unknown[][]; total: number; page: number; pageCount: number } | null>` — null for non-public view; ignores unknown sort/filter columns; filters are `CAST(col AS CHAR) LIKE ?` with `%v%`; identifiers quoted with backticks only after whitelist check; page size 50.
  - `toCsv(columns: string[], rows: unknown[][]): string` — RFC 4180 quoting, `\r\n`, UTF-8 BOM prefix (Excel + Polish chars).
  - `POST /api/sql` body `{ sql: string }` → `QueryResult` JSON; `requireUser()`; rate limit 30/min keyed by user id → 429 `{ok:false,error:'Za dużo zapytań — odczekaj chwilę.'}`.
  - `GET /api/schema` → `Record<view, string[]>` for autocomplete.

- [ ] **Step 1: Write failing tests** (test DB, ro user `test-ro`, seeded rows):
  - `SELECT name FROM v_subjects` → ok, columns `['name']`.
  - `SELECT 1; DROP TABLE v_users` → `ok:false`, and `v_users` still exists.
  - `DELETE FROM v_subjects` → `ok:false`, message matches `/denied/i`.
  - `SELECT * FROM sessions` → `ok:false`.
  - `SELECT 1 INTO OUTFILE '/tmp/x'` → `ok:false`.
  - `SELECT SLEEP(10)` → returns within 7 s; `ok:false` with timeout message **or** `ok:true` with sleep result `1` (MariaDB returns 1 for interrupted SLEEP) — assert elapsed < 7000 ms.
  - `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100000) SELECT * FROM n` → `rows.length === 1000`, `truncated: true`.
  - `SHOW TABLES` → ok, lists only `v_*`.
  - `browseView(pool,'sessions',{})` → null; `sort:'1;DROP'` ignored (no throw); `filters:{name:'Mech'}` returns matching subject; `page:2` with 120 seeded rows → 50 rows, `pageCount:3`.
  - rate limiter: 30 allowed, 31st false, allowed again after window.
  - `toCsv(['a','b'],[['x,y','z"q']])` → `'﻿a,b\r\n"x,y","z""q"\r\n'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): read-only sql engine, table browser backend, csv`.

---

### Task 4: Pages — browse, topic viewer, search, tables, SQL console

**Files:**
- Create: `apps/web/lib/queries.ts` (app-data queries via main `Db`)
- Create: `apps/web/app/(app)/page.tsx`, `(app)/subjects/[code]/page.tsx`, `(app)/topics/[id]/page.tsx`, `(app)/search/page.tsx`, `(app)/tables/[view]/page.tsx`, `(app)/tables/[view]/csv/route.ts`, `(app)/sql/page.tsx`
- Create components: `components/DataGrid.tsx` (shared sortable/filterable grid used by topics list, tables browser and SQL results), `components/PdfViewer.tsx` (client, react-pdf, page nav + zoom, worker from `pdfjs-dist` via `new URL(..., import.meta.url)`), `components/FilePreview.tsx`, `components/SqlConsole.tsx` (client, CodeMirror with `sql({ dialect: MariaSQL, schema })`, Ctrl+Enter, history in `localStorage` key `studiesdb.sqlHistory` max 50, example-query dropdown), `components/TagBadge.tsx`, `components/StatusBadge.tsx`
- Create: `apps/web/lib/example-queries.ts`
- Test: `apps/web/test/queries.test.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/global-setup.ts`, `apps/web/playwright.config.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `searchAll` (Plan 1).
- Produces (`queries.ts`):
  - `listSubjectsOverview(db): Promise<Array<{ code; name; semester; ects; lecturers: { name; title; role }[]; materialCount; lastUploadAt: Date | null }>>` — excludes soft-deleted materials.
  - `getSubject(db, code): Promise<… | null>`, `listTopics(db, subjectId, opts: { tagId?: number }): Promise<Array<{ id; title; tags: {id;name}[]; fileCount; createdAt; author }>>`
  - `getTopicWithMaterials(db, topicId): Promise<{ topic; subject; materials: Array<{ id; originalFilename; mimeType; sizeBytes; previewKind; status; createdAt; uploaderName; discordUrl }> } | null>`
- Pages (copy fixed by spec/constraints): home groups by "Semestr 1" / "Semestr 2"; subject page lists lecturers by role; topic page shows `StatusBadge` — `pending` → "Przetwarzanie…", `failed` → "Podgląd niedostępny"; each file has "Pobierz" and "Otwórz w Discordzie"; search page shows snippet with `«»` rendered as `<mark>`; tables page sidebar of `PUBLIC_VIEWS` + "Eksport CSV"; SQL page sidebar lists schema.
- `example-queries.ts`: exactly these three named examples — "Materiały na przedmiot" (count per subject, join `v_materials`→`v_topics`→`v_subjects`), "Najaktywniejsi uploaderzy" (top 10 by count from `v_materials` join `v_users`), "Kolokwia z ostatnich 30 dni" (`v_topic_tags`/`v_tags` name `'Kolokwium'`, `created_at >= NOW() - INTERVAL 30 DAY`). Each must run successfully in the Task 3 engine (add a test iterating them).

- [ ] **Step 1: Write failing tests:** `queries.test.ts` — overview counts exclude soft-deleted, `listTopics` tag filter, `getTopicWithMaterials` builds `discordUrl` with guild/thread/message ids; every example query returns `ok:true` via `runReadonlyQuery`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement queries, then pages and components.
- [ ] **Step 4:** Run unit tests → PASS.
- [ ] **Step 5: Playwright smoke.** `global-setup.ts`: `resetTestDb()`, seed 1 subject/topic with tag Kolokwium, 3 materials (ready PDF fixture with `extracted_text` containing `Współczynnik tarcia: tarcie statyczne`, pending docx, failed pptx), create login token → `process.env.E2E_TOKEN`; `playwright.config.ts` `webServer` runs `pnpm dev` with test DB env on port 3100. `smoke.spec.ts`:
  - visiting `/` without cookie → `/login-info` text visible;
  - `/auth/callback?token=$E2E_TOKEN` → subject card visible;
  - click subject → topic → PDF canvas rendered; pending file shows "Przetwarzanie…"; failed shows "Podgląd niedostępny" and a working "Pobierz" link;
  - search "tarcie" → result with `<mark>`;
  - SQL: run `SELECT 1 AS x` → grid shows `1`; run `DELETE FROM v_subjects` → error panel visible.
  Run `pnpm --filter @studies/web e2e` → all pass.
- [ ] **Step 6:** Commit `feat(web): browse, preview, search, tables and sql console pages`.

---

### Task 5: Containers, Compose production profile, Cloudflare Tunnel, backups

**Files:**
- Create: `apps/bot/Containerfile`, `apps/worker/Containerfile`, `apps/web/Containerfile`, `packages/db/Containerfile` (migrate job)
- Modify: `compose.yaml`, `.env.example`
- Create: `scripts/backup.sh`, `docs/deploy.md`

**Interfaces:**
- Consumes: all apps.
- Produces: `podman compose --profile app up -d` (local full stack); `podman compose --profile app --profile prod up -d` (adds `cloudflared`).

- [ ] **Step 1:** Containerfiles on `docker.io/library/node:22-bookworm-slim`, pnpm via corepack, `pnpm install --frozen-lockfile --filter <app>...`:
  - bot / worker / migrate run with `tsx src/index.ts` (no build step).
  - worker additionally `apt-get install -y --no-install-recommends libreoffice-writer libreoffice-impress libreoffice-calc poppler-utils fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea` (metric-compatible fonts so Office docs with Polish text render correctly).
  - web: `next build` with `output: 'standalone'`, runtime stage copies `.next/standalone` + `.next/static`, `CMD node apps/web/server.js`, port 3000.
- [ ] **Step 2:** `compose.yaml` services: `mariadb` (no profile; in prod no published port — keep `3307:3306` only under a `dev` override comment), `migrate` (profile `app`, `depends_on: mariadb: service_healthy`, `restart: "no"`), `bot`, `worker`, `web` (profile `app`, `depends_on: migrate: service_completed_successfully`, `restart: unless-stopped`, `env_file: .env`, shared named volume `storage` at `/data/storage`, `STORAGE_DIR=/data/storage`), `cloudflared` (profile `prod`, image `docker.io/cloudflare/cloudflared:latest`, `command: tunnel --no-autoupdate run`, env `TUNNEL_TOKEN`). `mariadb` gets a healthcheck (`healthcheck.sh --connect --innodb_initialized`). Web listens only on the compose network (`expose: 3000`); tunnel ingress points to `http://web:3000`.
- [ ] **Step 3:** `scripts/backup.sh`: `podman exec studies-mariadb mariadb-dump --single-transaction -uroot -p"$MARIADB_ROOT_PASSWORD" studies | gzip > "$BACKUP_DIR/studies-$(date +%F).sql.gz"`, `rsync -a` of the storage volume mountpoint to `$BACKUP_DIR/storage/`, delete dumps older than 14 days. `docs/deploy.md`: create tunnel in Cloudflare Zero Trust dashboard, public hostname → `http://web:3000`, set `WEB_BASE_URL=https://<hostname>`, `TUNNEL_TOKEN`, strong `MARIADB_ROOT_PASSWORD` / `DB_RO_PASSWORD`, systemd timer or cron for `backup.sh` nightly at 03:00.
- [ ] **Step 4: Verify locally:** `podman compose --profile app up -d --build` → `podman compose ps` shows mariadb healthy, migrate exited 0, bot/worker/web running; `curl -sI localhost:3000/` → `303` to `/login-info` (temporarily publish `3000:3000` for this check); upload a DOCX in the test Discord → appears on site with preview within ~1 min.
- [ ] **Step 5:** `pnpm lint && pnpm test` → green. Commit `chore: containers, compose prod profile with cloudflare tunnel, backups`.
