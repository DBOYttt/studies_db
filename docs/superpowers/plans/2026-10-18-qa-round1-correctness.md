# QA Round 1 (Correctness and Security) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the correctness and security findings of QA run 2026-10-16 (H1, M1, M2, M17, M19, L1, L4, L22), plus
the form-reset bug.

**Architecture:** DB logic changes live in `packages/db` (transaction retry, version column, optimistic checks,
series `until`). Web changes are in `apps/web/lib` (actions, SQL handlers, origin check) and `components/events`.
The bot only threads a version through its edit modal id.

**Tech Stack:** TypeScript, Drizzle + MariaDB, Next 16 Server Actions, React 19, discord.js 14, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-qa-round1-correctness-design.md`

## Global Constraints

- New and changed user-facing messages are English. Bot (Discord) text stays Polish, except messages that come from
  `packages/db` (shared refusals): those are English.
- Never `drizzle-kit push`. Generate the migration with `drizzle-kit generate` from `packages/db`.
- Test files run with `fileParallelism: false`; DB tests use `resetTestDb()`.
- Never run user SQL on the main pool.
- Commits as DBOYttt, no Claude attribution, signed (1Password). If signing fails, ask the user to unlock; never
  bypass.

## Review Focus

1. A retried transaction must not double-audit or double-enqueue: everything in `fn` is inside the transaction, so a
   retry starts clean. Test in Task 1 counts audit rows after a forced retry.
2. A version mismatch on a series "following" edit must leave both the series and the split untouched (Task 2 test).
3. A refused save after the form switched to `onSubmit` must still show the server message and keep every field,
   including selects driven by React state (subject/class/group) (Task 3 e2e).
4. The sanitizer must not eat legitimate text in syntax errors, e.g. `near 'FROM users'` (Task 6 test).
5. `Sec-Fetch-Site` alone (no `Origin`) from a same-origin browser fetch must be accepted (Task 7 test).

---

### Task 1: Transaction retry (H1)

**Files:**
- Create: `packages/db/src/tx.ts`
- Modify: `packages/db/src/events.ts` (every `db.transaction(` → `withTxRetry(db, `), `packages/db/src/event-series.ts`
  (same), `packages/db/src/index.ts` (export)
- Test: `packages/db/test/tx.test.ts`

**Interfaces:**
- Produces: `withTxRetry<T>(db: Db, fn: (tx: Tx) => Promise<T>, opts?: { attempts?: number; pause?: () => Promise<void> }): Promise<T>`
  and `isRetryableTxError(err: unknown): boolean` (errno 1020, 1213 or 1205 on the error or on `err.cause`, any depth ≤ 3).

- [ ] **Step 1: Write the failing tests** in `tx.test.ts`:
  - `isRetryableTxError` true for `{ errno: 1020 }`, `{ cause: { errno: 1213 } }`, `{ cause: { cause: { errno: 1205 } } }`;
    false for `{ errno: 1062 }` and `new Error('x')`.
  - fake db whose `transaction` throws `{ errno: 1020 }` twice then returns `'ok'` → `withTxRetry` resolves `'ok'`,
    `transaction` called 3 times (pass `pause: async () => {}`).
  - fake db that always throws 1020 → rejects with that error after 3 calls; throws 1062 → rejects after 1 call.
  - integration (real test DB): 10 rounds of `Promise.all([addEvent(db, u, inputA, 'web'), addEvent(db, u2, inputB, 'web')])`
    (two different users, so the hourly rate limit isn't hit; `inputA`/`inputB` valid future events) → every result
    `ok: true`; the number of `event.add` audit rows equals the number of events.
- [ ] **Step 2: Run** `pnpm --filter @studies/db exec vitest run test/tx.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `tx.ts`**; default pause = random 20–80 ms. Replace every `db.transaction(` in
  `events.ts` and `event-series.ts` with `withTxRetry(db, …)` (functions that receive a `tx` already keep using it).
- [ ] **Step 4: Run** `pnpm --filter @studies/db test` — expect PASS (all existing event tests still pass).
- [ ] **Step 5: Commit** `fix(db): retry event transactions on snapshot conflicts and deadlocks`.

### Task 2: Version column and optimistic edits/deletes (M1, db side)

**Files:**
- Modify: `packages/db/src/schema.ts` (`events`, `eventSeries`: `version: int('version').notNull().default(0)`)
- Create: migration via `pnpm --filter @studies/db exec drizzle-kit generate --name event_version`
- Modify: `packages/db/src/events.ts`, `packages/db/src/event-series.ts`
- Test: `packages/db/test/events.test.ts`, `packages/db/test/event-series.test.ts`

**Interfaces:**
- Consumes: `withTxRetry` (Task 1).
- Produces:
  - `export const CONFLICT = "Someone changed this event while you were editing. Your changes weren't saved — reload to see the current version.";` in `events.ts`.
  - `editEvent(db, userId, eventId, patch, source, scope = 'one', opts: { expectedVersion?: number } = {})`
  - `deleteEvent(db, userId, eventId, source, scope = 'one', opts: { expectedVersion?: number } = {})`
  - `editInSeries` / `deleteInSeries` gain the same trailing `opts`.
  - `getEvent(...)` result gains `version: number`.

Rules: every UPDATE of an `events` row sets `version = version + 1` (edit, delete, restore, link, unlink, series
edits/splits, `reviveSeries`); series-level updates also bump `event_series.version`. With `expectedVersion`, the
transaction first reads the row with `SELECT version, deleted_at … FOR UPDATE`; deleted → `refused(NOT_FOUND)`,
`version !== expectedVersion` → `refused(CONFLICT)`, both before any write (so no audit or enqueue happens).
The "Brak zmian" early return also checks the version first when `expectedVersion` is given.

- [ ] **Step 1: Write the failing tests:**
  - `editEvent` with `expectedVersion` = current → ok, `getEvent().version` is current + 1.
  - `editEvent` with a stale version → `{ ok: false, message: CONFLICT }`, title unchanged, no new `event.edit`
    audit row, no new `bot_requests` row.
  - `editEvent` without `expectedVersion` after another edit → ok (no check).
  - `deleteEvent` with a stale version → CONFLICT, event not deleted.
  - `linkTopic` bumps the version.
  - series: `editInSeries` scope `'one'` and `'following'` with a stale version → CONFLICT, the series row count
    and `until` unchanged.
- [ ] **Step 2: Run** `pnpm --filter @studies/db exec vitest run test/events.test.ts test/event-series.test.ts` — FAIL.
- [ ] **Step 3: Implement**: schema columns, generate migration (check the SQL is only two `ALTER TABLE … ADD
  version int NOT NULL DEFAULT 0`), then the version logic.
- [ ] **Step 4: Run** `pnpm db:migrate` is NOT needed for tests (`resetTestDb` migrates); run
  `pnpm --filter @studies/db test` — PASS.
- [ ] **Step 5: Commit** `feat(db): event version for optimistic edit and delete`.

### Task 3: Forms keep their input on a refusal

**Files:**
- Modify: `apps/web/components/events/EventForm.tsx` and every client component found by
  `grep -rn "action={" apps/web/components apps/web/app --include=*.tsx` whose action can return a refusal
- Test: `apps/web/e2e/events.spec.ts` (add a test; create the file if no events spec exists — check `ls apps/web/e2e`)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing e2e test** `refused event save keeps the typed values`: log in, open
  `/s/wydarzenia/nowe`, pick a subject, type title `x`.repeat(101) — or, if the input has `maxLength`, use a date
  more than a month in the past — submit → the refusal message is visible AND the title input still has the typed
  value AND the subject select still has the picked subject.
- [ ] **Step 2: Run** `pnpm --filter @studies/web e2e e2e/events.spec.ts` — FAIL (field reset).
- [ ] **Step 3: Implement**: `<form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}>`
  in `EventForm`; same pattern for each refusable form from the grep. List the forms changed in the commit body.
- [ ] **Step 4: Run** the e2e file and `pnpm --filter @studies/web test` — PASS.
- [ ] **Step 5: Commit** `fix(web): refused forms keep what the user typed`.

### Task 4: Web version wiring and the deleted-event edit page (M1 web, M2)

**Files:**
- Modify: `apps/web/lib/event-form-page.ts` (`loadEventForm`), `apps/web/components/events/EventForm.tsx`
  (`EventFormValues.version?: number`, hidden input `version`; `deleted?: boolean` prop),
  `apps/web/lib/event-actions.ts` (`updateEventAction`, `deleteEventAction`), the delete button in
  `apps/web/components/events/EventButtons.tsx`, both edit pages
  (`app/(simple)/s/wydarzenia/[id]/edytuj/page.tsx`, `app/(app)/wydarzenia/[id]/edytuj/page.tsx`)
- Test: `apps/web/test/event-actions.test.ts`, `apps/web/e2e/events.spec.ts`

**Interfaces:**
- Consumes: `editEvent`/`deleteEvent` `opts.expectedVersion`, `CONFLICT`, `getEvent().version` (Task 2).
- Produces: `loadEventForm(id): Promise<{ values: EventFormValues; deleted: boolean }>` (unknown id → `notFound()`;
  soft-deleted → `deleted: true` with the deleted row's values). `deleteEventAction(id, base, scope, version?: number)`.

Parse `version` from the form with the existing int helper; a missing or non-integer value → no `expectedVersion`.
Deleted page: the form is rendered with Save disabled and a banner above it, text exactly
"This event was deleted. Your changes weren't saved." with a "Back to plan" link (`planHref(base)`) and, for admins,
a "Restore" button calling `restoreEventAction(id)`.

- [ ] **Step 1: Write the failing tests:**
  - unit (`event-actions.test.ts`): `updateEventAction` with a stale `version` field returns `{ ok: false, message: CONFLICT }`;
    with the current one it redirects (expect the redirect error the existing tests already catch).
  - e2e `editing a deleted event shows the banner`: context A opens the edit page of event E, context B deletes E,
    A types a new title and saves → the page shows the banner text, the typed title is still in the input, no 404.
  - e2e `two tabs editing one event`: A and B open the edit page, B saves, A saves → A shows the CONFLICT message.
- [ ] **Step 2: Run** the unit file and the e2e file — FAIL.
- [ ] **Step 3: Implement** as described.
- [ ] **Step 4: Run** `pnpm --filter @studies/web test`, the e2e file, `pnpm --filter @studies/web typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(web): edit conflicts and deleted events no longer lose edits`.

### Task 5: Bot edit modal carries the version

**Files:**
- Modify: `apps/bot/src/ui/events.ts` (`parseEventAction` `save` case, the edit submit and delete handlers), the
  modal builder that encodes `evt:save:<id>[:<scope>]` (find with `grep -rn "'save'" apps/bot/src/ui/views`),
  the delete-confirm button builder (`delok`)
- Test: `apps/bot/test/` (the existing events UI test file; `ls apps/bot/test | grep -i event`)

**Interfaces:**
- Consumes: `opts.expectedVersion`, `getEvent().version` (Task 2).
- Produces: id shapes `evt:save:<id>:<scope>:v<version>` and `evt:delok:<id>:<scope>:v<version>`. The version arg
  is optional when parsing (an old panel without it → no check); anything else after the scope is stale.
  `Action` `save`/`delok` gain `version: number | null`.

- [ ] **Step 1: Write the failing tests:** parse `save` with `['5','one','v3']` → `{ kind:'save', id:5, scope:'one', version:3 }`;
  `['5','one']` → `version: null`; `['5','one','x']` → `null`; the built ids stay ≤ 100 chars for id 999999999 and
  version 999999; the edit submit with a stale version replies with the refusal message (fake db / existing harness).
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run <file>` — FAIL.
- [ ] **Step 3: Implement**: the modal open reads `e.version` and encodes it; submit and delete pass it as
  `{ expectedVersion }`. No command-definition change, so no re-register.
- [ ] **Step 4: Run** `pnpm --filter @studies/bot test` and typecheck — PASS.
- [ ] **Step 5: Commit** `feat(bot): event edit and delete send the version they were opened with`.

### Task 6: SQL error sanitizing and audited permission refusals (M17, M19)

**Files:**
- Modify: `apps/web/lib/sql-messages.ts` (add `sanitizeDbMessage`), `apps/web/lib/sql-console.ts` (query error path),
  the table-browser error path (`grep -rn "\.message" apps/web/app/\(app\)/tables`), `apps/web/lib/admin-sql.ts`
  (`adminSqlErrorMessage`, new `permissionDetails`), `apps/web/lib/admin-sql-handler.ts` (audit on permission errors in
  `preview` and `execute`)
- Test: `apps/web/test/sql-messages.test.ts` (create), `apps/web/test/admin-sql.test.ts`, `apps/web/test/admin-sql-route.test.ts`

**Interfaces:**
- Produces: `sanitizeDbMessage(message: string): string`;
  `permissionDetails(err: unknown): { errno: 1142 | 1143 | 1044; table?: string; column?: string } | null`.

Messages (exact):
- 1142: ``Table `${t}` is outside the console's scope.`` (no name → "This table is outside the console's scope.")
- 1143: ``Column `${c}` of `${t}` can't be changed from the console.`` (no names → "This column can't be changed from the console.")
- 1044: "The console has no access to this database."

- [ ] **Step 1: Write the failing tests:**
  - `sanitizeDbMessage("SELECT command denied to user 'studies_ro_qa'@'10.88.0.2' for table `studies_qa_test`.`users`")`
    → ``"SELECT command denied for table `users`"``.
  - 1143 text `UPDATE command denied to user 'u'@'h' for column 'topic_id' in table 'events'` →
    `"UPDATE command denied for column 'topic_id' in table 'events'"`.
  - 1044 `Access denied for user 'u'@'%' to database 'studies'` → `"Access denied to database"`.
  - syntax error `You have an error in your SQL syntax; … near 'FROM users' at line 1` → unchanged.
  - `permissionDetails` parses table and column from the 1142/1143 texts above.
  - handler: fake RW pool throwing `{ errno: 1143, sqlState: '42000', message: <1143 text> }` on preview → 400 with the
    1143 message, one `admin_audit` row `{ action: 'sql.rejected', details.reason: 'permission', details.table: 'events', details.column: 'topic_id' }`.
    Same for execute and for 1142.
  - read console: a query rejected with the 1142 text returns the sanitized message (no `@`, no `studies_`).
- [ ] **Step 2: Run** `pnpm --filter @studies/web exec vitest run test/sql-messages.test.ts test/admin-sql.test.ts test/admin-sql-route.test.ts test/sql-console.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Sanitizer: remove ` to user '…'@'…'` / ` for user '…'@'…'`, then `` `<any>`.` `` schema
  prefixes and `'<any>'.` prefixes, then collapse "Access denied to database '…'" to "Access denied to database".
- [ ] **Step 4: Run** the same files plus `pnpm --filter @studies/web test` — PASS.
- [ ] **Step 5: Commit** `fix(web): sanitized SQL errors; audit and explain permission refusals`.

### Task 7: Missing Origin is refused (L22)

**Files:**
- Modify: `apps/web/lib/same-origin.ts`
- Test: `apps/web/test/same-origin.test.ts` (create)

**Interfaces:** `isCrossOrigin(req: Request): boolean` unchanged signature.

Rule: `Origin` present → compare as today. `Origin` absent → cross-origin unless `Sec-Fetch-Site` is exactly
`same-origin`.

- [ ] **Step 1: Write the failing tests:** matching Origin → false; foreign Origin → true; no Origin +
  `Sec-Fetch-Site: same-origin` → false; no Origin + `Sec-Fetch-Site: cross-site` → true; neither header → true.
- [ ] **Step 2: Run** — FAIL on the last case.
- [ ] **Step 3: Implement.** Then check the callers' tests (`event-upload.test.ts`, `admin-sql-route.test.ts`) send an
  `Origin` header in their requests; add it where missing.
- [ ] **Step 4: Run** `pnpm --filter @studies/web test` and the e2e upload tests (`grep -ln pliki apps/web/e2e`) — PASS.
- [ ] **Step 5: Commit** `fix(web): refuse state-changing API requests without an origin`.

### Task 8: Series end date and the audit count (L1, L4)

**Files:**
- Modify: `packages/db/src/event-series.ts` (`addSeries`: store `until` = date of the last generated occurrence)
- Investigate: `apps/web/lib/admin-audit.ts` and the Dziennik page query
- Test: `packages/db/test/event-series.test.ts`, `apps/web/test/admin-audit.test.ts` (if a bug is found)

- [ ] **Step 1: Write the failing test:** weekly series from Tue 2026-10-20 with `until` 2026-11-14 (Sat) → stored
  `until` is `2026-11-10`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm --filter @studies/db test` — PASS.
- [ ] **Step 5: Investigate L4:** in the QA sandbox DB (`studies_qa_test`, read-only queries only) compare
  `SELECT id, action FROM admin_audit ORDER BY id` with what the Dziennik shows for the default filter. Write the cause
  in this plan under "Notes". If the count or the filter is wrong, add a failing test in `admin-audit.test.ts`, fix,
  rerun. If an entry is hidden by design, make the count line say so (e.g. "30 entries (filter: …)").
- [ ] **Step 6: Commit** `fix: series end date is its last occurrence; audit count` (one or two commits).

### Task 9: Verification and QA re-run

- [ ] **Step 1:** `pnpm test` (worker tests that need `soffice`/`pdftotext` may fail on this Mac; note them), the four
  typechecks, `pnpm lint`, `pnpm --filter @studies/web e2e` — all PASS.
- [ ] **Step 2:** `pnpm qa:sandbox`, `pnpm qa:serve` in the background, then run `/qa-run chaos security` style:
  dispatch `qa-chaos` and `qa-security-auditor` with run `2026-10-18-r1` and the prompt from `.claude/skills/qa-run/SKILL.md`.
- [ ] **Step 3:** confirm none of H1, M1, M2, M17, M19, L22 reappear; write `docs/qa/2026-10-18-r1/SUMMARY.md`; stop the
  server; commit `chore(qa): round 1 re-run`.

## Notes

(Task 8 L4 cause goes here.)
