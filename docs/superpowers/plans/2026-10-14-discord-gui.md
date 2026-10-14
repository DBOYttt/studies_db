# Discord GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bot gets interactive Components V2 panels: a student panel (plan, Moje grupy, web login) and an admin
panel (status/sync, edit forms, moderation, web admin link). They are pinned in `#panel` / `#admin-panel` by
`/setup` and can also be opened with `/panel` and `/admin`. "Moje grupy" is stored in the DB and shared with the web.

**Architecture:**
- Shared logic moves to `packages/db`: plan query core, admin actions, and `user_groups`.
- The bot gets `apps/bot/src/ui/`: a stateless `custom_id` codec, pure view builders, and one interaction router
  that checks admin rights on every admin interaction and writes the audit log.
- `/setup` gains planner actions for the panel channels and messages.
- The web saves "Moje grupy" through Server Actions and its login accepts a restricted `next`.

**Tech Stack:** discord.js 14.27 (Components V2: `ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`,
`SeparatorBuilder`, `ActionRowBuilder`, `ButtonBuilder`, `StringSelectMenuBuilder`, `UserSelectMenuBuilder`,
`ModalBuilder`, `LabelBuilder`, `TextInputBuilder`, `MessageFlags.IsComponentsV2`), Drizzle + MariaDB, Next.js 16
Server Actions, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-discord-gui-design.md` (and round 2 §1/§3 it borrows:
`docs/superpowers/specs/2026-10-14-admin-panel-round2-design.md`).

## Global Constraints

- **Copy:** all user-facing text is Polish, exactly as the spec quotes it:
  - "Ten panel jest nieaktualny — otwórz go ponownie."
  - "Wystąpił błąd. Spróbuj ponownie później."
  - "Brak uprawnień."
  - "Twój dostęp do strony jest zablokowany."
  - "/setup już trwa — spróbuj za chwilę."
  - "Ustaw Moje grupy, aby widzieć tylko swoje zajęcia"
  - "Brak zajęć"
  - "…i N więcej — otwórz na stronie"
  - "Pracuję…"
- **Times:** shown in Europe/Warsaw. Session times in the DB/views are wall-clock values, so reuse the existing
  wall helpers; never convert them a second time.
- **Discord limits, enforced in builders:**
  - 25 options per select;
  - 5 buttons per action row;
  - 40 components per message;
  - about 3500 characters of text per view (the spec's cut-off);
  - `custom_id` ≤ 100 characters;
  - modal text inputs use the same max lengths as `apps/bot/src/commands/definitions.ts`.
- **`custom_id` format:** `v1:<area>:<action>[:<arg>…]`. Areas are `stu` (student) and `adm` (admin). Any id that
  does not decode is "stale".
- **Admin check:**
  - every `adm` interaction re-runs `syncAdminFlag` and checks the stored admin role id, using the same rule as
    `isAdmin` in `apps/bot/src/commands/router.ts`;
  - nothing trusts the channel the message is in.
- **Audit:** every admin change from Discord (panel and slash commands) writes `admin_audit` via `writeAudit` with
  `details.source = 'discord'`. The action names are `subject.add`, `subject.edit`, `lecturer.add`, `lecturer.edit`,
  `lecturer.assign`, `class.edit`, `plan.sync`, `user.ban`, `user.unban`, `bot.setup`, `bot.setup_dry_run`,
  `bot.resync`. An audit failure is logged and never fails the action.
- **3-second rule:** acknowledge (`deferUpdate` / ephemeral `deferReply`) before any DB work beyond one quick read.
  `showModal` must be the first response (never deferred).
- **Views:** private views are ephemeral. Pinned panel messages are never posted twice; `/setup` edits them in place.
- **Repo rules (CLAUDE.md):**
  - never `drizzle-kit push`; generate migrations with `drizzle-kit generate` from `packages/db`;
  - tests use the TEST DB only, with `fileParallelism: false`;
  - every web page/route/Server Action calls `requireUser()` itself;
  - `packages/db` internal imports use `.js` extensions.
- **Never** touch the `studies` dev DB, the live Discord server or `.env` from tasks. Never push. Commit as the repo
  identity without Claude trailers, and don't bypass commit signing.

## Review Focus

1. **A pinned panel clicked after a bot restart or after a layout change** (an old `custom_id`) should give the
   stale message, never "interaction failed". Task 7 has the test.
2. **A day or week that crosses the 2026-10-25 DST change** in Europe/Warsaw should list sessions under the right
   day with the right times. Task 6 has the test.
3. **A saved group that disappears** (UniTime sync or edit deletes the class group) should drop silently from
   "Moje grupy" and the plan, with no error. Task 1 tests the FK cascade.
4. **A non-admin who presses an `adm` button** (in a forwarded message, via a copied panel, or after losing the
   role) should get "Brak uprawnień." and no side effect. Task 9 has the test.
5. **Selecting a group in Moje grupy** is a DB write plus a re-render, so it must acknowledge before the write.
   Task 7's test asserts `deferUpdate` is called before `setMyGroup`.

---

### Task 1: `user_groups` table and helpers

**Files:**
- Modify: `packages/db/src/schema.ts` (add `userGroups`)
- Create: `packages/db/migrations/0009_user_groups.sql`. Generate it with
  `pnpm --filter @studies/db exec drizzle-kit generate --name user_groups`; never hand-edit `migrations/meta`.
- Create: `packages/db/src/my-groups.ts`
- Modify: `packages/db/src/index.ts` (export)
- Test: `packages/db/test/my-groups.test.ts`

**Interfaces:**
- Produces:
  - `type MyGroups = Record<string, number>`, keyed by class id with the group id as value (same shape as the
    web's `apps/web/lib/plan.ts` `MyGroups`). It moves here; the web re-exports it in Task 2.
  - `getMyGroups(db: Db, userId: number): Promise<MyGroups>`
  - `setMyGroup(db: Db, userId: number, classId: number, groupId: number | null): Promise<{ ok: boolean }>`. It
    returns `ok: false` when `groupId` is not a group of `classId`. `null` deletes the entry.
  - `clearMyGroups(db: Db, userId: number): Promise<void>`
  - `importMyGroups(db: Db, userId: number, groups: MyGroups): Promise<boolean>`. It writes only when the user has
    no rows, skips invalid pairs, and returns whether it imported.

- [ ] **Step 1: Write the failing tests.** In `my-groups.test.ts` (resetTestDb, seed a subject with a class with
  groups 1 and 2, another class with group 1, and a user):
  - set then get returns `{ [classId]: g1 }`;
  - set again replaces it;
  - `null` removes it;
  - a group of another class returns `{ ok: false }` and stores nothing;
  - `clearMyGroups` empties;
  - import into empty stores the valid pairs and returns `true`;
  - import when rows exist changes nothing and returns `false`;
  - deleting the `class_groups` row removes the user's entry (cascade).
- [ ] **Step 2: Run** `pnpm --filter @studies/db exec vitest run test/my-groups.test.ts`. Expected: FAIL (module
  missing).
- [ ] **Step 3: Implement.** Add `user_groups` with `user_id` → users, `class_id` → classes and `group_id` →
  class_groups, all `ON DELETE CASCADE`, and PK (`user_id`, `class_id`). Do not add the table to `PUBLIC_VIEWS` or
  `CONTENT_TABLES`. Generate the migration, then implement the helpers (upsert with `onDuplicateKeyUpdate`).
- [ ] **Step 4: Run** the test file, then `pnpm --filter @studies/db test` and
  `pnpm --filter @studies/db typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): user_groups for Moje grupy shared by web and bot`.

### Task 2: Shared plan core in `packages/db`

**Files:**
- Create: `packages/db/src/plan.ts`
- Modify: `apps/web/lib/plan.ts`, `apps/web/lib/plan-queries.ts` (import and re-export from `@studies/db`;
  delete the moved bodies), `packages/db/src/constants.ts` (move `KIND_ORDER` here from `apps/web/lib/queries.ts`
  and re-export it there), `packages/db/src/index.ts`
- Test: move the tests covering the moved functions from `apps/web/test/plan*.test.ts` into
  `packages/db/test/plan.test.ts`. Web tests of web-only functions stay.

**Interfaces:**
- Produces, from `@studies/db`:
  - `IsoWeek`, `isoWeekOf`, `parseIsoWeek`, `formatIsoWeek`, `weekStart`, `shiftWeek`, `nowWall`
  - `PlanSession`, `MyGroups` (from Task 1), `filterMyGroups`, `sanitizeMyGroups`, `parseMyGroups`
  - `MyGroupOption`, `listMyGroupOptions(pool)`
  - `weekSessionsQuery(w: IsoWeek, f?: PlanFilter): { sql: string; params: (string | number)[] }`
  - `toPlanSession(row)`
  - `listWeekSessionRows(pool: mysql.Pool, w: IsoWeek): Promise<PlanSession[]>`
- The web's `listWeekSessions` keeps its signature and `{ sql, rows }` return, built from `weekSessionsQuery` plus
  its own `inline`. Web-only code (`layoutDay`, `slotRange`, `weekDays`, `pageSql`, `SESSION_COLUMNS`, …) stays in
  the web.
- The bot gets its pool from `createDb(url).pool`. The views are readable by the main user.

- [ ] **Step 1: Move the tests first** into `packages/db/test/plan.test.ts`, importing from `../src/plan.js`. Add
  `listWeekSessionRows` returns the seeded week's sessions ordered by start.
- [ ] **Step 2: Run** `pnpm --filter @studies/db exec vitest run test/plan.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Move the code.** No behaviour change. Keep wall-time semantics: no new `Date` conversions.
- [ ] **Step 4: Run** the db and web suites plus typecheck for both:
  - `pnpm --filter @studies/db test`
  - `pnpm --filter @studies/web test`
  - `pnpm --filter @studies/web typecheck`
  
  Then `pnpm --filter @studies/web e2e e2e/plan*.spec.ts` (whichever plan e2e specs exist). Expected: PASS.
- [ ] **Step 5: Commit** `refactor: share plan helpers and week query via @studies/db`.

### Task 3: Admin actions in `packages/db`

**Files:**
- Create: `packages/db/src/admin-actions.ts`
- Modify: `apps/bot/src/commands/admin.ts` (becomes thin: it calls the actions and returns `.message`, or is
  deleted with its callers updated), `apps/bot/src/commands/router.ts`, `packages/db/src/index.ts`
- Test: move the action tests from `apps/bot/test/commands.test.ts` to `packages/db/test/admin-actions.test.ts`

**Interfaces:**
- Produces: `type ActionResult = { ok: boolean; message: string }` and
  - `addSubject(db, i: SubjectInput & { channelId: string | null })`
  - `editSubject(db, code, patch)`, `listSubjects(db)` (`message` = the list text)
  - `addLecturer(db, i)`, `editLecturer(db, id, patch)`
  - `editClass(db, i)`, `assignLecturer(db, i)`
  - `banUser(db, discordUserId, banned)`

  Each returns `Promise<ActionResult>`. Inputs are as in today's `admin.ts`. `message` is exactly today's reply
  text. `ok` is false for every refusal message (not found, duplicate, invalid URL, empty name, user never used the
  bot). The field helpers `textOrNull`, `urlOrNull` and `emailOrNull` are exported too.
- Produces: `auditDiscord(db: Db, userId: number, action: string, target: string | null, details: object)` in
  `apps/bot/src/audit.ts`. It calls `writeAudit` with `details: { ...details, source: 'discord' }` and logs on
  failure.
- The slash commands (`/subject`, `/lecturer`, `/class`, `/plan sync`, `/ban`, `/unban`, `/setup`, `/resync`) call
  `auditDiscord` after a successful (`ok`) change, using the action names from Global Constraints. The caller's
  `users.id` comes from the `syncAdminFlag` upsert; extend its return with `userId`.

- [ ] **Step 1: Move and extend the tests:**
  - the existing assertions now check `.message`, plus `.ok` (true on success, false on each refusal);
  - add `addSubject` with `channelId: null` inserts a subject with no channel;
  - in `apps/bot/test/router.test.ts`, a successful `/subject edit` writes one `admin_audit` row with
    `action = 'subject.edit'`, `target = code` and `details.source = 'discord'`, and a refused one writes none.
- [ ] **Step 2: Run** `pnpm --filter @studies/db exec vitest run test/admin-actions.test.ts` and
  `pnpm --filter @studies/bot exec vitest run test/router.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Move the code, wire the bot, and add `auditDiscord` plus the `userId` in
  `syncAdminFlag`'s return. Slash replies stay byte-for-byte identical.
- [ ] **Step 4: Run** the db and bot suites and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `refactor: admin actions in @studies/db; audit Discord admin commands`.

### Task 4: Web "Moje grupy" stored in the DB

**Files:**
- Modify: `apps/web/components/plan/useMyGroups.ts`, `MyGroupsForm.tsx`, `WeekView.tsx` and the pages rendering
  them (advanced `/plan`, simple `/s/plan`)
- Create: `apps/web/app/(app)/plan/actions.ts` (or a shared `apps/web/lib/my-groups-actions.ts` with `'use server'`)
- Test: `apps/web/test/my-groups-actions.test.ts`, `apps/web/e2e/my-groups.spec.ts`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 `MyGroups` / `sanitizeMyGroups`.
- Produces: Server Actions, each calling `requireUser()` first:
  - `saveMyGroupAction(classId: number, groupId: number | null): Promise<{ ok: boolean }>`
  - `clearMyGroupsAction(): Promise<void>`
  - `importMyGroupsAction(groups: MyGroups): Promise<boolean>`
- Pages pass `initialGroups: MyGroups` (from `getMyGroups`) to the client component. The hook keeps the state
  client-side for instant UI and calls the actions.
- Import: on mount, if `initialGroups` is empty and localStorage `studiesdb.myGroups.v1` parses to a non-empty
  `MyGroups`, call `importMyGroupsAction` once and then `removeItem`, whatever the result.

- [ ] **Step 1: Write the failing tests:**
  - **Unit (test DB):** the actions validate ids (non-integer → `{ ok: false }`) and call the helpers for the
    session user. Follow how other web tests stub `requireUser`/cookies.
  - **e2e:** pick a group on `/s/plan` → Moje grupy; open a new browser context with the same user's session; the
    choice is still selected.
  - **e2e:** seed localStorage `studiesdb.myGroups.v1` before the first visit; after load it is removed and the
    choice shows.
- [ ] **Step 2: Run** `pnpm --filter @studies/web exec vitest run test/my-groups-actions.test.ts` and
  `pnpm --filter @studies/web e2e e2e/my-groups.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read `apps/web/node_modules/next/dist/docs/` on Server Actions first (this Next
  version has breaking changes).
- [ ] **Step 4: Run** the web unit suite, typecheck and the full e2e. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Moje grupy saved per user in the database`.

### Task 5: Login link `next` (web admin from Discord)

**Files:**
- Modify: `apps/web/app/auth/callback/route.ts` (GET confirm page carries `next` in a hidden field; POST honours
  it), `apps/bot/src/commands/student.ts` (`linkFor(db, webBaseUrl, user, next?: '/admin')`)
- Create: `apps/web/lib/login-next.ts`
- Test: `apps/web/test/login-next.test.ts`, extend the callback route test if one exists (else add one),
  `apps/bot/test/commands.test.ts` (linkFor with next)

**Interfaces:**
- Produces: `safeNext(raw: unknown): string | null`. It returns the path only when it equals `/admin` or starts with
  `/admin/`, contains no `//`, `\`, `:`, CR/LF or `%2f`/`%5c` (case-insensitive), and is ≤ 200 characters.
  Otherwise it returns null.
- POST: redirect to `safeNext(next) ?? '/'`. When `next` is accepted, also set the mode cookie (`MODE_COOKIE`,
  `advanced`, with the same options `/mode` uses).
- `linkFor(..., '/admin')` returns `${webBaseUrl}/auth/callback?token=…&next=%2Fadmin`.

- [ ] **Step 1: Write the failing tests:**
  - `safeNext`: accepts `/admin` and `/admin/sql`; returns null for `/`, `/s`, `//evil.com`, `/\evil`,
    `/admin//x`, `https://evil.com`, `/admin%2F..`, `/admin\n`, `null`, a 201-character path;
  - POST with a valid token and `next=/admin` gives a 303 to `/admin` plus the mode cookie;
  - POST with `next=//evil.com` gives a 303 to `/`;
  - GET with `next` renders the hidden field HTML-escaped;
  - `linkFor` with `'/admin'` ends with `&next=%2Fadmin`.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web and bot suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat: login links can open the web admin panel`.

### Task 6: Bot UI codec and student views (pure)

**Files:**
- Create: `apps/bot/src/ui/ids.ts`, `apps/bot/src/ui/limits.ts`, `apps/bot/src/ui/views/student.ts`
- Test: `apps/bot/test/ui-ids.test.ts`, `apps/bot/test/ui-student-views.test.ts`

**Interfaces:**
- Produces in `ids.ts`:
  - `type Area = 'stu' | 'adm'`
  - `encodeId(area: Area, action: string, ...args: (string | number)[]): string`. It throws if the result is longer
    than 100 characters or an arg contains `:`.
  - `decodeId(id: string): { area: Area; action: string; args: string[] } | null`
- Produces in `limits.ts`: `MAX_TEXT = 3500`, `MAX_COMPONENTS = 40`, `MAX_OPTIONS = 25`.
- Produces in `views/student.ts`. Each builder returns
  `View = { components: TopLevelComponent[]; flags: MessageFlags.IsComponentsV2 }`:
  - `studentPanel()`: buttons `stu:plan:day` "Plan dziś", `stu:plan:week` "Ten tydzień", `stu:groups:open`
    "Moje grupy", `stu:login` "Zaloguj się na stronie";
  - `planDay(sessions: PlanSession[], day: Date /* wall */, hasGroups: boolean, webBaseUrl: string)`: navigation
    ids `stu:plan:day:<yyyy-mm-dd>` for prev/next, `stu:plan:day` for "Dziś", `stu:plan:week:<yyyy-Www>` for
    "Tydzień", and a link button to `${webBaseUrl}/s/plan?week=<yyyy-Www>`;
  - `planWeek(sessions, week: IsoWeek, hasGroups, webBaseUrl)`;
  - `groupsView(options: MyGroupOption[], selectedSubject: string | null, my: MyGroups)`: a subject select
    `stu:groups:subj`, one select per class `stu:groups:set:<classId>` with "— brak —" value `0`, buttons
    `stu:groups:clear` "Wyczyść" and `stu:plan:day` "Pokaż mój plan";
  - `notice(text: string)`: a single text view for errors and info.
- The session line format is
  `HH:MM–HH:MM · <code> <subjectName> · <className>[ · <groupName>][ · <room>][ · <lecturer>]`. Cancelled sessions
  are struck through (`~~…~~`) with " (odwołane)".

- [ ] **Step 1: Write the failing tests:**
  - **ids:** round-trip; the stale cases (`v2:…`, `x`, `v1:zzz:a`) return null; the 101-character throw.
  - **planDay:**
    - lists only the given day, in order;
    - an empty day shows "Brak zajęć";
    - `hasGroups=false` shows the hint text;
    - 60 sessions stop at `MAX_TEXT` with "…i N więcej — otwórz na stronie";
    - the total component count is ≤ 40 in every case.
  - **DST (Review Focus 2):** sessions on 2026-10-24, 25 and 26 at wall 08:00 appear under their own days with
    "08:00".
  - **planWeek:** groups by weekday, and every `custom_id` is ≤ 100 characters.
  - **groupsView:**
    - 30 classes page under 25 options per select;
    - the current choice is marked `default`;
    - only subjects with groups are listed.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/ui-ids.test.ts test/ui-student-views.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** with the discord.js V2 builders. Return JSON-able builders; tests inspect `.toJSON()`.
- [ ] **Step 4: Run** the bot suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bot): component id codec and student panel views`.

### Task 7: Bot UI router and student flows, `/panel`

**Files:**
- Create: `apps/bot/src/ui/router.ts`, `apps/bot/src/ui/student.ts` (handlers)
- Modify: `apps/bot/src/commands/router.ts` (`createInteractionHandler` routes `isButton()`,
  `isStringSelectMenu()`, `isUserSelectMenu()` and `isModalSubmit()` to `handleUi`; it shares the error reply),
  `apps/bot/src/commands/definitions.ts` (add `/panel`), `apps/bot/src/admin-flag.ts` (`memberRoleIds` accepts any
  interaction with `member`), `apps/bot/src/index.ts` if needed
- Test: `apps/bot/test/ui-router.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5 and 6.
- Produces:
  - `handleUi(deps: RouterDeps & { pool: mysql.Pool }, i: MessageComponentInteraction | ModalSubmitInteraction): Promise<void>`
  - `openStudentPanel(i)` is used by `/panel` (an ephemeral reply with `studentPanel()`).
  - `RouterDeps` gains `pool`, wired from `createDb` in `index.ts`.
- Behaviour:
  - stale id → ephemeral `notice('Ten panel jest nieaktualny — otwórz go ponownie.')`;
  - every interaction runs `syncAdminFlag`;
  - a banned user is refused for every `stu` action except reading the panel itself;
  - from the pinned message (not ephemeral), handlers `deferReply({ ephemeral })` then `editReply`; from an
    ephemeral view they `deferUpdate` then `editReply`;
  - plan sessions come from `listWeekSessionRows`, then `filterMyGroups` when the user has groups;
  - `stu:groups:set:<classId>` → `deferUpdate`, `setMyGroup`, then re-render;
  - `stu:login` → the `/link` flow (a DM via `linkFor`, with the same three messages).

- [ ] **Step 1: Write the failing tests** with fake interactions (record the calls in order):
  - a stale id gives the notice;
  - `stu:plan:day` from a pinned message gives deferReply(ephemeral) then editReply with the day view;
  - `stu:groups:set:<id>` calls `deferUpdate` **before** `setMyGroup` (Review Focus 5) and stores the choice;
  - a banned user's `stu:login` gives "Twój dostęp do strony jest zablokowany.";
  - a thrown handler error gives "Wystąpił błąd. Spróbuj ponownie później." via followUp when already deferred;
  - the `/panel` command replies ephemeral with 4 buttons.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/ui-router.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the bot suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bot): student panel interactions and /panel`.

### Task 8: Admin views (pure)

**Files:**
- Create: `apps/bot/src/ui/views/admin.ts`, `apps/bot/src/ui/views/modals.ts`
- Test: `apps/bot/test/ui-admin-views.test.ts`

**Interfaces:**
- Produces builders. The ids are fixed here and used in Task 9.
  - `adminPanel()`: `adm:status` "Status i synchronizacja", `adm:subj:list:0` "Przedmioty", `adm:lect:list:0`
    "Prowadzący", `adm:user:open` "Użytkownicy", `adm:web` "Panel www".
  - `statusCard(s: { planText: string; jobs: { queued: number; running: number; failed: number }; pending: number })`:
    `adm:plan:sync` "Synchronizuj plan", `adm:setup:dry` "Podgląd /setup", `adm:setup:ask` "Uruchom /setup",
    `adm:resync` "Pobierz z Discorda", `adm:status` "Odśwież".
  - `setupConfirm()`: `adm:setup:run` "Tak, uruchom" (danger), `adm:status` "Anuluj".
  - `reportView(title: string, text: string)`: text cut at `MAX_TEXT` with "…".
  - `subjectPicker(subjects, page)`: select `adm:subj:pick`, ◀ ▶ `adm:subj:list:<page>`, `adm:subj:add` "Dodaj
    przedmiot".
  - `subjectCard(s: SubjectCardData)`: `adm:subj:edit:<code>`, class select `adm:class:pick:<code>`.
  - `classActions(code, kind)`: `adm:class:edit:<code>:<kind>`, `adm:assign:start:<code>:<kind>`.
  - `assignPicker(code, kind, lecturers, groups)`: select `adm:assign:lect:<code>:<kind>`, then group select
    `adm:assign:grp:<code>:<kind>:<lecturerId>`, where value `0` means "całe zajęcia".
  - `lecturerPicker(lecturers, page)`: `adm:lect:pick`, ◀ ▶, `adm:lect:add`. `lecturerCard(l)`: `adm:lect:edit:<id>`.
  - `userPicker()`: `UserSelectMenu` `adm:user:pick`. `userCard(u, isSelf)`: `adm:user:ban:<discordId>` or
    `adm:user:unban:<discordId>`, disabled when `isSelf`.
  - `banConfirm(u, banned)`: `adm:user:banok:<discordId>` / `adm:user:unbanok:<discordId>` and `adm:user:open`
    "Anuluj".
  - Modals: `subjectModal(s?)` with id `adm:subj:save:<code|new>`, fields name, code (only for new), semester,
    ects, description, platform_url. `classModal(code, kind, current)` with id `adm:class:save:<code>:<kind>`:
    an assessment select inside a Label, plus note and platform_url. `lecturerModal(l?)` with id
    `adm:lect:save:<id|new>`.
- Modal field max lengths match `definitions.ts`. Prefill current values.

- [ ] **Step 1: Write the failing tests:**
  - every id ≤ 100 characters and decodes;
  - pickers page at 25 (30 subjects → 2 pages, ◀ disabled on page 0, ▶ disabled on the last);
  - `userCard` with `isSelf` has the ban button disabled;
  - `reportView` cuts long text;
  - `subjectModal()` (new) has the code field and `subjectModal(existing)` does not;
  - modal field `maxLength` values equal the slash-command option limits (import them from `definitions.ts` or a
    shared constants module, extracting one if needed).
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/ui-admin-views.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the bot suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bot): admin panel views and forms`.

### Task 9: Admin flows, `/admin`, `runSetup` refactor

**Files:**
- Create: `apps/bot/src/ui/admin.ts` (handlers), `apps/bot/src/ops.ts` (`runSetup`, `runResync`, shared lock)
- Modify: `apps/bot/src/ui/router.ts`, `apps/bot/src/commands/router.ts` (`/setup` and `/resync` use `ops.ts`;
  add `/admin`), `apps/bot/src/commands/definitions.ts`
- Test: `apps/bot/test/ui-admin.test.ts`, `apps/bot/test/ops.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 7 and 8.
- Produces in `ops.ts`:
  - `runSetup(deps, guild: Guild, callerId: string, dryRun: boolean): Promise<string>`, the report text: the
    current `/setup` body moved, including the admin flag re-sync for the caller;
  - `runResync(deps): Promise<string>`;
  - `withSetupLock<T>(fn: () => Promise<T>): Promise<T | 'busy'>`, which replaces the module-level `setupRunning`.
- Behaviour:
  - `adm` + not admin → ephemeral "Brak uprawnień." and no other call.
  - Status: plan text from `planStatusReply`, job counts from `jobs` by status, pending from `materials.status`.
  - `adm:setup:dry|run`, `adm:resync`: `deferUpdate`, "Pracuję…", then the lock. Busy gives "/setup już trwa —
    spróbuj za chwilę.". Otherwise the result goes into `reportView`, plus audit.
  - Modal submits validate like the commands: semester 1|2, ECTS 0–30. An invalid value gets an ephemeral reply
    with the command's Polish message and no change.
  - Success calls the Task 3 action, then `auditDiscord`, then re-renders the card.
  - `adm:subj:save:new` success adds a button `adm:setup:ask` "Uruchom /setup".
  - `adm:user:banok:<id>`: refuse self; upsert the target user (as `/ban`); `banUser`; audit `user.ban`.
  - `adm:web`: DM `linkFor(..., '/admin')`.
  - `/admin` gives an ephemeral `adminPanel()` (admin only).

- [ ] **Step 1: Write the failing tests:**
  - **Review Focus 4:** a non-admin pressing `adm:user:banok:<id>` gets "Brak uprawnień.", the user stays
    unbanned, and no audit row is written.
  - An admin `adm:subj:save:ASD` with ECTS `31` gets the Polish error and no change.
  - An admin `adm:subj:save:ASD` with valid fields updates the subject and writes one `subject.edit` audit row
    with `source: 'discord'`.
  - `adm:user:banok:<selfId>` is refused.
  - `adm:setup:run` while the lock is held gives the busy text.
  - `ops.runSetup` dry run returns `formatPlan` text, through the existing setup fakes.
  - The existing `/setup` and `/resync` command tests still pass.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/ui-admin.test.ts test/ops.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the bot suite and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(bot): admin panel interactions and /admin`.

### Task 10: `/setup` creates the panel channels and messages; docs

**Files:**
- Modify:
  - `apps/bot/src/setup/types.ts`: snapshot `textChannels: { id; name; parentId }[]` and
    `panelMessages: { panel: string | null; admin: string | null }` (from `bot_settings` + a fetch);
    `Action` gets `ensurePanelChannel` and `ensurePanelMessage`;
  - `plan.ts`, `apply.ts`, `discord.ts`, `load.ts` (read the settings);
  - `CLAUDE.md` (Bot specifics: panels, `custom_id` scheme, `/panel` `/admin`);
  - `apps/bot/README.md` (re-run `register`; the panels);
  - `docs/superpowers/specs/2026-10-14-admin-panel-round2-design.md` (one note that §1 shipped in this round)
- Test: `apps/bot/test/setup-plan.test.ts`, `setup-apply.test.ts`

**Interfaces:**
- Consumes: Tasks 6 and 8 (`studentPanel()`, `adminPanel()`).
- Produces:
  - Actions:
    - `{ type: 'ensurePanelChannel'; which: 'panel' | 'admin'; name: 'panel' | 'admin-panel'; existingId: string | null }`
    - `{ type: 'ensurePanelMessage'; which: 'panel' | 'admin'; channelId: string | null; messageId: string | null }`
  - `SetupGuild` methods:
    - `createTextChannel(o: { name: string; parentId: string | null; private: boolean; adminRoleId: string | null }): Promise<string>`
    - `postPanel(channelId: string, view: View): Promise<string>`
    - `editPanel(channelId: string, messageId: string, view: View): Promise<boolean>` (false = message gone)
  - Settings keys: `panel_channel_id`, `admin_panel_channel_id`, `panel_message_id`, `admin_panel_message_id`.
- Permission overwrites:
  - `panel`: @everyone gets ViewChannel and ReadMessageHistory and is denied SendMessages; the bot gets
    SendMessages and ManageMessages.
  - `admin-panel`: @everyone is denied ViewChannel; the admin role and the bot get ViewChannel; the admin role is
    denied SendMessages.
  - With no admin role yet, `admin-panel` is created after the role in the same run. `apply` orders the actions:
    role first.
- Edit-or-post: if `editPanel` returns false, post again and store the new id. Never post when edit succeeded.
- Parent: the existing category of the first subject's forum if present, else none.

- [ ] **Step 1: Write the failing tests:**
  - **plan:**
    - an empty snapshot gives `ensurePanelChannel` for both plus `ensurePanelMessage` for both, after the role
      actions;
    - a snapshot with both channels and stored message ids gives only `ensurePanelMessage` with the ids;
    - a channel id stored but the channel missing → recreate.
  - **apply** (fake guild):
    - the overwrites passed for `admin-panel` include the admin role id;
    - `editPanel` → true means no `postPanel`;
    - `editPanel` → false means `postPanel` and the setting updated;
    - running apply twice posts each panel once in total.
- [ ] **Step 2: Run** `pnpm --filter @studies/bot exec vitest run test/setup-plan.test.ts test/setup-apply.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement**, then update the docs.
- [ ] **Step 4: Run** the full verification:
  - `pnpm --filter @studies/db test`, `@studies/bot test`, `@studies/web test` and `@studies/worker test`, each
    on its own (the worker's soffice/pdftotext failures are pre-existing);
  - typecheck all four packages;
  - `pnpm lint`;
  - `pnpm --filter @studies/web e2e`.
  
  Expected: PASS.
- [ ] **Step 5: Commit** `feat(bot): /setup creates #panel and #admin-panel; docs`.

## After the plan (controller, not a task)

- Final whole-branch review: `discord-bot-reviewer` (timing, limits, permissions, the setup changes) and
  `sql-console-security-reviewer` (callback `next`, Server Actions, `user_groups`), both on the most capable model,
  then one fix wave.
- Merge to `main` and ask the user before pushing.
- Locally, run `pnpm db:migrate` and `pnpm --filter @studies/bot register`, restart the bot, then ask the user to
  run `/setup` on the server (the live Discord run is the user's call).
