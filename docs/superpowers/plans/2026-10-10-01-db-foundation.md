# Studies DB — Plan 1: Monorepo & Database Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm monorepo with a `@studies/db` package that owns the MariaDB schema, migrations, public views, the read-only `studies_ro` user, and the shared domain helpers (file planning, storage paths, auth tokens, search) used by the bot, worker and web.

**Architecture:** Drizzle ORM (mysql2 driver) defines tables in TypeScript; drizzle-kit generates SQL migrations; one hand-written custom migration creates FULLTEXT indexes and `v_*` views; a TS script creates/grants `studies_ro`. Shared logic lives in this package so all three apps use identical rules.

**Tech Stack:** Node 22, pnpm 12 (corepack), TypeScript 7, ESM, drizzle-orm 0.45, drizzle-kit 0.31, mysql2 3, Vitest 5, Biome 2, MariaDB 11 (Podman).

**Spec:** `docs/superpowers/specs/2026-10-10-studies-db-design.md` (§3, §4, §7 auth, §7 search, §10)

## Global Constraints

- TypeScript everywhere, ESM (`"type": "module"`), `strict: true`.
- Package manager: pnpm via corepack; workspace packages are named `@studies/<name>`.
- Database: MariaDB 11; charset `utf8mb4`, collation `utf8mb4_unicode_ci` (Polish text).
- Discord snowflakes are stored as `VARCHAR(32)` strings, never numbers.
- Soft delete via `deleted_at`; nothing in app code hard-deletes materials/topics.
- Storage layout: `originals/<sha256>.<ext>` and `previews/<sha256>.pdf`, paths stored **relative** to `STORAGE_DIR`.
- Login token TTL 15 min, one-time; session TTL 30 days; only sha256 hashes of tokens stored.
- Extracted text cap: 1 MB (1 048 576 bytes UTF-8).
- `studies_ro` has `SELECT` only on the `v_*` views — never on base tables.
- Dev DB: Podman container `studies-mariadb`, host port **3307**, databases `studies` (dev) and `studies_test` (tests).

## Review Focus

1. **Search input with Polish diacritics, short words or FULLTEXT operator characters** (`"`, `+`, `-`, `*`, `(`) — expected: no SQL error, sensible results; empty/whitespace query returns `[]`. → Task 5 tests.
2. **Same Discord attachment inserted twice concurrently** (live event racing startup catch-up) — expected: second insert is a no-op, not a crash. → Task 3 test (`insertMaterial` duplicate returns `'exists'`).
3. **Login token reused or used after 15 min, session of a banned user** — expected: rejected. → Task 4 tests.
4. **`studies_ro` tries to read `sessions`/`jobs`/`materials` base table or write to a view** — expected: permission error. → Task 3 tests.
5. **Filename with no extension, uppercase extension, or double extension (`notes.tar.gz`, `SLAJDY.PPTX`)** — expected: correct preview kind and stored extension. → Task 2 tests.

---

### Task 1: Monorepo scaffold + dev database

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.env.example`, `compose.yaml`, `scripts/db-up.sh`
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.config.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/smoke.test.ts`

**Interfaces:**
- Produces: root scripts `pnpm db:up`, `pnpm test`, `pnpm lint`; env vars `DATABASE_URL`, `DATABASE_ADMIN_URL`, `DB_RO_PASSWORD`, `TEST_DATABASE_URL`, `STORAGE_DIR`.

- [ ] **Step 1:** `corepack enable && corepack prepare pnpm@12 --activate`; create root `package.json` (`private`, `"type":"module"`, `packageManager: "pnpm@12.11.2"`, scripts: `test: "pnpm -r --workspace-concurrency=1 test"`, `lint: "biome check ."`, `db:up: "sh scripts/db-up.sh"`, `db:migrate: "pnpm --filter @studies/db migrate"`), `pnpm-workspace.yaml` (`packages/*`, `apps/*`), `tsconfig.base.json` (`target ES2023`, `module/moduleResolution NodeNext`, `strict`, `skipLibCheck`), `biome.json` (recommended rules, 2-space indent, single quotes).
- [ ] **Step 2:** `compose.yaml` with service `mariadb` (`docker.io/library/mariadb:11`, container_name `studies-mariadb`, ports `3307:3306`, env `MARIADB_ROOT_PASSWORD=devroot`, `MARIADB_DATABASE=studies`, command `--character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --innodb-ft-min-token-size=2`, named volume `mariadb-data`). `scripts/db-up.sh`: `podman compose up -d mariadb`, wait until `podman exec studies-mariadb mariadb-admin ping -pdevroot` succeeds, then `CREATE DATABASE IF NOT EXISTS studies_test`.
- [ ] **Step 3:** `.env.example`:
  ```
  DATABASE_URL=mysql://root:devroot@127.0.0.1:3307/studies
  DATABASE_ADMIN_URL=mysql://root:devroot@127.0.0.1:3307/studies
  DB_RO_PASSWORD=change-me-ro
  DATABASE_RO_URL=mysql://studies_ro:change-me-ro@127.0.0.1:3307/studies
  TEST_DATABASE_URL=mysql://root:devroot@127.0.0.1:3307/studies_test
  STORAGE_DIR=./storage
  ```
  Copy to `.env`.
- [ ] **Step 4:** `packages/db` package `@studies/db` (deps `drizzle-orm`, `mysql2`; dev `drizzle-kit`, `vitest`, `typescript`, `tsx`); exports `"."` → `src/index.ts` (consumed as TS source via tsx/Next transpilePackages — no build step). Write `test/smoke.test.ts`: connects with `mysql2/promise` to `TEST_DATABASE_URL`, `SELECT 1 AS ok` → `expect(rows[0].ok).toBe(1)`.
- [ ] **Step 5:** Run `pnpm install && pnpm db:up && pnpm --filter @studies/db test` → Expected: 1 passed.
- [ ] **Step 6:** Commit `chore: scaffold monorepo and dev mariadb`.

---

### Task 2: File planning & storage paths (pure helpers)

**Files:**
- Create: `packages/db/src/files.ts`
- Test: `packages/db/test/files.test.ts`

**Interfaces:**
- Produces:
  - `type PreviewKind = 'pdf' | 'image' | 'text' | 'none'`
  - `type JobType = 'convert' | 'extract_text'`
  - `fileExtension(filename: string): string` — lowercase, no dot, last segment; `''` if none.
  - `planProcessing(filename: string, mime: string): { previewKind: PreviewKind; jobs: JobType[] }`
  - `originalRelPath(sha256: string, ext: string): string` → `originals/<sha>.<ext>` (or `originals/<sha>` when ext is `''`)
  - `previewRelPath(sha256: string): string` → `previews/<sha>.pdf`

- [ ] **Step 1: Write failing tests** (table-driven):
  ```ts
  expect(planProcessing('w1.pdf','application/pdf')).toEqual({ previewKind:'pdf', jobs:['extract_text'] })
  expect(planProcessing('SLAJDY.PPTX','')).toEqual({ previewKind:'pdf', jobs:['convert'] })   // extract_text is enqueued by convert later
  expect(planProcessing('lab.docx','')).toEqual({ previewKind:'pdf', jobs:['convert'] })
  expect(planProcessing('dane.xlsx','')).toEqual({ previewKind:'pdf', jobs:['convert'] })
  expect(planProcessing('notatki.md','text/markdown')).toEqual({ previewKind:'text', jobs:['extract_text'] })
  expect(planProcessing('main.cpp','')).toEqual({ previewKind:'text', jobs:['extract_text'] })
  expect(planProcessing('tablica.JPG','image/jpeg')).toEqual({ previewKind:'image', jobs:[] })
  expect(planProcessing('archiwum.tar.gz','')).toEqual({ previewKind:'none', jobs:[] })
  expect(planProcessing('Makefile','')).toEqual({ previewKind:'none', jobs:[] })
  expect(planProcessing('dziwny.bin','text/plain')).toEqual({ previewKind:'text', jobs:['extract_text'] }) // mime text/* wins when ext unknown
  expect(fileExtension('notes.tar.gz')).toBe('gz'); expect(fileExtension('Makefile')).toBe('')
  expect(originalRelPath('ab'.repeat(32),'pdf')).toBe(`originals/${'ab'.repeat(32)}.pdf`)
  ```
- [ ] **Step 2:** `pnpm --filter @studies/db test files` → FAIL (module not found).
- [ ] **Step 3: Implement** in `files.ts`. Extension sets: office = `doc docx odt rtf ppt pptx odp xls xlsx ods`; text = `txt md csv json xml yaml yml c h cpp hpp py js ts java m tex log ini`; image = `png jpg jpeg gif webp svg`.
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(db): file processing planner and storage paths`.

---

### Task 3: Schema, migrations, views, read-only user

**Files:**
- Create: `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/drizzle.config.ts`, `packages/db/src/migrate.ts`, `packages/db/src/readonly-user.ts`, `packages/db/src/materials.ts`
- Create (generated + custom): `packages/db/migrations/0000_*.sql`, `packages/db/migrations/0001_views_fulltext.sql`
- Create: `packages/db/src/testing.ts` (package export `"./testing"`, used by other packages' tests)
- Test: `packages/db/test/schema.test.ts`

**Interfaces:**
- Consumes: `PreviewKind`, `JobType` from Task 2.
- Produces:
  - Drizzle tables exported from `schema.ts`: `subjects, lecturers, subjectLecturers, topics, tags, topicTags, users, materials, jobs, loginTokens, sessions, botState` — columns exactly as spec §4 (camelCase in TS, snake_case in SQL), `PUBLIC_VIEWS = ['v_subjects','v_lecturers','v_subject_lecturers','v_topics','v_tags','v_topic_tags','v_materials','v_users'] as const`.
  - `createDb(url: string): { db: Db; pool: mysql.Pool }` where `type Db = MySql2Database<typeof schema>`.
  - `runMigrations(adminUrl: string): Promise<void>` (drizzle migrator).
  - `ensureReadonlyUser(adminUrl: string, roPassword: string): Promise<void>`.
  - `insertMaterial(db: Db, values: NewMaterial, jobs: JobType[]): Promise<{ status: 'created' | 'exists'; materialId: number }>` — inserts material + jobs in one transaction; on duplicate `discord_attachment_id` returns `'exists'` with the existing id; when `jobs` is empty inserts material with `status='ready'`.
  - `@studies/db/testing`: `resetTestDb(): Promise<Db>` — drops & recreates the DB in `TEST_DATABASE_URL`, runs migrations, runs `ensureReadonlyUser(url, 'test-ro')`, returns db. Test DB `studies_test` is shared, so each package's vitest config sets `fileParallelism: false`, and root `pnpm test` runs packages sequentially (`pnpm -r --workspace-concurrency=1 test`).
  - CLI: `pnpm --filter @studies/db migrate` runs `runMigrations(DATABASE_ADMIN_URL)` then `ensureReadonlyUser(...)`.

- [ ] **Step 1: Write failing tests** in `schema.test.ts` (use `resetTestDb()` in `beforeAll`; ro user created against test DB with password `test-ro`):
  - `it('creates all tables and views')` — `SHOW FULL TABLES` contains every table name and every `PUBLIC_VIEWS` entry with `Table_type='VIEW'`.
  - `it('v_materials hides paths, text and soft-deleted rows')` — insert subject/topic/user/2 materials (one with `deletedAt`), `SELECT * FROM v_materials` returns 1 row, its keys do not include `storage_path`, `preview_path`, `extracted_text`, `sha256`.
  - `it('v_users hides discord ids and ban flag')`.
  - `it('studies_ro can select views only')` — connect as `studies_ro`: `SELECT COUNT(*) FROM v_subjects` ok; `SELECT * FROM sessions`, `SELECT * FROM materials`, `SELECT * FROM jobs` each reject with `/denied/i`; `DELETE FROM v_subjects` rejects with `/denied/i`.
  - `it('insertMaterial is idempotent on attachment id')` — two `Promise.all` inserts of the same `discordAttachmentId` → statuses `['created','exists']` in some order, same `materialId`, one row, jobs inserted once.
  - `it('insertMaterial with no jobs marks ready')`.
  - `it('polish text round-trips')` — subject name `'Żółć – ćwiczenia ąę'` reads back identical.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Write `schema.ts` per spec §4 (mysqlEnum for enums; FKs with `onDelete: 'cascade'` where spec says; indexes on `materials.sha256`, `materials.discord_message_id`, `jobs(status, run_after)`); `client.ts`; `drizzle.config.ts` (out `./migrations`, dialect `mysql`). Run `pnpm drizzle-kit generate` → `0000_*.sql`. Then `pnpm drizzle-kit generate --custom --name views_fulltext` and fill it with: `ALTER TABLE materials ADD FULLTEXT ft_materials (original_filename, extracted_text)`, `ALTER TABLE topics ADD FULLTEXT ft_topics (title)`, and `CREATE OR REPLACE VIEW` for each public view (column lists per spec §4 "Public views"; `v_topics`/`v_materials` filter `deleted_at IS NULL`). Statements separated by `--> statement-breakpoint`.
- [ ] **Step 4:** `ensureReadonlyUser`: `CREATE USER IF NOT EXISTS 'studies_ro'@'%' IDENTIFIED BY ?`, `ALTER USER … IDENTIFIED BY ?` (keeps password in sync), then for each `PUBLIC_VIEWS` entry `GRANT SELECT ON \`<db>\`.\`<view>\` TO 'studies_ro'@'%'` (db name parsed from URL). `insertMaterial`: catch mysql2 error `code === 'ER_DUP_ENTRY'` → select existing id.
- [ ] **Step 5:** Run tests → PASS. Run `pnpm db:migrate` against dev DB → succeeds twice in a row (idempotent).
- [ ] **Step 6:** Commit `feat(db): schema, migrations, public views, read-only user`.

---

### Task 4: Auth tokens & sessions

**Files:**
- Create: `packages/db/src/auth.ts`
- Test: `packages/db/test/auth.test.ts`

**Interfaces:**
- Consumes: `Db`, tables `users, loginTokens, sessions`.
- Produces:
  - `LOGIN_TOKEN_TTL_MS = 15 * 60_000`, `SESSION_TTL_MS = 30 * 24 * 3600_000`
  - `hashToken(token: string): string` — sha256 hex.
  - `upsertUser(db: Db, u: { discordUserId: string; displayName: string; avatarUrl: string | null }): Promise<number>` — returns user id; updates name/avatar on conflict.
  - `createLoginToken(db: Db, userId: number, now?: Date): Promise<string>` — 32 random bytes base64url; stores hash.
  - `consumeLoginToken(db: Db, token: string, now?: Date): Promise<{ sessionToken: string; expiresAt: Date } | null>` — null if unknown, used, expired, or user banned; marks used and creates session atomically (`UPDATE … SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?`, check affectedRows=1).
  - `getSessionUser(db: Db, sessionToken: string, now?: Date): Promise<{ id: number; displayName: string; avatarUrl: string | null } | null>` — null if missing/expired/banned.
  - `deleteSession(db: Db, sessionToken: string): Promise<void>`
  - `setBanned(db: Db, discordUserId: string, banned: boolean): Promise<boolean>` — false if user unknown; banning deletes all their sessions.

- [ ] **Step 1: Write failing tests:** valid token → session, `getSessionUser` returns user; same token second time → `null`; token at `now + 15min + 1ms` → `null`; banned user's token → `null`; `setBanned(true)` makes existing session return `null`; session at `now + 30d + 1ms` → `null`; DB stores no raw token (`SELECT token_hash` ≠ token, length 64); `upsertUser` twice with new name → same id, name updated.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement using `node:crypto` (`randomBytes`, `createHash`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(db): login tokens and sessions`.

---

### Task 5: Full-text search

**Files:**
- Create: `packages/db/src/search.ts`
- Test: `packages/db/test/search.test.ts`

**Interfaces:**
- Consumes: `Db`, tables.
- Produces:
  - `type SearchHit = { materialId: number | null; topicId: number; topicTitle: string; subjectCode: string; subjectName: string; filename: string | null; snippet: string; score: number }`
  - `searchAll(db: Db, opts: { q: string; subjectId?: number; tagId?: number; limit?: number }): Promise<SearchHit[]>` — default limit 20; ignores soft-deleted rows; merges material hits (`MATCH(original_filename, extracted_text) AGAINST (? IN NATURAL LANGUAGE MODE)`) and topic-title hits (`materialId: null`), sorted by score desc.
  - `buildSnippet(text: string, q: string, radius?: number): string` — default radius 120; case- and diacritic-insensitive locate of first query word (normalize with `NFD` + strip combining marks for matching, slice original text); wrap match in `«…»`; prefix/suffix `…` when cut; falls back to first `2*radius` chars.

- [ ] **Step 1: Write failing tests:**
  - `buildSnippet('Ala ma kota. Kolokwium z mechaniki będzie we wtorek.', 'kolokwium', 10)` contains `'«Kolokwium»'` and starts with `'…'`.
  - `buildSnippet('Zadanie: łożysko toczne', 'lozysko')` contains `'«łożysko»'`.
  - seeded DB (2 subjects, topics, materials with extracted text incl. one soft-deleted containing "tarcie"): `searchAll({q:'tarcie'})` returns only the non-deleted material; `searchAll({q:'statyka'})` returns the topic titled `'W1 – Statyka'` with `materialId: null`; `subjectId` filter excludes other subject; `tagId` filter works.
  - `searchAll({q:'   '})` → `[]`; `searchAll({q:'"+-*()'})` → `[]` without throwing; `searchAll({q:'PLC'})` (short token) finds material with "sterownik PLC".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Sanitise `q`: strip `+-<>()~*"@`, collapse whitespace; empty → `[]`. Snippet built from `extracted_text` (or filename/title when null).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Export everything from `src/index.ts` (`schema`, `createDb`, `files`, `auth`, `search`, `insertMaterial`, `PUBLIC_VIEWS`); `pnpm lint && pnpm test` → all green.
- [ ] **Step 6:** Commit `feat(db): full-text search with snippets`.
