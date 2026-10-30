# Audit 2026-10-30 fixes (G1–G4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fix audit groups G1–G4 from the 2026-10-30 audit:
- G1: the iCal link leaking through a pre-hydration GET, plus import hardening;
- G2: the RO console showing a password hash;
- G3: admin bot queue robustness;
- G4: admin edit correctness.

**Architecture:**
- Where fixes touch shared logic they live in `packages/db`: group import, bot requests, shared admin actions.
- Web-only behavior stays in `apps/web/lib` and its components, and bot-only behavior in `apps/bot/src/admin-requests.ts`.
- No schema migration is needed.

**Tech Stack:** TypeScript, Drizzle/MariaDB, Next 16 Server Actions, React 19, discord.js 14, vitest.

**Spec:** the findings themselves are the spec. Files: `docs/audits/2026-10-30/FINDINGS.md` (groups), `correctness.md` (C*), `security-web.md` (W*), `security-bot.md` (B*), `performance.md` (P3), `docs/qa/2026-10-30/SUMMARY.md` (U*), plus the persona reports. These docs are in the main checkout and are not committed: read them from `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/docs/...`.

## Global Constraints

- **UI language:** UI strings are English, and the content stays Polish (CLAUDE.md, `pnpm check:lang`).
- **Auth:** every web page, route handler and Server Action calls `requireUser()`/`requireAdmin()` itself.
- **iCal link:** it is never stored, logged or returned. When logging an import error, log only `name`/`code`/`errno`, never `message`.
- **Client imports:** client components import from `@studies/db/constants` and `@studies/db/fields` only (plus `import type`).
- **Test DB:** DB tests share it, so run test files sequentially and never in parallel with another vitest run.
- **Migrations:** no `drizzle-kit push`, and no new migration in this plan.
- **Commits:** as DBOYttt, unsigned (`git -c commit.gpgsign=false commit`), with no AI attribution or trailers. Never push.

## Review Focus

1. **A pre-hydration form submit must never put field values in a URL.** It has to work on every `onSubmit` form, not only the import form (Task 1 adds a source-scan test).
2. **A stale admin edit form must not revert another admin's change,** and a direct POST without `orig_*` fields must keep today's behavior (Task 6 tests both).
3. **A cancelled-while-running admin request must not be flipped back to `done`** when the bot finishes later (Task 4 tests `finishBotRequest` on a non-running row).
4. **Credential redaction must cover any result cell,** whatever the query shape, for example `SHOW GRANTS FOR CURRENT_USER` or `SHOW CREATE USER` (Task 3 tests).
5. **A calendar over the entry cap must be refused cheaply,** before any occurrence work, on both web and bot (Task 2 tests).

## Rulings (made without asking; the cost if wrong is in brackets)

- **R1 B6 (rate limit per process):** parked. A DB-backed limiter needs a table, which means a migration. 12 imports per 10 min per user is acceptable. [A user can make 12 fetches instead of 6.]
- **R2 W2 (3 MB Server Action limit):** kept, and documented in CLAUDE.md (Task 8). [Every action parses up to 3 MB before auth.]
- **R3 W3 (feed hosts auto-allowed):** behavior kept and documented in `docs/deploy.md` and `.env.prod.example` (Task 8). [An operator who points a feed at an internal host exposes it to GET.]
- **R4 W4 (lock left after a failed release):** not changed. A failed `RELEASE_LOCK` means a broken connection, and mysql2 destroys those. The per-DB lock name (Task 4) limits the blast radius. [5 s busy answers until the pool recycles it.]
- **R5 W5 (audit write failure):** accepted, by design. [None new.]
- **R6 U9 unassign:** a web-only action. The bot has no unassign command, and the rule that the panel mirrors the bot does not forbid extra web actions. [The bot lacks an action that the web has.]

---

### Task 1: No GET fallback on client-handled forms (U1)

**Files:**
- Create: `apps/web/lib/use-hydrated.ts`
- Modify: every component with a `<form … onSubmit=…>`:
  - `components/plan/GroupImport.tsx`;
  - `components/plan/MyGroupsForm.tsx`;
  - `components/plan/EntryQuizSection.tsx` (2 forms);
  - `components/admin/ActionForm.tsx`;
  - `components/admin/ActionButton.tsx`;
  - `components/events/LinkedPosts.tsx`;
  - `components/events/EventForm.tsx`.
- **Not** `components/ViewSearchForm.tsx`: its GET fallback is intended, as its header comment says.
- Test: `apps/web/test/forms-method.test.ts`

**Interfaces:**
- Produces: `useHydrated(): boolean`, false on the server and in the first client render and true after hydration, built on `useSyncExternalStore(() => () => {}, () => true, () => false)`.

- [ ] **Step 1: write the failing test.** `forms-method.test.ts` reads every `.tsx` under `apps/web/components` and `apps/web/app`. For each `<form` opening tag (up to the matching `>`) that contains `onSubmit=`, it asserts that the tag contains `method="post"`, unless the file is `ViewSearchForm.tsx`. It should fail now on the 8 forms.
- [ ] **Step 2:** run `pnpm --filter @studies/web exec vitest run test/forms-method.test.ts` and expect FAIL listing those files.
- [ ] **Step 3: add `method="post"` to each of those forms.** In `GroupImport.tsx`, also make the Preview submit button `disabled={!hydrated}` (a real `disabled`, so implicit submission by Enter is blocked before hydration). Keep `aria-disabled` for busy.
- [ ] **Step 4:** run the test (PASS), then `pnpm --filter @studies/web typecheck`.
- [ ] **Step 5:** commit `fix(web): client-handled forms post instead of falling back to GET`.

### Task 2: Import hardening (W1/C3, C5, C6, C7, C8)

**Files:**
- Modify:
  - `packages/db/src/unitime/ics.ts`: `countOccurrences`;
  - `packages/db/src/unitime/group-import.ts`;
  - `packages/db/src/index.ts`: exports;
  - `apps/web/lib/group-import-actions.ts`;
  - `apps/web/components/plan/GroupImport.tsx`;
  - `apps/bot/src/ui/student.ts`, plus the bot's import summary view, wherever `skipped` is rendered.
- Test:
  - `packages/db/test/group-import.test.ts`;
  - `apps/web/test/group-import.test.ts`;
  - `apps/bot/test/group-import.test.ts`.

**Interfaces:**
- Produces:
  - `countOccurrences(ev): number`, the same rules and caps as `expandOccurrences` without allocating;
  - `GROUP_IMPORT_MAX_EVENTS = 5000`;
  - `TOO_MANY_ENTRIES_MESSAGE = 'The calendar has too many entries (max 5000).'`;
  - `class TooManyEntriesError`;
  - `GroupImportPreview.skipped.noDates: number`;
  - `GROUP_IMPORT_SAVE_FAILED = 'Could not save the groups.'`.

- [ ] **Step 1: write the failing db tests.**
  - (a) `countOccurrences(ev) === expandOccurrences(ev).length` for the fixture events plus an UNTIL-before-DTSTART event and an all-EXDATE event.
  - (b) A generated calendar with 5001 VEVENTs makes `planGroupImport` reject with `TooManyEntriesError`, and `importErrorMessage(err)` returns `TOO_MANY_ENTRIES_MESSAGE`.
  - (c) An entry with zero occurrences is not matched, and `skipped.noDates === 1` (C8).
  - (d) A subject whose `unitime_name` differs only in case and trailing spaces is matched (C7: normalise both sides with `trimEnd().toLowerCase()`).
  - (e) `applyGroupImport` with a pair whose group was deleted after planning resolves `{ set, skipped }` without throwing. The validity check moves inside the transaction (`.for('share')`).
- [ ] **Step 2:** run them and expect FAIL.
- [ ] **Step 3: implement.**
  - The weight is `countOccurrences`.
  - The VEVENT count check runs before any expansion.
  - `importErrorMessage` maps `TooManyEntriesError`.
- [ ] **Step 4: write the web tests.**
  - `applyGroupImportAction` with 101 valid pairs saves the first 100, not "Invalid selection." (C6). The client also slices to `GROUP_IMPORT_MAX_PAIRS`.
  - A DB error inside `planGroupImport` (not a `SafeSyncError`/`NotACalendarError`) is logged with `console.error('group import failed:', {name, code, errno})` only. Assert the logged object has no `message` and that the link string is not in any logged argument.
  - Implement both.
- [ ] **Step 5: write the bot tests.**
  - When `applyGroupImport` throws, the reply is `GROUP_IMPORT_SAVE_FAILED` (not `IMPORT_FAILED`) and the safe log line is written.
  - When `skipped.noDates > 0`, the summary includes it.
  - Implement; the web renders `N without dates` in the Skipped line too.
- [ ] **Step 6:** run the three test files one after another, plus typecheck for db, web and bot.
- [ ] **Step 7:** commit `fix(import): cap entries, count without allocating, safer errors`.

### Task 3: Hide credential hashes in console results (U2)

**Files:**
- Modify: `apps/web/lib/sql-console.ts`. Also the RW console result path in `apps/web/lib/admin-sql-handler.ts` if it builds rows itself.
- Test: `apps/web/test/sql-console.test.ts`, or the existing console test file.

**Interfaces:**
- Produces: `redactCredentials(v: unknown): unknown`. For a string it replaces `/(IDENTIFIED\s+(?:BY\s+PASSWORD|VIA\s+\w+\s+(?:USING|AS)))\s+'[^']*'/gi` with `$1 '<hidden>'` and `/(PASSWORD\s*\(\s*)'[^']*'/gi` with `$1'<hidden>'`. Other values pass through.

- [ ] **Step 1: write the failing tests.**
  - A unit test on `redactCredentials` with a MariaDB `SHOW GRANTS` line and a `SHOW CREATE USER` line.
  - A DB-backed test (the existing RO-pool test setup) runs `SHOW GRANTS` and `SHOW GRANTS FOR CURRENT_USER` through `runReadonlyQuery`, and asserts no cell matches `/'\*[0-9A-F]{40}'/`.
- [ ] **Step 2:** run them and expect FAIL.
- [ ] **Step 3:** apply `redactCredentials` to every cell after `toJsonValue`, in `runReadonlyQuery` and in any RW console row path.
- [ ] **Step 4:** run them (PASS).
- [ ] **Step 5:** commit `fix(sql): hide password hashes in console results`.

### Task 4: Admin queue, db and web side (C2, C4, U11, P3)

**Files:**
- Modify:
  - `packages/db/src/bot-requests.ts`;
  - `apps/web/lib/admin-sync.ts`;
  - `apps/web/lib/admin-actions.ts`: cancel;
  - `apps/web/app/(app)/admin/sync/page.tsx`.
- Create: `apps/web/app/(app)/admin/sync/requests/[id]/page.tsx`.
- Test:
  - `packages/db/test/bot-requests.test.ts`;
  - `apps/web/test/admin-sync.test.ts`;
  - the existing admin action and page tests;
  - `apps/web/e2e/admin-round2.spec.ts`: one assertion for the report page.

**Interfaces:**
- Produces:
  - `STUCK_AFTER_MS = 15 * 60_000` (db);
  - `cancelAdminBotRequest(db, id, now)`, which also cancels a `running` admin request whose `startedAt` is older than `STUCK_AFTER_MS`;
  - `finishBotRequest`, which updates only rows still `running`;
  - `listAdminBotRequests`, which no longer selects `report` and returns `reportChars: number`;
  - `getAdminBotRequest(db, id): Promise<AdminBotRequest | null>`, with the report and only for admin kinds;
  - `isCancelled(r)`: `status === 'failed' && error === CANCELLED_MESSAGE`;
  - web: `STUCK_TEXT = 'The bot has been working on this request for more than 15 minutes. It may be stuck: cancel it or restart the bot.'`.

- [ ] **Step 1: write the failing db tests.**
  - The lock name is per database: the SQL uses `CONCAT(DATABASE(), ':admin_bot_request')` for both GET and RELEASE (C4). Test by holding `GET_LOCK('studies_test:admin_bot_request')`, or whatever `DATABASE()` returns, on another connection and expecting `BOT_BUSY_MESSAGE` within the timeout; holding the old global name must not block.
  - Cancel succeeds on a running row started 16 min ago and fails on one started 1 min ago.
  - `finishBotRequest` on a `failed` row leaves it `failed`.
  - The list rows have `reportChars` and no `report`.
  - `getAdminBotRequest` returns the report and returns null for an event kind.
- [ ] **Step 2:** run them (FAIL), implement, then run them (PASS). Then run the bot and worker test suites that call `finishBotRequest` (bot `events/worker` tests, bot admin-requests tests), sequentially.
- [ ] **Step 3: web.**
  - `isStaleRequest`/`staleNotice` also flag a `running` request older than `STUCK_AFTER_MS`, with `STUCK_TEXT`.
  - The Sync table shows a neutral `cancelled` status for `isCancelled` rows.
  - The panel header reads "A request is queued" or "A request is in progress", by status.
  - Cancel is shown for queued rows and for stuck running rows.
  - The Report cell is a link "Report (N chars)" to `/admin/sync/requests/<id>`. That page calls `requireAdmin()`, returns `notFound()` for unknown or non-admin-kind ids, and renders the report escaped in a `<pre>`.
  - Write the tests first: the `admin-sync` unit tests and the page/action tests the repo uses for admin pages.
- [ ] **Step 4:** run the web tests for these files and typecheck.
- [ ] **Step 5:** commit `fix(admin): stuck requests can be cancelled, reports load on demand`.

### Task 5: Admin queue, bot side (B1, B2, B3)

**Files:**
- Modify: `apps/bot/src/admin-requests.ts`, and `apps/bot/src/index.ts` if the tick wiring changes.
- Test: `apps/bot/test/admin-requests.test.ts`.

**Interfaces:**
- Consumes: `finishBotRequest` only finishes `running` rows (Task 4), and `failStaleBotRequests(db, now, olderThanMs, kinds)`.
- Produces:
  - `storeDone` and the failure write retry with injected waits of 1 s, then 5 s (3 attempts in all; the waits are injectable for tests);
  - on each poller tick, while the setup lock is free, admin rows left `running` are failed with `Interrupted.`, the same message as boot recovery (reuse `recoverInterruptedAdminRequests`).

- [ ] **Step 1: write the failing tests.**
  - The first two finish writes throw and the third succeeds: the row ends `done` and the waits were 1000 and 5000.
  - A row left `running` with the lock free is failed on the next tick.
  - With the lock held, nothing is touched.
  - A requester whose `discord_user_id` is not `/^\d{17,20}$/` fails with `NOT_MEMBER_MESSAGE`, and no REST call is made (B2).
  - When `guild.roles.fetch(roleId)` returns null, the request fails with `NO_ROLE_MESSAGE` and `is_admin` is unchanged (B3).
- [ ] **Step 2:** run them (FAIL), implement, then run them (PASS). Run `apps/bot` typecheck.
- [ ] **Step 3:** commit `fix(bot): admin requests retry their finish and never stay running`.

### Task 6: Admin edits don't revert concurrent changes (C1, C9)

**Files:**
- Modify:
  - `apps/web/lib/admin-forms.ts`;
  - `apps/web/lib/admin-actions.ts`;
  - `apps/web/components/admin/SubjectForm.tsx`;
  - `apps/web/components/admin/ClassForm.tsx`;
  - `apps/web/components/admin/LecturerForm.tsx`.
- Test: `apps/web/test/admin-actions.test.ts`, `apps/web/test/admin-forms.test.ts`, or the existing files.

**Interfaces:**
- Produces:
  - `subjectFormValues(cur)`, `classFormValues(cur)` and `lecturerFormValues(cur)`, each returning a `Record<field, string>`: exactly the strings the forms render as `defaultValue`.
  - The forms render every editable field's value also as a hidden `orig_<field>` input.
  - `CONFLICT_MESSAGE = (fields: string[]) => \`Someone else changed ${fields.join(', ')} meanwhile. Reload the page to see the new values.\``.

**Rules, per field `f`:**
- When the form carries no `orig_*` fields at all, today's behavior applies: diff against `cur`.
- Otherwise:
  - `touched = submitted[f] !== orig[f]`;
  - an untouched field is never patched and never validated beyond today's stored-value rule;
  - a touched field whose `formValues(cur)[f] !== orig[f]` is a conflict, and the action refuses with `CONFLICT_MESSAGE([...])` without writing;
  - a touched field with no conflict goes into the patch as today.
- C9: `parseSemesterEcts` accepts a submitted value equal to the stored one even when it is out of range. The form renders an out-of-range stored semester or ECTS as an extra selected `<option>`.

- [ ] **Step 1: write the failing tests.**
  - Admin A opens with name "Analiza", then B renames it, then A changes only ECTS: the name stays B's, ECTS is changed, and the audit `fields` is `['ects']`.
  - A and B both change the name: refused with `CONFLICT_MESSAGE(['name'])`, and the row is unchanged.
  - A direct POST without `orig_*` keeps today's diff behavior.
  - Equivalent single tests for class (note) and lecturer (room).
  - C9: a subject with `semester = 3`, out of range, can have its name edited and keeps semester 3.
- [ ] **Step 2:** run them (FAIL), implement, then run them (PASS), plus web typecheck and the admin e2e spec (`pnpm --filter @studies/web e2e e2e/admin-round2.spec.ts`).
- [ ] **Step 3:** commit `fix(admin): edits only change touched fields and refuse conflicts`.

### Task 7: Lecturer assignment and DELETE preview (U9, U10)

**Files:**
- Modify:
  - `packages/db/src/admin-actions.ts`: `assignLecturer` and a new `unassignLecturer`; `ensureClass`/`ensureGroup` report `created`;
  - `packages/db/src/index.ts`;
  - `apps/web/lib/admin-actions.ts`;
  - `apps/web/lib/admin-pages.ts`: the subject page lists assignments with their `class_lecturers.id`;
  - `apps/web/app/(app)/admin/subjects/[code]/page.tsx`;
  - `apps/web/components/admin/AssignLecturerForm.tsx`;
  - `apps/web/lib/admin-sql.ts`;
  - `apps/web/lib/admin-sql-handler.ts`;
  - `apps/web/components/admin/AdminSqlConsole.tsx`.
- Test:
  - `packages/db/test/admin-actions.test.ts`;
  - `apps/web/test/admin-actions.test.ts`;
  - `apps/web/test/admin-sql.test.ts`;
  - the admin-sql handler tests;
  - the bot's lecturer command tests, which check the message text.

**Interfaces:**
- Produces:
  - `assignLecturer` success text `Assigned <lecturer name> to <CODE> / <class>[, Gr. N].`, plus ` Created the <class> class.` and/or ` Created group N.` when they were created. The bot shows the same text.
  - `unassignLecturer(db, classLecturerId): Promise<ActionResult>`, which refuses `Assignment not found.`.
  - The web `unassignLecturerAction` (`requireAdmin`), audited as `lecturer.unassign`, with the target in the same format the web uses for `lecturer.assign`.
  - The AssignLecturerForm fields stack vertically below `sm`, and the select has a min width. No overlapping labels: a `flex-col` layout with full-width controls in the narrow column.
  - `admin-sql.ts`: `CASCADE_PARENTS: ReadonlySet<string>`, the tables that other tables reference with `ON DELETE CASCADE`.
- Rules for a DELETE on a `CASCADE_PARENTS` table:
  - the preview adds `Rows in other tables that reference these rows are deleted too.`;
  - the typed confirmation is required whatever the row count, on both the client (`needsConfirm`) and the server check.

- [ ] **Step 1: write the failing tests.**
  - The db: messages with created class/group, the lecturer name in the message, unassign removes the row, unknown id refused.
  - The web action: requireAdmin and an audit row.
  - `CASCADE_PARENTS` equals the set derived from the schema: iterate the tables with drizzle `getTableConfig(t).foreignKeys`, keep those with `onDelete === 'cascade'`, and map each to `reference().foreignTable`'s name.
  - The handler refuses an unconfirmed 1-row DELETE on `class_groups` with the existing typed-confirmation error.
- [ ] **Step 2:** run them (FAIL), implement, then run them (PASS). Run the bot tests that assert the assign message (update their expected text), the web typecheck and the admin e2e.
- [ ] **Step 3:** commit `fix(admin): name what an assignment creates, add unassign, confirm cascading deletes`.

### Task 8: Docs (C10, rulings R2/R3) and CLAUDE.md

**Files:**
- Modify:
  - `CLAUDE.md`;
  - `docs/deploy.md`;
  - `.env.prod.example`;
  - `docs/superpowers/specs/2026-10-29-admin-panel-round2-design.md` (`report` is `mediumtext`);
  - `docs/superpowers/specs/2026-10-29-ical-group-import-design.md` (the `planGroupImport(db, userId, icsText)` signature, `currentGroupName`, `noDates`, the 5000-entry cap, and drop the soft-deleted subject clause).

- [ ] **Step 1: CLAUDE.md, Web app architecture.** Add one line on the 3 MB `serverActions.bodySizeLimit` (for the `.ics` upload; don't lower it). Also note that client-handled forms carry `method="post"`, which the forms test enforces, and that admin edit forms send `orig_*` values.
- [ ] **Step 2: deploy.md and `.env.prod.example`.**
  - `UNITIME_IMPORT_HOSTS`.
  - `web` and `bot` make outbound HTTPS requests to the import hosts.
  - The hosts of the configured feeds are importable too.
  - An existing digest thread keeps its old name `📅 Przypomnienia` until it is renamed by hand.
- [ ] **Step 3:** run `pnpm lint` and `pnpm check:lang`.
- [ ] **Step 4:** commit `docs: audit 2026-10-30 notes`.
