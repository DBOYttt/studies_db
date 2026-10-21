# Timetable Assessments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The timetable shows a "Test" badge on the session a kolokwium happens in, an "Entry quiz" badge on every
session of classes with a wejściówka, and exam sessions as class-like "Exam" blocks — on the web and in Discord.

**Architecture:** Kolokwium events are matched to class sessions by time in one pure function in `packages/db`
(no stored link); entry quizzes are a new `class_marks` table with date-keyed skips; exam sessions are
`class_sessions.kind = 'exam'`, filled by the UniTime classifier and an optional second feed. Web and bot both call
one `annotateWeek()` that turns sessions + events + marks into badge-carrying `PlanSession`s.

**Tech Stack:** TypeScript, Drizzle + MariaDB, Next 16 / React 19, discord.js 14 (Components V2), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-timetable-assessments-design.md`

## Global Constraints

- UI copy is English per `docs/glossary.md`: wejściówka = "Entry quiz", kolokwium = "Test", egzamin = "Exam"; add
  these rows. Class/group tags and content stay Polish. Dates via `@studies/db/text` / existing en-GB helpers.
- Never `drizzle-kit push`. Schema migration via `drizzle-kit generate` (run in `packages/db`); views via
  `drizzle-kit generate --custom --name <name>`, statements separated by `--> statement-breakpoint`.
- New views go in `PUBLIC_VIEWS`; deleted rows hidden with `deleted_at IS NULL`. `studies_rw` gets DML on
  `class_marks` and `class_mark_skips` (`packages/db/src/readwrite-user.ts`).
- Domain writes run in `withTxRetry` (`packages/db/src/tx.ts`), refuse banned users with `BANNED_MESSAGE`, use the
  events' `CONFLICT` text for stale versions, and audit via `writeAudit` with actions `class_mark.add|edit|remove|
  restore|skip|unskip`, target `class_mark:<id>`.
- Every web page/route calls `requireUser()` itself; restore needs `requireAdmin()`. Bot `custom_id`s use the
  `ids.ts` codec, ≤ 100 chars; Discord text limits per `ui/limits.ts`.
- Tests share the test DB: run suites sequentially; `fileParallelism: false` stays.
- Commits signed as DBOYttt, no AI attribution; never push.

## Review Focus

1. A session that is cancelled or moved by the 6-hour sync: its kolokwium must fall back to a normal event block and
   its Entry quiz badge must disappear — Task 3 tests both.
2. An event without a group on a class with several groups at the same time: every group's session gets the badge,
   and the event is not drawn as a block too — Task 3.
3. Two students turning on the same entry quiz at once: exactly one active mark — Task 2 concurrency test.
4. An imported exam and a hand-added egzamin event for the same subject within ±60 min: shown once, as the imported
   block linking to the event — Task 3.
5. "My groups" filtering must apply to badges and exam blocks exactly as to sessions (no badge of a hidden group) —
   Task 5 view-model test and Task 7 bot test.

---

### Task 1: Schema, migrations, views, grants

**Files:**
- Modify: `packages/db/src/schema.ts` (new `classMarks`, `classMarkSkips`; `classSessions.kind`),
  `packages/db/src/constants.ts` (`CLASS_MARK_KINDS = ['wejsciowka'] as const`, `SESSION_KINDS = ['class', 'exam']
  as const`, `PUBLIC_VIEWS` += `v_class_marks`, `v_class_mark_skips`), `packages/db/src/readwrite-user.ts`
- Create: generated migration + custom migration `class_marks_views` (creates both views; recreates
  `v_class_sessions` with `kind`)
- Test: `packages/db/test/class-marks-schema.test.ts`, update `packages/db/test/readwrite-user.test.ts`

**Interfaces:**
- Produces: tables `class_marks` (id, class_id FK cascade NOT NULL, group_id FK cascade NULL, kind, note
  varchar(200), created_by, updated_by, created_at, updated_at, deleted_at, version int default 0) and
  `class_mark_skips` (id, mark_id FK cascade, on_date date, created_by, created_at, UNIQUE(mark_id, on_date));
  `class_sessions.kind` enum default `'class'`; views `v_class_marks` (non-deleted, with `class_kind`, `class_name`,
  `group_name`, `subject_id`) and `v_class_mark_skips` (skips of non-deleted marks); `v_class_sessions.kind`.

- [ ] **Step 1:** test: after `resetTestDb()` + migrations, insert a mark and a skip; `v_class_marks` shows it,
  soft-deleting the mark hides it and its skip from `v_class_mark_skips`; a duplicate (mark_id, on_date) skip fails;
  deleting the class cascades; `v_class_sessions` has `kind = 'class'` for an existing session; `studies_ro` can
  SELECT both views; `studies_rw` can INSERT/UPDATE/DELETE both tables.
- [ ] **Step 2:** run `pnpm --filter @studies/db exec vitest run test/class-marks-schema.test.ts` — FAIL.
- [ ] **Step 3:** add schema, constants, grants; generate both migrations.
- [ ] **Step 4:** run the test + `pnpm --filter @studies/db test` + typecheck — PASS.
- [ ] **Step 5:** commit `feat(db): class marks and session kind schema`.

### Task 2: Entry quiz domain logic

**Files:**
- Create: `packages/db/src/class-marks.ts`; export from `packages/db/src/index.ts`
- Test: `packages/db/test/class-marks.test.ts`

**Interfaces:**
- Consumes: Task 1 tables; `withTxRetry`, `writeAudit`, `checkUser`/`BANNED_MESSAGE`, `CONFLICT` from `events.ts`.
- Produces:
  - `type MarkResult = { ok: true; message: string; id: number; version: number } | { ok: false; message: string }`
  - `addMark(db, userId, { classId, groupId: number | null, kind: 'wejsciowka', note?: string | null }, source)`
  - `editMark(db, userId, id, { note: string | null }, { expectedVersion }, source)`
  - `removeMark(db, userId, id, { expectedVersion? }, source)` (soft delete)
  - `restoreMark(db, adminId, id, source)` (refuses when another active mark exists for the same class/group/kind)
  - `skipDate(db, userId, markId, onDate: string /* YYYY-MM-DD */, source)`, `unskipDate(db, userId, markId, onDate, source)`
  - `listMarks(db, classIds: number[]): Promise<ClassMark[]>` where `ClassMark = { id, classId, groupId, kind, note,
    version, skips: string[], deletedAt: Date | null, updatedByName: string | null }` (deleted marks included only
    when `{ includeDeleted: true }` is passed — for the admin restore view)
  - Messages (exact): `'Entry quiz is already on for this class.'`, `'This group is not part of the class.'`,
    `'Class not found.'`, `'Entry quiz not found.'`, `'There is no session of this class on that date.'`,
    `'This week is already skipped.'`; success: `'Entry quiz turned on.'`, `'Entry quiz turned off.'`,
    `'Note saved.'`, `'Skipped for that week.'`, `'Skip undone.'`, `'Entry quiz restored.'`.
  - `source: 'web' | 'discord'` goes into the audit `details`.

- [ ] **Step 1:** tests: add → active mark + audit `class_mark.add`; second add same class/group → already-on
  message; add for all groups and for group 2 are both allowed; group of another class → refused; banned user →
  `BANNED_MESSAGE`; two concurrent `addMark` (Promise.all) → exactly one ok; edit with stale version → `CONFLICT`;
  skip on a date with a confirmed session → ok, without one → refused, twice → already skipped; unskip; remove → gone
  from `listMarks`; restore (admin) → back; restore while another active one exists → already-on message; every
  change writes the right audit action.
- [ ] **Step 2:** run the test file — FAIL.
- [ ] **Step 3:** implement; the duplicate check is `SELECT … FOR UPDATE` on (class_id, group_id ⟨IS NULL⟩, kind,
  deleted_at IS NULL) inside the tx; "session on that date" checks `class_sessions` (kind class, confirmed,
  same class, group = mark group or mark group NULL, `DATE(starts_at) = onDate`).
- [ ] **Step 4:** run the file + `pnpm --filter @studies/db test` + typecheck — PASS.
- [ ] **Step 5:** commit `feat(db): entry quiz marks`.

### Task 3: Week annotation (pure) and its loader

**Files:**
- Create: `packages/db/src/plan-annotate.ts` (pure), `packages/db/src/plan-marks.ts` (RO-pool loader); export both
  (also via the `@studies/db/plan` subpath if web imports plan code from there)
- Modify: `packages/db/src/plan.ts` (`PlanSession` gains `sessionKind?: 'class' | 'exam'` and
  `badges?: PlanBadge[]`; `toPlanSession` and `weekSessionsQuery` read `cs.kind`)
- Test: `packages/db/test/plan-annotate.test.ts`, `packages/db/test/plan-marks.test.ts`

**Interfaces:**
- Produces:
  - `type PlanBadge = { kind: 'test'; eventIds: number[]; titles: string[] } | { kind: 'entry_quiz'; markId: number; note: string | null }`
  - `type WeekMark = { id: number; classId: number; groupId: number | null; note: string | null; skips: string[] }`
  - `annotateWeek(sessions: PlanSession[] /* classes and events mixed */, marks: WeekMark[]): PlanSession[]` —
    returns class sessions with `badges`, kolokwium events that matched removed, unmatched events kept, and
    `egzamin` events that duplicate an exam session removed (the exam session gets `badges` untouched but
    `linkedEventId?: number` set — add this optional field to `PlanSession`).
  - `matchEventsToSessions(sessions, events): { badges: Map<number /* session id */, number[] /* event ids */>; matched: Set<number> }`
  - `listWeekMarks(pool, classIds: number[]): Promise<WeekMark[]>` reading `v_class_marks` + `v_class_mark_skips`.
- Matching rule (spec §1): session `type 'class'`, `sessionKind !== 'exam'`, `status 'confirmed'`; same `subjectId`
  and `classId`; event `groupId` null or equal; `startsAt` in `[session.startsAt, session.endsAt)` same wall day;
  event `eventKind === 'kolokwium'`, not all-day.
- Entry quiz rule: confirmed class session, mark for its `classId` with `groupId` null or equal, session date
  (`YYYY-MM-DD` of the wall `startsAt`) not in `skips`.
- Exam dedup: `egzamin` event and a session with `sessionKind 'exam'`, same `subjectId`, `|start difference| ≤ 60 min`.

- [ ] **Step 1:** tests for `annotateWeek`: event at session start → badge, event removed; at session end (exclusive)
  → no badge; other group → no badge; no group on a 3-group class → all three sessions badged, event removed once;
  two tests on one session → one badge with two ids; cancelled session → event kept as block; other day → kept;
  all-day kolokwium → kept; trip kind inside a session → kept; entry quiz on a group mark, all-groups mark, skipped
  date, cancelled session; exam dedup inside and outside ±60 min; exam sessions never get Test badges.
  `listWeekMarks` against the test DB returns marks with skips and omits deleted marks.
- [ ] **Step 2:** run both files — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run both + `pnpm --filter @studies/db test` + typecheck — PASS.
- [ ] **Step 5:** commit `feat(db): annotate the week with tests, entry quizzes and exams`.

### Task 4: UniTime exams

**Files:**
- Modify: `packages/db/src/unitime/classify.ts` (`ClassifiedEvent.sessionKind: 'class' | 'exam'`; exam prefixes),
  `packages/db/src/unitime/sync.ts` (`syncTimetable(db, ics, opts?: { allExams?: boolean; source?: 'classes' | 'exams' })`
  stores `kind`; exam rows have `class_id` null; a sync of one source never cancels the other source's rows),
  `apps/worker/src/plan-sync.ts` (optional `UNITIME_EXAM_ICAL_URL`: fetched after the class feed, failure recorded
  with `SafeSyncError` handling and the host only, class feed unaffected), `.env.example`
- Test: `packages/db/test/unitime-classify.test.ts`, `packages/db/test/unitime-sync.test.ts`,
  `apps/worker/test/plan-sync.test.ts`

**Interfaces:**
- Exam prefixes (folded, longest first, same "next char is not a letter" rule as class prefixes): `egzamin`,
  `exam`, `egz.`, `zaliczenie`, `kolokwium zaliczeniowe` → `sessionKind: 'exam'`, `kind: null` (no "Unknown class
  type" warning for them).
- To keep sources apart, `class_sessions` rows from the exam feed are recognisable: add `source` enum(`classes`,
  `exams`) default `classes` in this task's migration (`drizzle-kit generate`), and scope "cancel rows missing from
  the feed" to the same source.

- [ ] **Step 1:** tests: classify "Egzamin", "egz. pisemny", "Exam", "Zaliczenie", "Kolokwium zaliczeniowe" → exam;
  "Egzaminatorium" → not exam; sync of a feed with one class and one exam stores kinds correctly; exam feed with
  `allExams` stores every entry as exam; exam feed sync doesn't cancel class rows and vice versa; rescheduled exam
  updates in place; worker: exam URL unset → only class feed; exam fetch failure → status records a host-only message
  and class sessions still sync.
- [ ] **Step 2:** run the files — FAIL.
- [ ] **Step 3:** implement; document `UNITIME_EXAM_ICAL_URL` in `.env.example`.
- [ ] **Step 4:** run them + db and worker suites (worker: soffice/pdftotext tests now pass with the tools installed)
  + typechecks — PASS.
- [ ] **Step 5:** commit `feat(sync): exam sessions from UniTime`.

### Task 5: Web timetable display

**Files:**
- Modify: `apps/web/components/plan/PlanWeekTab.tsx` (load marks for the week's class ids via `listWeekMarks`, call
  `annotateWeek` before My groups filtering), `apps/web/components/plan/WeekView.tsx` (badges on session blocks,
  exam block style + legend entry, entry-quiz popover), `apps/web/lib/plan-view.ts` (`badgeLabel(b: PlanBadge):
  string` → "Test", "2 tests", "Entry quiz"; `toWeekSession` carries `badges`, `sessionKind`, `linkedEventId`)
- Create: `apps/web/lib/class-mark-actions.ts` (`'use server'`: `skipMarkAction(markId, onDate)`,
  `unskipMarkAction`, `addMarkAction`, `editMarkAction`, `removeMarkAction`, `restoreMarkAction`; each calls
  `requireUser()` / `requireAdmin()`, revalidates the plan and subject pages)
- Test: `apps/web/test/plan-view.test.ts`, `apps/web/test/class-mark-actions.test.ts`, `apps/web/e2e/plan.spec.ts`

**Interfaces:**
- Consumes: Task 3 `annotateWeek`, `listWeekMarks`, `PlanBadge`; Task 2 functions.
- Badge UI: Test badge links to the event page (`eventPageHref`); title(s) in `title`/aria-label
  ("Test: <title>"); Entry quiz badge is a button opening a popover with the note, "Not this week" and "Edit" (Edit
  links to the subject page's entry quiz section). Exam blocks: label "Exam", exam colour token in the legend; with
  `linkedEventId` the block links to that event.
- Filtering order: `annotateWeek` first, then `filterMyGroups` (badges travel with their session).

- [ ] **Step 1:** tests: view model shows "Test", "2 tests", "Entry quiz"; an exam session renders as exam kind; My
  groups hiding group 1 hides its badge; actions refuse a missing session (`requireUser` mocked like existing action
  tests). e2e: seed a kolokwium inside a lab session → the week view shows a "Test" badge on that block and no
  separate event block; turn on an entry quiz (via `addMark` in the e2e fixture), "Not this week" removes the badge
  for that week only.
- [ ] **Step 2:** run them — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `pnpm --filter @studies/web test`, the plan e2e, typecheck, `pnpm check:lang`, lint — PASS.
- [ ] **Step 5:** commit `feat(web): tests, entry quizzes and exams on the timetable`.

### Task 6: Web editing — session picker, "+ Test", entry quiz section

**Files:**
- Modify: `apps/web/components/events/EventForm.tsx` ("Pick a session" select when type is Test and a class is set),
  `apps/web/lib/event-form-page.ts` (loads the options), `apps/web/components/plan/WeekView.tsx` ("+ Test" on session
  blocks → `newTestHref(session, simple)`), `apps/web/lib/plan-events.ts` (`newTestHref`), the subject pages
  `apps/web/app/(simple)/s/subjects/[code]/page.tsx` and `apps/web/app/(app)/subjects/[code]/page.tsx` (class
  section "Entry quiz every session")
- Create: `apps/web/components/plan/EntryQuizSection.tsx`, `apps/web/lib/session-options.ts`
  (`upcomingSessionOptions(pool, classId, groupId | null, fromWall, limit = 20): Promise<{ value: string /* session id */; label: string; date: string; from: string; to: string; room: string | null }[]>`,
  label like "Wed 21 Oct, 10:00–11:30 · B-2 202")
- Test: `apps/web/test/session-options.test.ts`, `apps/web/test/plan-events.test.ts`, `apps/web/e2e/events.spec.ts`

**Interfaces:**
- Consumes: Task 5 actions, Task 2 `listMarks`.
- `newTestHref` → `/[s/]wydarzenia/nowe?kind=kolokwium&subject=…&class=…&group=…&session=<id>`; the form reads
  `session` and pre-fills date/time/room. Picking a session in the select fills the "When" field as
  `DD.MM.YYYY HH:MM-HH:MM` and the place.
- Entry quiz section: all groups / one group select, note, "Turn on"; when on: note edit (version-checked), "Turn off",
  skipped dates with "Undo"; admins see turned-off marks with "Restore".
- Discord confirmation is Task 7.

- [ ] **Step 1:** tests: `upcomingSessionOptions` lists only confirmed class sessions of that class/group after
  `fromWall`, with the label format above; `newTestHref` query; e2e: "+ Test" on a lab block opens the form with the
  session pre-picked, saving shows the Test badge on that block; on the subject page turn on an entry quiz, see
  "Turn off" and the badge on the timetable.
- [ ] **Step 2:** run them — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** web tests, the events/plan e2e, typecheck, `pnpm check:lang`, lint — PASS.
- [ ] **Step 5:** commit `feat(web): add tests on sessions and manage entry quizzes`.

### Task 7: Bot — plan images, panel, digest, event confirmation

**Files:**
- Modify: `apps/bot/src/ui/student.ts` (`planData` calls `listWeekMarks` + `annotateWeek` before
  `filterMyGroups`; new actions `quizOpen`, `quizSubject:<subjectId>`, `quizClass:<classId>:<groupId|0>`,
  `quizToggle:<classId>:<groupId|0>`, `quizSkip:<markId>:<YYYYMMDD>`), `apps/bot/src/ui/views/student.ts` (badge text
  in `sessionLine`/day/week lines; an "Entry quizzes" button on the student panel; quiz views), `apps/bot/src/ui/plan-image.ts`
  (badge text in `weekLines`/`dayLines`, exam colour, legend), `apps/bot/src/reminders.ts` + `packages/db/src/reminders.ts`
  (`dueEntryQuizzes(pool, now): Promise<{ subjectName, className, groupName }[]>` for tomorrow; digest appends
  "Entry quiz: <subject>, <class> <group>" lines; posted once per day via setting `digest_quiz_date` = tomorrow's
  `YYYY-MM-DD`, also when there are no events), `apps/bot/src/ui/events.ts` (after a save whose time falls in a
  session: "Shown on <class> <group>, <Ddd D Mon>")
- Test: `apps/bot/test/plan-image.test.ts`, `apps/bot/test/ui-student-views.test.ts` (or the existing student view
  test file), `apps/bot/test/reminders.test.ts`, `apps/bot/test/ui-events.test.ts`, limits tests

**Interfaces:**
- Consumes: Task 3 (`annotateWeek`, `listWeekMarks`, `PlanBadge`), Task 2 (`addMark`, `removeMark`, `skipDate`,
  `listMarks`) with `source: 'discord'`; banned users get `BANNED_MESSAGE`.
- Week image line: "Laboratorium Gr. 2 · Test" / "· Entry quiz" (both when both); day view: one extra line per
  badge ("Test: <title>", "Entry quiz"). Panel quiz flow: subject select → class/group select (≤ 25 options) →
  view with "Turn on"/"Turn off" and a "Not this week" select of the next 5 session dates.
- `custom_id`s ≤ 100 chars (assert in tests).

- [ ] **Step 1:** tests: `weekLines`/`dayLines` include badge text and keep "Laboratorium Gr. 2" unchanged; exam
  blocks use the exam colour; panel quiz views stay within limits and their ids decode; toggling calls
  `addMark`/`removeMark` and replies with their message; skip calls `skipDate`; digest text includes entry quiz
  lines and posts once per day (second tick same day → nothing); "Shown on …" appears only when the time is inside a
  session; My groups hides badges of hidden groups.
- [ ] **Step 2:** run them — FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `pnpm --filter @studies/bot test`, db tests (reminders), typechecks, `pnpm check:lang`, lint — PASS.
- [ ] **Step 5:** commit `feat(bot): tests, entry quizzes and exams in Discord`. Report: run
  `pnpm --filter @studies/bot register` only if command definitions changed (they should not).

### Task 8: Docs and full verification

- [ ] **Step 1:** `CLAUDE.md` "Schedule events": one paragraph on tests-on-sessions (time matching, no stored link),
  `class_marks`/skips (any student, audited, admin restore on the subject page), exam sessions (`kind`, `source`,
  `UNITIME_EXAM_ICAL_URL`). `docs/glossary.md`: Entry quiz, Test badge, Exam, Not this week, Pick a session.
  `docs/deploy.md`: run `pnpm db:migrate`; optional `UNITIME_EXAM_ICAL_URL`.
- [ ] **Step 2:** sequentially: `pnpm check:lang`, `pnpm test`, the four typechecks, `pnpm lint`,
  `pnpm --filter @studies/web e2e` — all PASS.
- [ ] **Step 3:** commit `docs: timetable assessments`.

## Notes

- Bot has no event restore; entry-quiz restore is web-only (subject page, admins), matching where event restore lives.
- Leftover found while planning: the digest thread name `DIGEST_THREAD_NAME = '📅 Przypomnienia'`
  (`apps/bot/src/reminders.ts:32`) is still Polish — round 5 item (renaming a live thread needs the legacy-title
  handling used by `/setup`).
