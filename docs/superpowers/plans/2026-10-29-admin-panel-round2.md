# Admin Panel Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the web `/admin` offers every Discord admin command. That means subjects, lecturers, classes, plan sync, ban and unban, plus setup, dry run and resync carried out by the bot. Every use is written to `admin_audit`.

**Architecture:**
- **packages/db:** the read helpers, the field rules (moved from the bot), and an admin request queue on top of `bot_requests` (one new `report` column).
- **Bot:** a second poller claims the admin kinds and runs the existing `runSetup` / `runResync`.
- **Web:** six pages and one `'use server'` module of admin actions.

**Tech stack:** TypeScript, Drizzle/MariaDB, Next 16 Server Actions, discord.js 14, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-admin-panel-round2-design.md`

## Global Constraints

- Every admin page and Server Action calls `requireAdmin()` itself; a non-admin gets `notFound()`.
- Admin writes go through the shared `packages/db` actions on the main pool (`getDb()`). Never through the SQL console pools.
- **Audit:**
  - write `admin_audit` only when the action returned `ok`;
  - `details` includes `source: 'web'`;
  - targets are what the bot writes: the subject code in upper case, `String(lecturerId)`, the Discord user id, or `bot_request:<id>`.
- **Admin request kinds:** `setup`, `setup_dry_run` and `resync`, with target `guild` and payload `{ requestedBy: <users.id> }`.
- **Exact copy:**
  - `The bot is already working on a request.`
  - `Cancelled.`
  - `The requester is no longer an admin.`
  - `The requester is not a member of the server.`
  - `You cannot block yourself.`
  - `The bot is not responding. Is it running?` (for a request queued > 60 s)
- **Report:** `report` holds at most 60 000 chars, truncated with `…`.
- **Language and checks:**
  - UI strings are English; subject and class names are shown as stored;
  - `pnpm check:lang`, `pnpm lint` and every typecheck pass.
- **Commits:**
  - `git -c commit.gpgsign=false commit …`, as DBOYttt, with no AI attribution;
  - never push;
  - work only in the worktree.
- **DB:**
  - tests use `resetTestDb()` and run sequentially;
  - never touch the `studies` dev DB;
  - migrations come only from `drizzle-kit generate`, never `push`.
- **UI work:**
  - invoke the `redesign-existing-projects` and `minimalist-ui` skills first;
  - reuse the round-1 patterns (`ScreenHeader`, `box`/`boxHead` classes, `errBox`) in light and dark mode;
  - read the Server Actions guide in `apps/web/node_modules/next/dist/docs/` before writing actions.

## Review Focus

1. **Two admins click "Run setup" at once:** only one request is queued, and the other admin sees the busy message. This is tested in Task 2 with concurrent calls.
2. **An admin blocks themselves through a crafted action call:** refused, and nothing is audited. This is tested in Task 4.
3. **A subject code in lower case or with spaces in the URL** (`/admin/subjects/ asd`): it resolves case-insensitively after trim, or gives 404. This is tested in Task 5.
4. **The bot restarts while a setup runs:** at boot the request is failed with the stale message and the Sync page shows it. This is tested in Task 3.
5. **A report longer than 60 000 chars:** it is stored truncated and the page still renders. This is tested in Task 2.

---

### Task 1: Shared field rules, plan status text, admin list helpers

**Files:**
- Create: `packages/db/src/admin-fields.ts`, holding the content of `apps/bot/src/commands/fields.ts` (`FIELD_MAX`, `SEMESTERS`, `ECTS_MIN`/`MAX`, `GROUP_MIN`/`MAX` and whatever else lives there).
  - `apps/bot/src/commands/fields.ts` becomes `export * from '@studies/db'`-style re-exports, so bot imports keep working.
- Modify: `packages/db/src/unitime/status.ts`. Add `planStatusText(s: PlanSyncStatus, now: Date): string`, moved verbatim with its formatter, from `apps/bot/src/commands/plan.ts`; the bot imports it from `@studies/db`.
- Create: `packages/db/src/admin-lists.ts`, exported from the index.
- Test: `packages/db/test/admin-lists.test.ts`

**Interfaces (produces):**

```ts
listSubjectsAdmin(db): Promise<{ id; code; name; semester; ects; forumLinked: boolean; classCount: number }[]>   // order by code
getSubjectAdmin(db, code: string): Promise<null | { id; code; name; semester; ects; description; platformUrl; forumLinked;
  classes: { id; kind; name; assessment; assessmentNote; platformUrl;
    groups: { id; number; name }[];
    lecturers: { lecturerId; name; title; groupName: string | null }[] }[] }>   // code matched case-insensitively after trim; classes in CLASS_KINDS order
listLecturersAdmin(db): Promise<{ id; title; name; email; officeHours; room }[]>   // order by name
getLecturerAdmin(db, id: number): Promise<... same row | null>
listUsersAdmin(db, o: { q?: string; limit: number; offset: number }): Promise<{ rows: { id; discordUserId; displayName; avatarUrl; isAdmin; isBanned; createdAt }[]; total: number }>
```

- For each column, use the schema's real names. Check `schema.ts` and adapt the field names, e.g. for avatar, office hours, `subjects.description`.
- `q` matches `display_name` or `discord_user_id` with LIKE, escaping `\`, `%` and `_`.

- [ ] **Step 1: Write the failing tests.**
  - Seed two subjects (one with a channel id); classes with groups; two lecturers assigned (one per group, one class-wide); three users.
  - Assert:
    - `forumLinked` and `classCount`;
    - `getSubjectAdmin(db, ' asd ')` finds `ASD`;
    - the lecturer `groupName` is null for a class-wide assignment;
    - `listUsersAdmin({ q: '50%' })` matches only the literal;
    - paging `total`.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement. Move `fields.ts` and `planStatusText`.
- [ ] **Step 4:** Run `pnpm --filter @studies/db exec vitest run test/admin-lists.test.ts` and the whole `pnpm --filter @studies/bot test` (to prove the re-exports work), plus the db and bot typechecks. All must pass.
- [ ] **Step 5:** Commit: `feat(db): admin list helpers; share field rules and plan status text`.

### Task 2: Admin bot request queue

**Files:**
- Modify: `packages/db/src/schema.ts`. Add `report: text('report')` to `botRequests`, then run `pnpm --filter @studies/db exec drizzle-kit generate --name bot_request_report` (check how the package runs drizzle-kit, e.g. a `db:generate` script). Commit the generated SQL and meta.
- Modify: `packages/db/src/bot-requests.ts`.
  - `finishBotRequest(db, id, status, error?, now?, report?)`. Keep the positional signature and add `report` last, truncated to 60 000 chars plus `…`.
  - Add:

```ts
export const ADMIN_REQUEST_KINDS = ['setup', 'setup_dry_run', 'resync'] as const;
export type AdminRequestKind = (typeof ADMIN_REQUEST_KINDS)[number];
export const BOT_BUSY_MESSAGE = 'The bot is already working on a request.';
enqueueAdminBotRequest(db: Db, kind: AdminRequestKind, userId: number): Promise<{ ok: true; id: number } | { ok: false; message: string }>
cancelAdminBotRequest(db: Db, id: number): Promise<boolean>   // true when it was queued and is now failed/'Cancelled.'
listAdminBotRequests(db: Db, limit = 20): Promise<(BotRequest & { report: string | null; requestedBy: number | null; requesterName: string | null })[]>
```

- **Enqueue:** inside a transaction, a locking read (`SELECT … FOR UPDATE` on `bot_requests` rows with `kind IN (admin kinds) AND status IN ('queued','running')`) refuses with `BOT_BUSY_MESSAGE`. Otherwise it inserts the row with target `guild` and payload `{ requestedBy: userId }`. Concurrent enqueues must yield exactly one row. If `FOR UPDATE` on an empty range does not serialize under MariaDB REPEATABLE READ, also take `GET_LOCK('admin_bot_request', 5)` on the same connection, and say so in the report.
- **`requesterName`:** joined from `users` through `JSON_EXTRACT(payload, '$.requestedBy')`.
- Test: `packages/db/test/admin-bot-requests.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - The second enqueue while one is queued gives `{ok:false, message: BOT_BUSY_MESSAGE}`, and the same while one is running.
  - An `event_post_upsert` queued does not block.
  - `Promise.all` of 2 enqueues → exactly one admin row.
  - Cancel: a queued request → true, status `failed`, error `Cancelled.`; a running one → false.
  - `finishBotRequest` with a 70 000-char report stores 60 001 chars ending in `…`.
  - The list is newest first, with `requesterName`.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the new test and `pnpm --filter @studies/db test`. Both must pass. Then run `pnpm --filter @studies/db exec tsx src/cli/migrate.ts`? **NO.** Never run the migrate CLI against a scratch DB: its user step REVOKEs the global users. `resetTestDb()` runs the migrations for tests.
- [ ] **Step 5:** Commit: `feat(db): admin bot requests with stored reports`.

### Task 3: Bot admin request poller

**Files:**
- Create: `apps/bot/src/admin-requests.ts`.
- Modify: the bot entry, where the event poller and `recoverInterruptedRequests` start; grep `startEventPoller`.
- Test: `apps/bot/test/admin-requests.test.ts`.

**Interfaces:**
- Consumes:
  - `ADMIN_REQUEST_KINDS`, `claimNextBotRequest(db, kinds)`, `finishBotRequest(…, report)` and `failStaleBotRequests(db, now, 0, kinds)` from Task 2;
  - `runSetup(deps, guild, callerId, dryRun, audit)`, `runResync(deps, audit)`, `withSetupLock` and `BUSY_TEXT` from `apps/bot/src/ops.ts`;
  - `writeAudit` from `@studies/db`.
- Produces:
  - `drainAdminRequests(deps, opts?)`, which processes until the queue is empty;
  - `startAdminRequestPoller(deps, intervalMs = 5000): { stop(): Promise<void> }`;
  - `recoverInterruptedAdminRequests(db)`.
  - Deps carry a `guildFetch` / `memberFetch` seam so tests use fakes. Follow how `EventPostDeps` does it.
- **Behaviour per request:**
  1. Read `requestedBy`. Load the user. If the user is not an admin → failed, `The requester is no longer an admin.`
  2. Fetch the guild member. If that fails → failed, `The requester is not a member of the server.`
  3. Run inside `withSetupLock`. On `'busy'` → failed, `BUSY_TEXT`.
  4. The audit callback writes `{ userId: requester, action, target, details: { ...details, source: 'web', requestId } }` and never throws.
  5. Finish `done` with `report`.
  6. If a run throws → failed, with a short English message (`Setup failed: <err.message first 200 chars>`). Log the full error.
- **Skip check:** before claiming, if a setup lock is already held, skip the tick. Export a `setupBusy()` from `ops.ts` for that.

- [ ] **Step 1: Write the failing tests** with fake deps:
  - setup / dry run / resync each store a report and an audit row with `source:'web'` and `requestId`;
  - a non-admin requester and a non-member each fail with the exact messages;
  - with the lock held, nothing is claimed;
  - a running admin request at boot gets the stale error;
  - event kinds are left untouched (an `event_post_upsert` stays queued).
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement and wire it into startup and shutdown.
- [ ] **Step 4:** Run `pnpm --filter @studies/bot test` and the bot typecheck. Both must pass.
- [ ] **Step 5:** Commit: `feat(bot): run setup, dry run and resync requested from the web`.

### Task 4: Web admin Server Actions

**Files:**
- Create: `apps/web/lib/admin-actions.ts` (`'use server'`).
- Create: `apps/web/lib/admin-forms.ts`, with pure parsers from `FormData` to the shared action inputs, using `FIELD_MAX`, `SEMESTERS`, `ECTS_MIN`/`MAX`, `GROUP_MIN`/`MAX` and `urlOrNull`/`textOrNull`/`emailOrNull`. An empty field means clear.
- Test: `apps/web/test/admin-actions.test.ts` (DB-backed, with `requireAdmin` mocked the same way other web tests mock the session).

**Interfaces (produces):** every action has the shape `(prev: ActionState, form: FormData) => Promise<ActionState>` for `useActionState`, with `type ActionState = { ok: boolean; message: string } | null`.
- **The actions:**
  - `addSubjectAction`
  - `editSubjectAction` (hidden `code`)
  - `editClassAction` (hidden `code`, `kind`)
  - `addLecturerAction`
  - `editLecturerAction` (hidden `id`)
  - `assignLecturerAction` (hidden `code`; `lecturerId`, `kind`, optional `group`)
  - `setBanAction` (`discordUserId`, `banned` = `'1'`/`'0'`)
  - `requestPlanSyncAction`
  - `requestBotAction` (`kind` ∈ `ADMIN_REQUEST_KINDS`)
  - `cancelBotRequestAction` (`id`)
- **Each action:**
  - calls `requireAdmin()`, parses, calls the shared `packages/db` action, audits when ok, and calls `revalidatePath` on the relevant `/admin/...` paths;
  - a parse failure returns `{ok:false, message}` with a specific English message (e.g. `ECTS must be a whole number from 0 to 30.`);
  - `setBanAction` refuses `user.discordUserId === discordUserId` with `You cannot block yourself.`;
  - `requestPlanSyncAction` returns the message `Timetable sync requested (the worker will run it within a minute).`;
  - `requestBotAction` audits `bot.request` with `details { kind, source:'web' }`, target `bot_request:<id>`.

- [ ] **Step 1: Write the failing tests:**
  - each action → the expected DB change + one audit row with the right action, target and `source:'web'`;
  - invalid ECTS, semester 3, a bad URL and an overlong name → refused, with no audit row;
  - self-ban → refused;
  - a non-admin (mock `requireAdmin` throwing the notFound error) → it propagates;
  - `requestBotAction` twice → the second is refused with `The bot is already working on a request.`
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test file and the web typecheck. Both must pass.
- [ ] **Step 5:** Commit: `feat(web): admin Server Actions for subjects, lecturers, users and sync`.

### Task 5: Web pages (Subjects, Lecturers)

**Files:**
- Create:
  - `apps/web/app/(app)/admin/subjects/page.tsx`
  - `apps/web/app/(app)/admin/subjects/[code]/page.tsx`
  - `apps/web/app/(app)/admin/lecturers/page.tsx`
  - `apps/web/app/(app)/admin/lecturers/[id]/page.tsx`
  - client form components in `apps/web/components/admin/` (`SubjectForm.tsx`, `ClassForm.tsx`, `AssignLecturerForm.tsx`, `LecturerForm.tsx`, plus a shared `ActionForm` wrapper that uses `useActionState`, shows `role="status"` or `role="alert"`, and has a pending-aware submit with `aria-disabled`).
- Modify: `apps/web/components/shell/admin-tabs.ts`.
  - Tabs, in order: Overview, Subjects (`/admin/subjects`), Lecturers (`/admin/lecturers`), Users (`/admin/users`), Sync (`/admin/sync`), SQL — write, Audit log.
  - `AdminTab` gains `'subjects' | 'lecturers' | 'users' | 'sync'`.
  - Use Phosphor SSR icons (Books, ChalkboardTeacher, Users, ArrowsClockwise).
- **Pages:**
  - Every page: `await requireAdmin()`, `export const dynamic = 'force-dynamic'`, and `notFound()` for a missing code or id.
  - Subjects list: a table plus an "Add subject" form. On success it says `Subject added. Run setup on the Sync tab to create its forum.` with a link.
  - Subject page: the edit form, then one card per class with the class form, its lecturers and the assign form.
  - Lecturers: a table plus an add form; the edit page has the same fields.
- Test: `apps/web/e2e/admin-round2.spec.ts`, partly here: add a subject, edit it, add a lecturer, assign them, edit a class, then check the audit log rows. Check how `admin.spec.ts` logs in an admin.

- [ ] **Step 1: Write the e2e** for the subjects/lecturers flow, with exact visible texts. It fails.
- [ ] **Step 2:** Implement the pages and forms, after the UI skills.
- [ ] **Step 3:** Run `pnpm --filter @studies/web e2e e2e/admin-round2.spec.ts e2e/admin.spec.ts`, then typecheck, lint and check:lang. All must pass.
- [ ] **Step 4:** Commit: `feat(web): admin subjects and lecturers pages`.

### Task 6: Web pages (Users, Sync), audit labels, docs

**Files:**
- Create: `apps/web/app/(app)/admin/users/page.tsx`, with `?q=` search and `?page=` paging, 50 per page. The block/unblock button sits behind a confirm (a `<dialog>`, or a two-step "Block" → "Confirm block" button; pick the existing confirm pattern if there is one, so grep for `confirm`). Use `setBanAction`.
- Create: `apps/web/app/(app)/admin/sync/page.tsx`.
  - The plan status card (`planStatusText`) with a "Sync timetable" button.
  - The three buttons: "Preview changes", "Run setup" (with a confirm) and "Fetch from Discord". They use `aria-disabled` while an admin request is queued or running.
  - The request table: status, kind, requester, created/started/finished times (Warsaw), error, and the report in `<details><pre>`.
  - "Cancel" on queued requests.
  - The stale notice when queued > 60 s.
  - `components/admin/AutoRefresh.tsx` (client): `router.refresh()` every 3000 ms while `active`.
- Modify: `apps/web/lib/admin-audit.ts`. `AUDIT_ACTIONS` (the filter options) gains the new actions written from the web: `subject.add`, `subject.edit`, `class.edit`, `lecturer.add`, `lecturer.edit`, `lecturer.assign`, `user.ban`, `user.unban`, `plan.sync`, `bot.request`, `bot.request_cancel`, `bot.setup`, `bot.setup_dry_run`, `bot.resync`. Labels: `bot.request` = `Bot request queued`, `bot.request_cancel` = `Bot request cancelled`; reuse the labels that already exist in `ACTION_NAMES`.
- Modify: `CLAUDE.md`, the admin panel bullet.
  - It lists the new pages.
  - It says admin changes go through the shared `packages/db` actions on the main pool and are audited with `source: 'web'`.
  - It says setup, dry run and resync are queued in `bot_requests` (kinds `setup`, `setup_dry_run`, `resync`, target `guild`, `report` column) and run by `apps/bot/src/admin-requests.ts`.
- Modify: the user memory? **NO.** The controller handles memory.
- Test: extend `e2e/admin-round2.spec.ts`:
  - block and unblock a seeded user;
  - queue a dry run, see `queued`, cancel it and see `Cancelled.`;
  - the audit log shows `Bot request queued`;
  - a student gets 404 on `/admin/subjects`, `/admin/lecturers`, `/admin/users` and `/admin/sync`.
- Test: `apps/web/test/admin-audit.test.ts`, the filter labels for the new actions.

- [ ] **Step 1: Write the failing tests.**
- [ ] **Step 2:** Implement, after the UI skills.
- [ ] **Step 3:** Run the full `pnpm --filter @studies/web test`, `pnpm --filter @studies/web e2e`, the typechecks, lint and check:lang. All must pass.
- [ ] **Step 4:** Commit: `feat(web): admin users and sync pages`.
