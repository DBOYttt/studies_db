# Admin panel — round 1: admin identity, audit log, SQL write console

Date: 2026-10-13. Status: design approved in chat (parts 1–3), pending spec review.

## Intent

The user asked for an admin panel in the web app. Its full scope is data editing (CRUD), content moderation, an
audit log, an ops dashboard, schedule changes, and the ability to send SQL statements that change data. That is
too much for one spec, so it was split into rounds, each with its own spec → plan → build → review:

1. **This round:** the web learns who is an admin; an `/admin` area; an audit log; an admin SQL write console.
2. Next: data editor forms (subjects, classes, groups, lecturers, assignments, tags) and schedule editing
   (move/cancel/add sessions, protected from UniTime sync overwrites), all audited.
3. Later: moderation (hide/restore topics and files, re-run jobs, ban/unban) and an ops dashboard (job queue,
   plan sync status + "sync now", storage, errors).

Round 1 comes first because every later write depends on its admin check and its audit log.

Success: an admin (Discord admin role) who logs in to the web sees an "Admin" tab, can preview and then run a
single INSERT/UPDATE/DELETE/REPLACE against the content tables, and finds it in the audit log. A non-admin gets 404
on every `/admin` URL. The console cannot touch users, sessions, tokens, bot settings or the audit log itself,
even with a crafted statement.

Agreed in chat:
- Admin identity: a flag synced by the bot (not a live Discord check, not a separate web list).
- SQL scope: DML only, on content tables only.
- Approach: a dedicated MariaDB user with limited grants plus server-side checks (defence in depth).

## 1. Admin identity

- Migration: `users.is_admin` boolean NOT NULL DEFAULT false.
- Bot: `syncAdminFlag(db, user: DiscordUser, memberRoleIds: string[])` in `apps/bot/src`, called at the start of
  every chat command (including `/link`), before the permission check. It reads `admin_role_id` from
  `bot_settings`. `is_admin` = the stored role id is among the member's roles. With no stored id, every user is
  non-admin. It upserts the user, so `/link` works for new users, and writes only when the value changes.
- `/setup`: after it stores or adopts the role id and assigns the role to the caller, it sets the caller's flag
  to true.
- Accepted trade-off: a user whose Discord role was removed keeps web admin until their next bot command. Sessions
  expire after 30 days.
- Web: `SessionUser` gains `isAdmin` (from `getSessionUser`). `requireAdmin()` in `lib/session.ts` calls
  `requireUser()`, then `notFound()` when `!isAdmin`. Every page and route handler under `/admin` calls it itself;
  the layout alone is not a gate. A banned user has no session, so it is never an admin on the web.

## 2. Database

- `admin_audit`: `id` int PK auto, `user_id` int NOT NULL → users, `action` varchar(50) NOT NULL (`sql.execute`,
  `sql.rejected`; round 2 adds more), `target` varchar(100) NULL (table name when known), `statement` mediumtext
  NULL, `rows_affected` int NULL, `details` json NULL, `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  index on `created_at`. Not in `PUBLIC_VIEWS`.
- `CONTENT_TABLES` constant in `packages/db/src/constants.ts`: `subjects`, `lecturers`, `classes`,
  `class_groups`, `class_lecturers`, `class_sessions`, `topics`, `tags`, `topic_tags`, `materials`, `jobs`.
- `ensureReadWriteUser(adminUrl, password, username = 'studies_rw')` in `packages/db/src/readwrite-user.ts`,
  modelled on `ensureReadonlyUser`:
  - `CREATE USER IF NOT EXISTS`, `ALTER USER … IDENTIFIED BY`, `REVOKE ALL PRIVILEGES, GRANT OPTION`;
  - `ALTER USER … WITH MAX_USER_CONNECTIONS 5 MAX_STATEMENT_TIME 5`;
  - `GRANT SELECT, INSERT, UPDATE, DELETE ON db.<t>` for each content table;
  - `GRANT SELECT ON db.<v>` for each public view, so SELECTs in the console behave as in `/sql`;
  - no other grants: no users/sessions/login_tokens/bot_state/bot_settings/plan_sync/admin_audit, no FILE, no
    DDL.
- `migrate` CLI: also runs `ensureReadWriteUser` when `DB_RW_PASSWORD` is set; without it, it logs that the
  console is disabled.
- `testing.ts`: `resetTestDb` also creates `studies_rw_test` with a fixed password; `testRwUrl()` exported.
- Env: `DB_RW_PASSWORD`, `DATABASE_RW_URL` (`.env.example`, `.env.prod.example`, `docs/deploy.md`). If
  `DATABASE_RW_URL` is unset, `/admin/sql` shows "Konsola zapisu wyłączona (brak DATABASE_RW_URL)" and the API
  returns 503.
- Audit helpers in `packages/db/src/audit.ts`: `writeAudit(db, entry)` and
  `listAudit(db, { limit, offset, userId?, action? })`, newest first, joined with the user's display name.

## 3. `/admin` area (web)

Under `app/(app)/admin/` in the existing shell, with its own tab strip (`adminTabs(active)`, same pattern as
`dbTabs`): **Przegląd** `/admin`, **SQL — zapis** `/admin/sql`, **Dziennik** `/admin/audit`.

- Entry points: an "Admin" item in the advanced shell's nav/tab strip and a "Panel admina" item in the simple
  sidebar, rendered only when `currentUser().isAdmin`. `modeTarget` maps any `/admin…` path to itself for the
  advanced mode; the simple mode has no admin pages.
- **Przegląd:** admins list (display name, avatar), the last 10 audit entries (link to Dziennik), and read-only
  counts: subjects, topics, ready files, jobs queued/failed.
- **SQL — zapis:**
  - The existing CodeMirror editor with a warning banner ("Zmiany są zapisywane w bazie i w dzienniku").
  - **Podgląd** (preview) → shows the statement type, the target table if known,
    `N wierszy zostanie zmienionych`, and up to 50 preview rows in the existing result grid (`ResultGrid`).
  - **Wykonaj** (execute) is enabled only while the editor text equals the previewed text. If the preview showed
    more than 100 affected rows, the user must also type the table name (or `TAK` when unknown).
  - After execute: affected count and a link to the audit entry.
  - SELECT statements return their rows (max 500, like `/sql`), with no confirmation and no audit row.
- **Dziennik:** a paged table (50 per page): time (Europe/Warsaw), admin, action, target, rows affected, first 120
  characters of the statement. Filter by admin and action. `/admin/audit/[id]` shows the full statement and details.
- UI built with the taste skills (`redesign-existing-projects` / `minimalist-ui`) on top of the existing
  phpMyAdmin-style design tokens and `docs/design/studies-db-phpmyadmin.dc.html`; light and dark.

## 4. SQL write console (server)

`apps/web/lib/admin-sql.ts` (pure where possible):

- `classifyStatement(sql): { ok: true; kind: 'select' | 'insert' | 'update' | 'delete' | 'replace'; table:
  string | null } | { ok: false; reason: string }`:
  - strips `--`, `#` and `/* */` comments, but rejects MariaDB executable comments `/*! … */`;
  - exactly one statement (a trailing `;` is allowed);
  - the first keyword must be SELECT, INSERT, UPDATE, DELETE or REPLACE;
  - rejects `INTO OUTFILE`, `INTO DUMPFILE`, `LOAD_FILE`, `LOAD DATA`, `SET`, `CALL`, `LOCK`, `HANDLER`, `DO`,
    `SLEEP(`, `BENCHMARK(`, as words outside string literals;
  - `table` is the target of single-table INSERT INTO / REPLACE INTO / UPDATE / DELETE FROM, else null.
- `previewSelect(sql, kind, table): string | null`: for single-table UPDATE/DELETE with a WHERE clause, returns
  `SELECT * FROM <table> WHERE <where> LIMIT 50` (WHERE taken up to a top-level ORDER BY/LIMIT); otherwise null.
- Confirmation token: `signPreview({ userId, sql, at })` → HMAC-SHA256 with a random per-process key cached on
  `globalThis`; `verifyPreview(token, { userId, sql, now })` is valid for 5 minutes and requires an exact `sql`
  match.
- Route `POST /api/admin/sql`, body `{ mode: 'preview' | 'execute', sql, token?, confirm? }`:
  - `requireAdmin()` (404 otherwise); rate limit 20/min per user with `createRateLimiter`; 503 when the RW pool
    is not configured;
  - rejected classification → 400 with the reason, and a `sql.rejected` audit row;
  - **select:** run on the RW pool, return rows (max 500);
  - **preview:** on a dedicated RW connection, `BEGIN`; run `previewSelect` if any; run the statement; read
    `affectedRows` (and `insertId`); for INSERT/REPLACE with no preview rows, return the inserted rows when
    `insertId` is known; `ROLLBACK` in `finally`. Returns kind, table, affected, rows, token;
  - **execute:** verify token (400 if invalid/expired/changed); if affected > 100 at preview time (carried in
    the token), require `confirm` to equal the table name (or `TAK`); `BEGIN`; run; `COMMIT`; then
    `writeAudit({ action: 'sql.execute', target: table, statement, rowsAffected })` on the main pool. Returns
    affected and audit id. On error: `ROLLBACK`, 400 with the Polish message from `lib/db-errors.ts`, no
    `sql.execute` audit row.
- The RW pool: `getRwPool()` in `lib/db.ts`, same options as the RO pool (`multipleStatements: false`,
  `supportBigNumbers`, `bigNumberStrings`, `connectionLimit: 3`).

## Error handling

- Database errors (permission denied, constraint violation, timeout) are mapped to Polish via `lib/db-errors.ts`.
  A permission error says the table is outside the console's scope.
- Every transaction is rolled back in `finally` unless committed.
- An unknown statement type never reaches the database.
- An audit write failure after a successful commit returns 500 with "Zmiana zapisana, ale nie udało się zapisać
  dziennika". This case is logged and covered by a test.

## Testing

- `packages/db`: as `studies_rw_test`, `UPDATE subjects` works; `SELECT`/`DELETE` on `sessions`, `users`,
  `admin_audit`, `bot_settings` are denied; `CREATE TABLE`, `DROP`, `ALTER` are denied; `SELECT … INTO OUTFILE`
  is denied. Also `writeAudit`/`listAudit` (order, filters, display name) and the `is_admin` default.
- `apps/web` unit: `classifyStatement` table (allowed kinds; comments; `/*! */`; two statements; keywords inside
  string literals are allowed; `INTO OUTFILE`; `SLEEP(`), `previewSelect` (WHERE with ORDER BY/LIMIT, no WHERE →
  null, multi-table → null), tokens (expiry, other user, changed SQL, tampered), `adminTabs`.
- `apps/web` route (test DB): non-admin → 404; preview leaves data unchanged; execute changes data and writes one
  audit row; changed SQL or expired token → 400; >100 rows without confirm → 400; denied table → 400 with the
  Polish message and no audit `sql.execute`; SELECT returns rows without audit.
- e2e (Playwright, existing global setup + an admin user): admin sees the Admin tab and Przegląd, runs preview →
  execute of an UPDATE and sees it in Dziennik; non-admin gets 404 on `/admin`; the simple sidebar shows "Panel
  admina" only for the admin.
- bot: `syncAdminFlag` sets/clears the flag from roles, makes no write when unchanged, sets nobody as admin when
  no role id is stored; `/setup` sets the caller's flag.
- Final review: the `sql-console-security-reviewer` agent on the whole branch and `discord-bot-reviewer` on the
  bot change; Critical/Important findings fixed before merge.

## Out of scope (rounds 2–3)

Editor forms and schedule editing; before/after diffs in the audit log; moderation actions; ops dashboard; DDL
in the console; multi-statement scripts; editing users/sessions/settings from the web.
