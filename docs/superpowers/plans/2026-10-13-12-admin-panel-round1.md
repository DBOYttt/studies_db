# Admin panel round 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins (Discord admin role, flag synced by the bot) get an `/admin` area in the web app with an
overview, a safe SQL write console (preview → confirm → execute, audited) and an audit log.

**Architecture:** `users.is_admin` is synced by the bot. `requireAdmin()` gates the `/admin` pages and API. A
dedicated MariaDB user `studies_rw` with DML grants on content tables only runs console statements, after pure
server-side checks (`lib/admin-sql.ts`). Every executed change writes an `admin_audit` row through the main pool.

**Tech Stack:** TypeScript (ESM), Next.js 16 App Router (read `apps/web/node_modules/next/dist/docs/` before Next
code), React 19, Tailwind 4, drizzle-orm + mysql2 (MariaDB 11), discord.js 14, vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-13-admin-panel-round1-design.md`

## Global Constraints

- `CONTENT_TABLES` = `subjects, lecturers, classes, class_groups, class_lecturers, class_sessions, topics, tags,
  topic_tags, materials, jobs`. `studies_rw` gets SELECT/INSERT/UPDATE/DELETE on exactly these, plus SELECT on
  `PUBLIC_VIEWS`. Nothing else: no users/sessions/login_tokens/bot_state/bot_settings/plan_sync/admin_audit, no
  FILE, no DDL. `MAX_USER_CONNECTIONS 5`, `MAX_STATEMENT_TIME 5`.
- Allowed console kinds: `select | insert | update | delete | replace`. One statement only.
- Limits: preview rows ≤ 50; SELECT rows ≤ 500; confirmation token valid 5 min; typed confirmation when preview
  affected > 100 (table name, or `TAK` when the table is unknown); rate limit 20/min per user; RW pool
  `connectionLimit: 3`.
- Non-admins get 404 (`notFound()`) on every `/admin` page and `/api/admin/*` route.
- Audit actions in this round: `sql.execute`, `sql.rejected`. `admin_audit` is not in `PUBLIC_VIEWS`.
- Env: `DB_RW_PASSWORD`, `DATABASE_RW_URL`. Without `DATABASE_RW_URL` the console is disabled (page message
  `Konsola zapisu wyłączona (brak DATABASE_RW_URL)`, API 503).
- UI copy is Polish. Tabs: `Przegląd` `/admin`, `SQL — zapis` `/admin/sql`, `Dziennik` `/admin/audit`. Simple
  sidebar item: `Panel admina`.
- UI work invokes the taste skills (`redesign-existing-projects` / `minimalist-ui`) and follows the existing
  design tokens and `docs/design/studies-db-phpmyadmin.dc.html` (light + dark).
- Commits as the repo's git identity, no attribution lines. Never push.

## Review Focus

- A statement that touches a forbidden table via a subquery (e.g. `UPDATE subjects SET name = (SELECT
  display_name FROM users LIMIT 1)`) → the DB refuses it (grant layer) and the user gets the Polish permission
  message → test in Task 5.
- A keyword such as `SLEEP(` or `INTO OUTFILE` inside a string literal (`UPDATE subjects SET description =
  'INTO OUTFILE'`) → allowed, not rejected → test in Task 4.
- An editor text changed by whitespace after preview → execute refused, re-preview needed → test in Task 5.
- An admin whose flag was cleared mid-session → next `/admin` request 404 (flag read per request) → test in
  Task 5.
- A preview of an INSERT that fails on a constraint → Polish error, nothing committed, no audit row → test in
  Task 5.

---

### Task 1: DB — admin flag, audit table, audit helpers

**Files:**
- Modify: `packages/db/src/schema.ts` (`users.isAdmin`, `adminAudit` table), `packages/db/src/constants.ts`
  (`CONTENT_TABLES`), `packages/db/src/auth.ts` (`getSessionUser` returns `isAdmin`), `packages/db/src/index.ts`
- Create: `packages/db/src/audit.ts`, migration `packages/db/migrations/0008_admin.sql` via
  `pnpm --filter @studies/db exec drizzle-kit generate --name admin` (journal + snapshot generated)
- Test: `packages/db/test/audit.test.ts`, `packages/db/test/auth.test.ts`

**Interfaces:**
- Produces: `users.isAdmin: boolean` (column `is_admin`, NOT NULL DEFAULT false); `adminAudit` table (columns per
  spec §2); `CONTENT_TABLES` (readonly tuple, exported from `@studies/db/constants`); `type AuditEntry = { userId:
  number; action: string; target?: string | null; statement?: string | null; rowsAffected?: number | null;
  details?: unknown }`; `writeAudit(db: DbExecutor, e: AuditEntry): Promise<number>` (returns id);
  `listAudit(db, o: { limit: number; offset: number; userId?: number; action?: string }): Promise<{ rows:
  AuditRow[]; total: number }>` with `AuditRow = { id; userId; userName: string; action; target; statement;
  rowsAffected; details; createdAt: Date }`, newest first; `getAudit(db, id): Promise<AuditRow | null>`;
  `listAdmins(db): Promise<{ id: number; displayName: string; avatarUrl: string | null }[]>`;
  `getSessionUser(...)` result gains `isAdmin: boolean`.

- [ ] **Step 1: Write failing tests:** `users.is_admin` defaults to false on `upsertUser`; `getSessionUser`
  returns `isAdmin: true` after `UPDATE users SET is_admin = 1`; `writeAudit` returns an id and `listAudit`
  returns newest first with `userName`, filters by `userId`/`action`, paginates with correct `total`;
  `getAudit(missing)` → null; `listAdmins` lists only flagged, non-banned users; `admin_audit` is not in
  `PUBLIC_VIEWS`.
- [ ] **Step 2: Run** `pnpm --filter @studies/db exec vitest run test/audit.test.ts test/auth.test.ts` → FAIL.
- [ ] **Step 3: Implement** schema + generated migration + `audit.ts` + `auth.ts` change. Run
  `node .claude/skills/create-migration/check-migrations.mjs`.
- [ ] **Step 4: Run** `pnpm --filter @studies/db test` and `pnpm --filter @studies/db typecheck` → PASS (all files).
- [ ] **Step 5: Commit** `feat(db): users.is_admin and admin_audit with helpers`.

### Task 2: DB — `studies_rw` user

**Files:**
- Create: `packages/db/src/readwrite-user.ts`
- Modify: `packages/db/src/cli/migrate.ts`, `packages/db/src/testing.ts`, `packages/db/package.json` exports if
  needed, `.env.example`, `.env.prod.example`, `docs/deploy.md`
- Test: `packages/db/test/readwrite-user.test.ts`

**Interfaces:**
- Consumes: `CONTENT_TABLES`, `PUBLIC_VIEWS`.
- Produces: `ensureReadWriteUser(adminUrl: string, password: string, username = 'studies_rw'): Promise<void>`;
  `testRwUrl(): string` from `@studies/db/testing` (user `studies_rw_test`, password `test-rw`, created by
  `resetTestDb`).

- [ ] **Step 1: Write failing tests** connecting as `testRwUrl()`: `UPDATE subjects SET ects = ects` succeeds;
  `SELECT * FROM v_subjects` succeeds; each of `SELECT * FROM users`, `SELECT * FROM sessions`,
  `DELETE FROM admin_audit`, `SELECT * FROM bot_settings`, `CREATE TABLE x (a int)`, `DROP TABLE tags`,
  `ALTER TABLE subjects ADD c int`, `SELECT 1 INTO OUTFILE '/tmp/x'` rejects with errno 1142/1044/1045/1227
  (any access-denied code); calling `ensureReadWriteUser` twice is idempotent and resets manual extra grants.
- [ ] **Step 2: Run** `pnpm --filter @studies/db exec vitest run test/readwrite-user.test.ts` → FAIL.
- [ ] **Step 3: Implement** modelled on `readonly-user.ts`. `migrate.ts`: call it when `DB_RW_PASSWORD` is set,
  else log `DB_RW_PASSWORD not set: admin SQL console disabled`. Env examples: `DB_RW_PASSWORD=change-me-rw`,
  `DATABASE_RW_URL=mysql://studies_rw:change-me-rw@127.0.0.1:3307/studies` (prod: `@mariadb:3306`). Add an
  upgrade note to `docs/deploy.md`: set both vars, run `pnpm db:migrate`, then `/setup` once so the bot has the
  admin role id.
- [ ] **Step 4: Run** `pnpm --filter @studies/db test` + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(db): studies_rw user for the admin SQL console`.

### Task 3: Bot — sync the admin flag

**Files:**
- Create: `apps/bot/src/admin-flag.ts`
- Modify: `apps/bot/src/commands/router.ts` (call before permission checks; `/setup` sets caller flag after
  role stored/adopted), `apps/bot/src/setup/apply.ts` if the flag write belongs with the role action
- Test: `apps/bot/test/admin-flag.test.ts`, `apps/bot/test/router.test.ts`

**Interfaces:**
- Consumes: `getSetting(db, 'admin_role_id')` (existing, key constant `ADMIN_ROLE_SETTING`), `upsertUser`,
  `users.isAdmin`.
- Produces: `syncAdminFlag(db: Db, user: DiscordUser, memberRoleIds: string[]): Promise<boolean>` (returns the
  resulting flag; writes only when it changes); `memberRoleIds(i: ChatInputCommandInteraction): string[]` (array or
  cache member shapes).

- [ ] **Step 1: Write failing tests:** role stored + member has it → flag true; member lacks it → false (and a
  previously true flag is cleared); no stored id → false; unchanged value → no UPDATE issued (spy or
  `updated_at`-free check via row count); router: any chat command (e.g. `/search`) syncs the flag; `/setup`
  leaves the caller with `is_admin = 1` after the role is created/adopted.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/admin-flag.test.ts test/router.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Call `syncAdminFlag` at the top of `runCommand` for every command; failures are
  logged and never block the command.
- [ ] **Step 4: Run** `pnpm --filter @studies/bot test` + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(bot): keep users.is_admin in sync with the Discord admin role`.

### Task 4: Web — pure SQL checks and tokens

**Files:**
- Create: `apps/web/lib/admin-sql.ts`
- Test: `apps/web/test/admin-sql.test.ts`

**Interfaces:**
- Produces:
  - `type StatementKind = 'select' | 'insert' | 'update' | 'delete' | 'replace'`;
  - `classifyStatement(sql: string): { ok: true; kind: StatementKind; table: string | null } | { ok: false;
    reason: string }`;
  - `previewSelect(sql: string, kind: StatementKind, table: string | null): string | null`;
  - `signPreview(p: { userId: number; sql: string; affected: number; at: number }): string`;
  - `verifyPreview(token: string, p: { userId: number; sql: string; now: number }): { ok: true; affected:
    number } | { ok: false; reason: string }`;
  - `adminSqlErrorMessage(err: unknown): string`: errno 1142/1143/1044 → `Brak uprawnień: ta tabela jest poza
    zakresem konsoli administratora.`; 1226 → existing `BUSY_ERROR`; 1969/1317 → existing timeout message; else
    the MariaDB message verbatim (as `/sql` does).
  - Constants: `PREVIEW_ROWS = 50`, `SELECT_ROWS = 500`, `TOKEN_TTL_MS = 300_000`, `CONFIRM_THRESHOLD = 100`.

- [ ] **Step 1: Write failing table tests:**
  - **classify, ok:** `UPDATE subjects SET ects = 5 WHERE id = 1` → update/subjects;
    `delete from \`tags\` where id=3;` → delete/tags; `INSERT INTO lecturers (name) VALUES ('X')` →
    insert/lecturers; `REPLACE INTO tags ...` → replace/tags; `SELECT * FROM v_subjects` → select/null;
    `-- c\nUPDATE topics SET title='a' WHERE id=1` → update/topics;
    `UPDATE subjects SET description = 'INTO OUTFILE; SLEEP(5)' WHERE id=1` → ok (literal);
    `UPDATE subjects s JOIN classes c ON ... SET ...` → update/null.
  - **classify, rejected:** `''`; `DROP TABLE tags`; `TRUNCATE tags`; `CREATE TABLE x(a int)`;
    `UPDATE a SET b=1; DELETE FROM c`; `/*!50000 DROP TABLE tags */`; `SELECT 1 INTO OUTFILE '/tmp/x'`;
    `SELECT LOAD_FILE('/etc/passwd')`; `SET GLOBAL x=1`; `CALL p()`; `LOCK TABLES t WRITE`; `DO SLEEP(5)`;
    `SELECT SLEEP(5)`; `SELECT BENCHMARK(1,1)`.
  - **previewSelect:** `UPDATE subjects SET ects=5 WHERE semester = 1 ORDER BY id LIMIT 3` →
    `SELECT * FROM subjects WHERE semester = 1 LIMIT 50`; DELETE with WHERE → same shape; no WHERE → null;
    multi-table/null table → null; insert → null.
  - **tokens:** a valid token round-trips with `affected`; after 5 min + 1 ms → not ok; other `userId` → not ok;
    `sql` differing by one space → not ok; tampered token → not ok.
  - **errors:** errno 1142 → the permission message.
- [ ] **Step 2: Run** `pnpm --filter @studies/web exec vitest run test/admin-sql.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Tokenize respecting `'…'`, `"…"`, and backtick quoting (with backslash and doubled
  quotes) and comments; reject `/*!`; detect multiple statements by a top-level `;` followed by non-whitespace;
  HMAC-SHA256 key: 32 random bytes cached on `globalThis.__studiesAdminSqlKey`; token =
  base64url(`userId.at.affected.hmac(userId|at|affected|sql)`).
- [ ] **Step 4: Run** → PASS; `pnpm --filter @studies/web typecheck` → clean.
- [ ] **Step 5: Commit** `feat(web): admin SQL statement checks and preview tokens`.

### Task 5: Web — admin gate, RW pool and `/api/admin/sql`

**Files:**
- Modify: `apps/web/lib/session.ts` (`SessionUser.isAdmin`, `requireAdmin`), `apps/web/lib/db.ts`
  (`getRwPool(): mysql.Pool | null`)
- Create: `apps/web/lib/admin-sql-handler.ts`, `apps/web/app/api/admin/sql/route.ts`
- Test: `apps/web/test/admin-sql-route.test.ts`, `apps/web/test/session.test.ts`

**Interfaces:**
- Consumes: Task 1 `writeAudit`, `getSessionUser.isAdmin`; Task 2 `testRwUrl`; Task 4 everything.
- Produces: `requireAdmin(): Promise<SessionUser>` (calls `notFound()` for non-admins);
  `handleAdminSqlRequest(req: Request, user: SessionUser, deps: { db: Db; rw: mysql.Pool | null; limiter?:
  RateLimiter; now?: () => number }): Promise<Response>`. Responses (`Cache-Control: private, no-store`):
  - select: `{ ok: true, kind: 'select', columns, rows, truncated }`;
  - preview: `{ ok: true, kind, table, affected, columns, rows, token }`;
  - execute: `{ ok: true, kind, table, affected, auditId }`;
  - errors: `{ ok: false, error }` with 400/404/429/503.

- [ ] **Step 1: Write failing route tests** (test DB, `vi.mock('@/lib/db')` / `next/headers` like
  `material-route.test.ts`):
  - non-admin session → 404 for preview/execute/select;
  - flag cleared mid-session → 404 on the next request;
  - preview `UPDATE subjects SET ects = 9 WHERE code = 'ASD'` → affected 1, one preview row, DB still has the old
    `ects`;
  - execute with that token → DB has 9, one `sql.execute` audit row with target `subjects` and statement text;
  - execute with SQL changed by one space → 400;
  - expired token (`now` + 5 min + 1) → 400;
  - preview affected 101 → execute without `confirm: 'subjects'` → 400; with it → ok;
  - `UPDATE subjects SET name = (SELECT display_name FROM users LIMIT 1)` → 400 with the permission message, no
    `sql.execute` row;
  - `DROP TABLE tags` → 400 and one `sql.rejected` row;
  - INSERT violating a unique key → 400, nothing committed, no audit row;
  - SELECT → rows, no audit row;
  - `rw: null` → 503;
  - 21st request in a minute → 429;
  - audit write failure after commit (mock `writeAudit` to throw) → 500 with `Zmiana zapisana, ale nie udało się
    zapisać dziennika`.
- [ ] **Step 2: Run** `pnpm --filter @studies/web exec vitest run test/admin-sql-route.test.ts test/session.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Use one pooled connection per request: `BEGIN`; for preview run `previewSelect`
  first, then the statement, then `ROLLBACK` in `finally`. For execute: `BEGIN`; run; `COMMIT`; then
  `writeAudit` on `deps.db`. The route calls `requireAdmin()` first.
- [ ] **Step 4: Run** the web unit suite `pnpm --filter @studies/web test` + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(web): requireAdmin and the audited admin SQL API`.

### Task 6: Web — `/admin` pages and entry points (UI)

**Files:**
- Create: `apps/web/app/(app)/admin/page.tsx`, `apps/web/app/(app)/admin/sql/page.tsx`,
  `apps/web/app/(app)/admin/audit/page.tsx`, `apps/web/app/(app)/admin/audit/[id]/page.tsx`,
  `apps/web/components/shell/admin-tabs.ts`, `apps/web/components/admin/AdminSqlConsole.tsx` (client),
  `apps/web/lib/admin-overview.ts`
- Modify: `apps/web/app/(app)/layout.tsx` and `apps/web/components/shell/NavPanel.tsx` (Admin entry when
  `user.isAdmin`), `apps/web/components/simple/SimpleSidebar.tsx` + `SimpleShell.tsx` (`Panel admina` when admin),
  `apps/web/lib/mode.ts` (`modeTarget` keeps `/admin…` in advanced; switching to simple from `/admin` goes to
  `/s`)
- Test: `apps/web/test/admin-tabs.test.ts`, `apps/web/test/mode.test.ts`, `apps/web/test/admin-overview.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `listAudit`, `getAudit`, `listAdmins`, `getRwPool`, the API from Task 5.
- Produces: `adminTabs(active: 'overview' | 'sql' | 'audit'): Tab[]`;
  `getAdminOverview(db: Db): Promise<{ admins; recent: AuditRow[]; counts: { subjects: number; topics: number;
  readyFiles: number; jobsQueued: number; jobsFailed: number } }>`.

- [ ] **Step 1: Invoke the taste skills** (`redesign-existing-projects`, `minimalist-ui`) and read
  `docs/design/studies-db-phpmyadmin.dc.html` plus `app/globals.css` tokens. Design within the existing shell.
- [ ] **Step 2: Write failing tests:** `adminTabs('sql')` has three tabs with the hrefs/labels from Global
  Constraints and only `sql` active; `modeTarget('advanced', '/admin/sql')` → `/admin/sql`;
  `modeTarget('simple', '/admin/audit')` → `/s`; `getAdminOverview` counts match a seeded DB and `recent` has
  ≤ 10 rows.
- [ ] **Step 3: Run** `pnpm --filter @studies/web exec vitest run test/admin-tabs.test.ts test/mode.test.ts test/admin-overview.test.ts` → FAIL.
- [ ] **Step 4: Implement** the pages (each calls `requireAdmin()` itself; `force-dynamic`).
  - **AdminSqlConsole:**
    - reuses the CodeMirror setup from `SqlConsole`/`sql-editor` and `ResultGrid` for rows;
    - the warning banner text `Zmiany są zapisywane w bazie i w dzienniku`;
    - Podgląd/Wykonaj buttons, with Wykonaj disabled unless the editor text equals the previewed text;
    - the confirmation input shown when affected > 100;
    - shows `N wierszy zostanie zmienionych` / the result plus a link to `/admin/audit/<id>`;
    - shows `Konsola zapisu wyłączona (brak DATABASE_RW_URL)` when `getRwPool()` is null.
  - **Dziennik:** 50 per page, filters via `?user=&action=&page=`, times formatted Europe/Warsaw, statement
    truncated to 120 chars.
- [ ] **Step 5: Run** `pnpm --filter @studies/web test` + typecheck + `pnpm biome check apps/web` → PASS.
- [ ] **Step 6: Commit** `feat(web): /admin overview, SQL write console and audit log`.

### Task 7: E2E and docs

**Files:**
- Modify: `apps/web/e2e/global-setup.ts` (admin user `e2e-admin` with `is_admin = 1` and its login tokens;
  RW URL env for the e2e server), `apps/web/playwright.config.ts` (`DATABASE_RW_URL: testRwUrl()`),
  `CLAUDE.md` (admin section), `apps/bot/README.md` (admin flag)
- Create: `apps/web/e2e/admin.spec.ts`

- [ ] **Step 1: Write the e2e spec:**
  - the admin logs in, sees the Admin entry and `Przegląd` with their name in the admins list;
  - in `SQL — zapis` they run `UPDATE subjects SET ects = 7 WHERE code = 'MECH'`, Podgląd shows
    `1 wierszy`/`1 wiersz`, and Wykonaj succeeds;
  - `Dziennik` shows the statement;
  - a non-admin gets 404 on `/admin` and `/admin/sql`;
  - the simple sidebar shows `Panel admina` only for the admin.
- [ ] **Step 2: Run** `pnpm --filter @studies/web e2e e2e/admin.spec.ts` → FAIL before the setup changes, PASS
  after; then the full `pnpm --filter @studies/web e2e` → PASS.
- [ ] **Step 3: Update docs** (CLAUDE.md: `requireAdmin`, `studies_rw`/`DATABASE_RW_URL`, `admin_audit`, never put
  user SQL on the main pool except via the RW pool).
- [ ] **Step 4: Run** `pnpm test` (all packages) and `pnpm lint` (the known pre-existing
  `apps/web/e2e/simple.spec.ts` format error may remain) → PASS.
- [ ] **Step 5: Commit** `test(web): admin panel e2e; docs`.
