# Timetable import, Plan zajęć and Courses+ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the AGH UniTime iCalendar timetable into the database (subjects, class kinds, groups, lecturers, sessions), keep it synced, show it as a "Plan zajęć" week view, and add the Courses+ fields (office hours, room, assessment, platform links).

**Architecture:** Pure iCal parsing/classification and a transactional `syncTimetable` live in `packages/db/src/unitime/`; the worker fetches the private URL and runs the sync on a loop; the bot gets admin commands for sync and the new fields; the web reads `v_class_sessions` on the RO pool and renders a client week grid filtered by a localStorage "Moje grupy" map.

**Tech Stack:** TypeScript, Drizzle ORM + MariaDB 11, discord.js, Next 16 (webpack, app router), vitest, Playwright, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-12-timetable-import-design.md`

## Global Constraints

- `UNITIME_ICAL_URL` is secret: never committed, never stored in the DB, never logged or put in an error message/`last_error` (log/print the host only: `new URL(url).host`).
- New class kinds are appended, order fixed: `wyklad, laboratorium, cwiczenia, projekt, seminarium, praktyczne, wf`; names `Zajęcia praktyczne`, `WF`.
- View changes only append columns at the END of existing views (saved queries keep working).
- `class_sessions.starts_at/ends_at/occurrence_start` hold **Europe/Warsaw wall time**. In JS they are "wall Dates": a `Date` whose UTC fields equal the wall clock (`Date.UTC(y, m-1, d, h, mi)`); the pool uses `timezone: 'Z'`, so they round-trip unchanged. Never format them with `formatDate`/`timeZone: 'Europe/Warsaw'` — use UTC getters or `timeZone: 'UTC'`. (The spec's "like the rest of the app" is inaccurate: `created_at` etc. are UTC instants; `plan_sync` timestamps are UTC instants too.)
- Import never deletes subjects, classes, groups, lecturers, assignments or Discord-owned rows; it never renames an existing subject or lecturer.
- UI copy is Polish; phpMyAdmin look, light + dark themes; use the taste skills (`design-taste-frontend`, `minimalist-ui`) for UI tasks.
- localStorage key for my groups: `studiesdb.myGroups.v1`, value `{ "<class_id>": <group_id> }`.
- Test fixtures contain no real e-mail addresses (`@example.edu` only).
- Commands: `export PATH=$HOME/.local/bin:$PATH` first; unit tests `pnpm test` (root) or `pnpm --filter <pkg> test`; lint `pnpm lint`; web typecheck `pnpm --filter @studies/web exec tsc --noEmit`; e2e `pnpm --filter @studies/web e2e`. Dev DB must be up (`pnpm db:up`).

## Review Focus

1. **DST weeks** — the semester crosses the 2026-10-25 DST change; a weekly RRULE at 08:00 must stay 08:00 wall time on both sides, and `UNTIL` (given in UTC `Z`) must still include the last 08:00 occurrence. Test in Task 2.
2. **Re-run with an edited feed** — moved room / changed time / removed event / `STATUS:CANCELLED` must update, delete or mark without duplicating rows, and a second identical run reports all zeros. Test in Task 4.
3. **Pre-existing data** — a subject or lecturer typed in by an admin earlier (same e-mail, or a code the generator would pick) must be matched/suffixed, never overwritten or crashing on a unique key. Test in Task 4.
4. **Broken / hostile feed** — HTTP 500, HTML login page instead of `text/calendar`, >5 MB body, timeout: sync aborts, previous sessions kept, `last_error` set without the URL. Test in Task 5.
5. **Moje grupy with stale data** — localStorage pointing at a deleted class/group or holding garbage JSON must not hide everything or throw; it is ignored per entry. Test in Task 7.

---

### Task 1: Migration 0006 — schema, kinds, views

**Files:**
- Modify: `packages/db/src/constants.ts` (CLASS_KINDS, CLASS_NAMES, PUBLIC_VIEWS += `v_class_sessions`, new `ASSESSMENTS`, `ASSESSMENT_NAMES`)
- Modify: `packages/db/src/schema.ts` (columns below, `classSessions`, `planSync` tables)
- Modify: `packages/db/src/hierarchy.ts` (`CLASS_ALIASES`; `ensureGroup` optional `name`)
- Create: `packages/db/migrations/0006_timetable.sql` (+ `meta/0006_snapshot.json`, `_journal.json` entry) via `pnpm --filter @studies/db exec drizzle-kit generate --name timetable`, then append the view statements by hand with `--> statement-breakpoint`
- Test: `packages/db/test/timetable-schema.test.ts`; adjust any test asserting the old kind list / view list

**Interfaces — Produces:**
- `CLASS_KINDS` (7 kinds above); `ASSESSMENTS = ['egzamin','kolokwium','projekt','sprawozdania','zaliczenie'] as const`, `type Assessment`, `ASSESSMENT_NAMES: Record<Assessment,string>` = Egzamin, Kolokwium, Projekt, Sprawozdania, Zaliczenie.
- Drizzle: `subjects.discordChannelId` nullable, `subjects.platformUrl`, `subjects.unitimeName` (unique); `lecturers.email` unique, `lecturers.officeHours`, `lecturers.room`; `classes.assessment`, `classes.assessmentNote`, `classes.platformUrl`; `classSessions` {id, uid varchar(100), occurrenceStart, subjectId FK cascade, classId FK set null, groupId FK set null, lecturerId FK set null, label varchar(100), room varchar(100), startsAt, endsAt, status enum('confirmed','cancelled') default confirmed, sequence int, updatedAt default CURRENT_TIMESTAMP}, unique `uq_class_sessions_occurrence(uid, occurrence_start)`, index `idx_class_sessions_starts(starts_at)`; `planSync` {id int PK (always 1), requestedAt, lastRunAt, lastOkAt, lastError text, stats json}.
- `ensureGroup(db, classId, number, name = groupName(number)): Promise<number>`.
- `CLASS_ALIASES` adds `praktyczne`, `zajecia praktyczne` → praktyczne; `wf`, `wychowanie fizyczne` → wf (keys are already accent-stripped lower-case).
- Views (appended columns): `v_subjects` … `, platform_url, unitime_name`; `v_lecturers` … `, office_hours, room`; `v_classes` … `, assessment, assessment_note, platform_url`. New `v_class_sessions`: `cs.id, cs.starts_at, cs.ends_at, cs.subject_id, s.name AS subject_name, cs.class_id, c.kind AS class_kind, c.name AS class_name, cs.group_id, g.name AS group_name, cs.lecturer_id, l.name AS lecturer_name, cs.room, cs.label, cs.status` (LEFT JOINs for class/group/lecturer). The migration also `INSERT IGNORE INTO plan_sync (id) VALUES (1)`.
- `ensureReadonlyUser` needs no change (iterates `PUBLIC_VIEWS`); `plan_sync`/`class_sessions` are NOT granted.

- [ ] **Step 1: Write failing tests** in `timetable-schema.test.ts` (pattern: `hierarchy-schema.test.ts`, `resetTestDb`):
  - `SHOW COLUMNS FROM v_subjects` last two = `platform_url, unitime_name`; `v_lecturers` last two = `office_hours, room`; `v_classes` last three = `assessment, assessment_note, platform_url`.
  - `v_class_sessions` columns equal exactly the list above, in order.
  - Inserting two subjects with `discordChannelId: null` succeeds; two lecturers with the same email throws `ER_DUP_ENTRY`; two with null email succeed.
  - `ensureClass(db, sid, 'wf')` works and the class name is `WF`; `ensureGroup(db, cid, 128, 'M-128')` stores name `M-128`; `ensureGroup(db, cid, 3)` stores `Gr. 3`.
  - Duplicate `(uid, occurrence_start)` in `class_sessions` throws.
  - `SELECT * FROM plan_sync` returns exactly one row with id 1.
  - RO connection (`testRoUrl()`) can `SELECT * FROM v_class_sessions` and gets an error on `SELECT * FROM plan_sync` and `class_sessions`.
  - `classifyTags(['Zajęcia praktyczne'])` → praktyczne; `classifyTags(['WF'])` → wf.
- [ ] **Step 2:** `pnpm --filter @studies/db test -- timetable-schema` → FAIL.
- [ ] **Step 3:** Implement constants/schema/hierarchy, generate the migration, append the 4 `CREATE OR REPLACE VIEW` statements and the `plan_sync` seed insert. Check the generated SQL makes `discord_channel_id` nullable without dropping its unique index.
- [ ] **Step 4:** `pnpm --filter @studies/db test` → PASS; `pnpm test` and `pnpm --filter @studies/web exec tsc --noEmit` — fix every `Record<ClassKind, …>` / exhaustive switch the new kinds break (web icons/order maps, bot choices) and tests pinned to the old lists. `pnpm db:migrate` on the dev DB succeeds.
- [ ] **Step 5: Commit** `feat(db): timetable schema — class sessions, plan sync, course fields, new class kinds`

### Task 2: iCalendar parser and occurrence expansion

**Files:**
- Create: `packages/db/src/unitime/ics.ts`, `packages/db/src/unitime/index.ts` (re-exports), export `./unitime` from `packages/db/src/index.ts`
- Create: `packages/db/test/fixtures/unitime.ics` (see Step 1), `packages/db/test/unitime-ics.test.ts`

**Interfaces — Produces:**
```ts
type WallTime = Date; // UTC fields = Europe/Warsaw wall clock
interface IcsEvent {
  uid: string; sequence: number; status: 'confirmed' | 'cancelled';
  summary: string; description: string; location: string;
  organizer: { cn: string; email: string | null } | null;
  start: WallTime; end: WallTime;
  rrule: { until: WallTime | null; byDay: number[] /* 0=Sun..6=Sat */ } | null;
  rruleUnsupported: boolean; exdates: WallTime[];
}
interface IcsCalendar { name: string; events: IcsEvent[] }
parseIcs(text: string): IcsCalendar
expandOccurrences(ev: IcsEvent): { start: WallTime; end: WallTime }[]
utcToWarsawWall(utc: Date): WallTime   // via Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw', hourCycle:'h23',…})
```
Rules: unfold `CRLF`/`LF` + single space or tab; property name/params split at the first unquoted `:`; params may be quoted (`CN="…, J"`); unescape `\n`/`\N`→newline, `\,` `\;` `\\`. `DTSTART;TZID=Europe/Warsaw:YYYYMMDDTHHMMSS` → wall Date as-is; a value ending in `Z` → `utcToWarsawWall`. `UNTIL=…Z` → `utcToWarsawWall`. `EXDATE` may hold a comma list. Missing `STATUS` → confirmed. RRULE other than `FREQ=WEEKLY` (optional `UNTIL`, `BYDAY`, `WKST`, `INTERVAL=1`) → `rrule: null, rruleUnsupported: true`. Weekly with no UNTIL and no COUNT → unsupported too. Expansion: for each week from the start week, each BYDAY (default: start's weekday), occurrence wall start = that date + start's wall time, keep if ≥ start and ≤ until and not in exdates; duration = end − start.

- [ ] **Step 1: Build the fixture.** From the real file (`$SCRATCH/ical/agh.ics`, not in the repo) write a script in the scratchpad that keeps the header + ~25 VEVENTs covering: every DESCRIPTION prefix (Wykład, CWA, CWL, Ćwiczenia projektowe, Zajęcia seminaryjne, Zajęcia praktyczne, all four `Hala O_TPR_*`), one RRULE+EXDATE event per Hala, two events of the same lecturer, and replaces every `mailto:x@agh.edu.pl` with `mailto:lecturerN@example.edu` (stable N per address). Add by hand: one folded long line, one `STATUS:CANCELLED` event, one event with an unknown prefix `Konsultacje 1`. Verify `grep -c agh.edu.pl` = 0.
- [ ] **Step 2: Write failing tests:** fixture parse → `name` = `O-TPR-1 S1 harmonogram dla Semestr zimowy 2026`, event count = number of VEVENTs in the fixture; a description `CWL 5b\ndr hab. inż. Malinowski\, P` decodes to two lines with a literal comma; quoted CN with comma parsed; folded line rejoined; Hala event `rrule.byDay = [5]`, `exdates` contains 2026-12-25 08:00 and 2027-01-01 08:00; `expandOccurrences` of the WF event gives Fridays 08:00 from its start to 2027-01-22 inclusive minus the two exdates, all at 08:00 wall time on both sides of 2026-10-25 (DST); a non-recurring event expands to itself; `FREQ=DAILY` → `rruleUnsupported` and expands once.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** `feat(db): UniTime iCalendar parser with weekly expansion`

### Task 3: Event classification, lecturer names, subject codes

**Files:**
- Create: `packages/db/src/unitime/classify.ts`; Test: `packages/db/test/unitime-classify.test.ts`

**Interfaces — Consumes:** `IcsEvent`, `ClassKind`, `stripMarks` (search.ts). **Produces:**
```ts
interface ParsedLecturer { title: string | null; name: string; email: string | null }
interface ClassifiedEvent {
  subjectName: string; yearOfStudy: number | null; // from "(1rok)"
  kind: ClassKind | null; groupNumber: number | null; groupName: string | null;
  label: string; lecturer: ParsedLecturer | null; room: string | null;
}
classifyEvent(ev: IcsEvent): ClassifiedEvent
parseLecturerCn(cn: string, email: string | null): ParsedLecturer
subjectCode(name: string, taken: ReadonlySet<string>): string
semesterFor(calendarName: string, yearOfStudy: number | null): number
```
Prefix table exactly as spec §"Type mapping" (match on `stripMarks(lower)`; longest prefix first). Group = digits right after the prefix (`5b` → 5); `groupName` = null for normal kinds (caller uses `Gr. N`); WF `Hala O_TPR_M-128` → kind `wf`, group 128, groupName `M-128` (`K`/`M` from `_K`/`_M`). Unknown prefix → kind null, group null. `label` = first DESCRIPTION line (max 100 chars). Lecturer from ORGANIZER (fallback: DESCRIPTION second line, no email). `parseLecturerCn`: `"dr hab. inż. Piekło, J"` → title `dr hab. inż.`, name `J. Piekło`; title = longest leading run of tokens from {`prof.`, `dr`, `hab.`, `inż.`, `mgr`, `lic.`}; no comma → remaining text is the name. `subjectName` strips trailing ` (Nrok)`. `subjectCode`: ASCII-folded words; words containing digits contribute their digits, words with ≥3 letters their initial; uppercase; max 20; empty → `PRZ`; on collision append `-2`, `-3`…. `semesterFor`: `zimowy` → `(year-1)*2+1`, `letni` → `(year-1)*2+2`, unknown year → 1 / 2.

- [ ] **Step 1: Failing tests** (table-driven): each spec prefix incl. `Ćwiczenia projektowe 1` → projekt/1, `CWA 2a` → cwiczenia/2, `Zajęcia seminaryjne 3` → seminarium/3, `Zajęcia praktyczne 1b` → praktyczne/1, `Hala O_TPR_K-127` → wf/127/`K-127`, `Konsultacje 1` → null/null with label `Konsultacje 1`; lecturer CNs `dr hab. inż. Piekło, J` / `prof. dr hab. inż. Nowak, A` / `mgr Kowalski` (→ title `mgr`, name `Kowalski`); codes: `Programowanie w języku Python`→`PJP`, `Przemysł 4.0`→`P40`, `Wychowanie Fizyczne 1`→`WF1`, `Zapis konstrukcji i grafika inżynierska`→`ZKGI`, `Algebra liniowa` with `{'AL'}` taken → `AL-2`; `semesterFor('… Semestr zimowy 2026', 1)` = 1.
- [ ] **Step 2–4:** Run FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(db): classify UniTime events, lecturer names and subject codes`

### Task 4: `syncTimetable` and plan-sync status

**Files:**
- Create: `packages/db/src/unitime/sync.ts`, `packages/db/src/unitime/status.ts`; Test: `packages/db/test/unitime-sync.test.ts`

**Interfaces — Consumes:** Tasks 1–3, `ensureClass`, `ensureGroup`. **Produces:**
```ts
interface SyncStats { created: number; updated: number; deleted: number; unchanged: number; warnings: string[] }
syncTimetable(db: Db, ics: string): Promise<SyncStats>   // one transaction
interface PlanSyncStatus { requestedAt: Date|null; lastRunAt: Date|null; lastOkAt: Date|null; lastError: string|null; stats: SyncStats|null }
getPlanSyncStatus(db: DbExecutor): Promise<PlanSyncStatus>
requestPlanSync(db: DbExecutor, now?: Date): Promise<void>
recordPlanSync(db: DbExecutor, r: { at: Date; ok: true; stats: SyncStats } | { at: Date; ok: false; error: string }): Promise<void>
// ok: last_run_at=last_ok_at=at, last_error=NULL, stats; error: last_run_at=at, last_error=error (truncated 1000), stats kept
```
Steps inside the transaction exactly as spec §2 1–6. Subject upsert key `unitime_name` = raw SUMMARY; new subjects: `name` = stripped name, generated code (taken = all existing codes), `semester = semesterFor`, `ects 0`, `discordChannelId null`. Lecturers by email (case-insensitive, lower-cased on insert); no email → match by exact `name`+`title`, else create. `class_lecturers` ensured per (class, lecturer, group) with the NULL-group check as in `assignLecturer`. Session compare fields: subject/class/group/lecturer ids, label, room, starts_at, ends_at, status, sequence → `updated` when any differs else `unchanged`. Delete sessions not in the feed's (uid, occurrence_start) set (chunk the `NOT IN` or diff in memory). Warnings: `Nieznany typ zajęć: <label>` / `Nieobsługiwana reguła powtarzania: <uid>`, deduplicated, max 50. Parse first (outside the transaction) so a parse error writes nothing.

- [ ] **Step 1: Failing tests** against the Task 2 fixture:
  - first run: subjects count = distinct SUMMARYs, sessions = sum of `expandOccurrences`, `created` = that sum, `deleted` 0; WF groups named `K-127`, `M-128`…; `class_lecturers` has the group-specific rows; cancelled event → status `cancelled`; unknown-prefix event → class_id NULL and one warning.
  - second run on the same text: `{created:0, updated:0, deleted:0}`, `unchanged` = sum.
  - edited copy (one LOCATION changed, one VEVENT removed, one STATUS→CANCELLED): `updated` = occurrences of the two changed events, `deleted` = occurrences of the removed one; subjects/lecturers counts unchanged.
  - pre-existing lecturer `{name:'Jarosław Piekło', email:'LECTURER1@example.edu'}` (matching the fixture's address case-insensitively) is reused and keeps its name; pre-existing subject with code equal to a generated code → new subject gets `-2`; pre-existing subject with a Discord channel is untouched.
  - garbage input (`'not a calendar'`) throws and leaves the DB unchanged.
  - status: `requestPlanSync` then `getPlanSyncStatus` → requestedAt set; `recordPlanSync` ok/error semantics above; stats round-trips as JSON.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm --filter @studies/db test`).
- [ ] **Step 5: Commit** `feat(db): transactional timetable sync with status tracking`

### Task 5: Worker sync loop and configuration

**Files:**
- Create: `apps/worker/src/plan-sync.ts`; Test: `apps/worker/test/plan-sync.test.ts`
- Modify: `apps/worker/src/index.ts`, `.env.example`, `docs/deploy.md` (and the compose worker env if it lists vars explicitly), local `.env` (controller sets the real value — not committed)

**Interfaces — Consumes:** Task 4. **Produces:**
```ts
fetchTimetable(url: string, o?: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch }): Promise<string>
  // defaults 30_000 ms, 5*1024*1024 bytes; error messages name only the host
planSyncDue(s: PlanSyncStatus, now: Date, intervalMs: number): boolean
  // lastRunAt null || now-lastRunAt >= interval || (requestedAt && (!lastRunAt || requestedAt > lastRunAt))
runPlanSyncOnce(deps: { db: Db; url: string; fetchImpl?: typeof fetch; now?: () => Date }): Promise<void>
  // fetch + syncTimetable + recordPlanSync; never throws
startPlanSyncLoop(deps: { db: Db; url: string | undefined; signal: AbortSignal; intervalMs?: number /*6h*/; pollMs?: number /*60_000*/ }): Promise<void>
```
Content-type must contain `text/calendar` (else error `Nieprawidłowy typ odpowiedzi (<type>) z <host>`); HTTP ≥400 → `HTTP <status> z <host>`; size checked while streaming. URL missing → log `Plan: UNITIME_ICAL_URL nie ustawiony — synchronizacja wyłączona` once and return. Log lines: `Plan: synchronizacja z <host>…`, `Plan: +<created> ~<updated> -<deleted>`. `index.ts` runs the loop concurrently with `startWorker` (same abort signal, `Promise.all`).

- [ ] **Step 1: Failing tests** with a local `node:http` server on port 0: 200 `text/calendar` → body; 500 → rejects with message containing host and not the path/query; `text/html` → rejects; 6 MB body → rejects; slow server with `timeoutMs: 100` → rejects. `planSyncDue` truth table (never run; 5 h ago; 7 h ago; requested after last run). `runPlanSyncOnce` with a `fetchImpl` stub returning the db fixture → status ok and sessions exist; with a failing stub → `lastError` set, sessions from the previous run still present, `lastError` does not contain `?x=`.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm --filter @studies/worker test`).
- [ ] **Step 5:** `.env.example` gets `# Plan zajęć (UniTime iCalendar export URL — secret, do not commit)\n# UNITIME_ICAL_URL=`; `docs/deploy.md` one paragraph.
- [ ] **Step 6: Commit** `feat(worker): periodic UniTime timetable sync`

### Task 6: Bot commands

**Files:**
- Modify: `apps/bot/src/commands/definitions.ts`, `admin.ts`, `router.ts`; Create `apps/bot/src/commands/plan.ts`
- Test: `apps/bot/test/commands.test.ts`, `router.test.ts` (extend)

**Interfaces — Consumes:** Task 1 columns, Task 4 status helpers. **Produces (admin.ts / plan.ts, all return reply text):**
- `addSubject` — when the code exists with `discordChannelId IS NULL`, set the channel (and keep its name/semester/ects; ignore the passed ones except `description` if the row has none) → `Połączono przedmiot <CODE> z kanałem.`; router then syncs forum tags as for `Dodano`.
- `editSubject` patch gains `platformUrl`.
- `addLecturer` input gains `officeHours`, `room`; new `editLecturer(db, id, patch: {name?, title?, email?, officeHours?, room?})` → `Zaktualizowano prowadzącego <label>.` / `Nie znaleziono prowadzącego o id <id>.`
- `editClass(db, { subjectCode, kind, assessment?, note?, platformUrl? })` → `Zaktualizowano <CODE> / <CLASS_NAME>.`; missing class → `Przedmiot <CODE> nie ma zajęć typu <CLASS_NAME>.` (never creates).
- Shared rules: text option value `-` clears the field (NULL); URL options must match `^https?://\S+$` else `Nieprawidłowy adres URL.` and nothing is written; email lower-cased; duplicate email → `Prowadzący z tym adresem e-mail już istnieje.`
- `planStatusText(s: PlanSyncStatus, now: Date): string` — `Ostatnia synchronizacja: <Warsaw time> (+c ~u -d)`, `Błąd: <lastError>` line when set, `Nigdy nie synchronizowano.`; `/plan sync` = `requestPlanSync` + `Zlecono synchronizację planu (wykona ją worker w ciągu minuty).\n` + status.
- Definitions: `/subject edit platform_url`; `/lecturer add office_hours room`; `/lecturer edit lecturer(autocomplete) name title email office_hours room`; `/class edit subject(autocomplete) kind(choices) assessment(choices ASSESSMENTS) note platform_url`; `/plan sync`, `/plan status`. `class` and `plan` join `ADMIN_COMMANDS`; all admin builders keep `ManageGuild` default permission.

- [ ] **Step 1: Failing tests** for each function above incl. linking a channel-less subject, clear with `-`, bad URL rejected, unknown class, duplicate email, status text for never/ok/error; router test: non-admin `/plan sync` → `Brak uprawnień.`; definitions snapshot/structure test updated (command count, option names).
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm --filter @studies/bot test`).
- [ ] **Step 5: Commit** `feat(bot): /plan, /class edit, lecturer edit and course fields`

### Task 7: Web plan library (pure helpers + queries + wiring)

**Files:**
- Create: `apps/web/lib/plan.ts` (pure), `apps/web/lib/plan-queries.ts`; Tests: `apps/web/test/plan.test.ts`, `apps/web/test/plan-queries.test.ts`
- Modify: `apps/web/lib/schema-relations.ts`, `apps/web/lib/designer-layout.ts`, `apps/web/lib/view-links.ts`, `apps/web/lib/nav-tree.ts` (`DB_SCREENS` += `/plan`), `apps/web/components/shell/db-tabs.ts` (`DbTab` += `'plan'`, label `Plan`, icon `CalendarBlank`, first position), `apps/web/lib/queries.ts` (`SubjectInfo` += `platformUrl`; `listSubjectClasses` rows += `assessment`, `assessmentNote`, `platformUrl`; `listSubjectLecturers` rows += `officeHours`, `room`), `apps/web/lib/entity-queries.ts` (`getLecturer` += `office_hours`, `room`) and their tests

**Interfaces — Produces:**
```ts
// plan.ts
type IsoWeek = { year: number; week: number }
parseIsoWeek(s: string | undefined): IsoWeek | null      // /^(\d{4})-W(\d{2})$/, week 1..weeksInYear
formatIsoWeek(w: IsoWeek): string                        // "2026-W42"
isoWeekOf(wall: Date): IsoWeek
weekStart(w: IsoWeek): Date                              // wall Monday 00:00
shiftWeek(w: IsoWeek, n: number): IsoWeek
nowWall(now?: Date): Date                                // current Europe/Warsaw wall time
defaultWeek(now: Date, range: { first: Date; last: Date } | null): IsoWeek  // now's week if inside [first,last] weeks, else week of `first` (or now if range null)
interface PlanSession { id: number; startsAt: Date; endsAt: Date; subjectId: number; subjectName: string; subjectCode: string;
  classId: number|null; classKind: ClassKind|null; className: string|null; groupId: number|null; groupName: string|null;
  lecturerId: number|null; lecturerName: string|null; room: string|null; label: string; status: 'confirmed'|'cancelled' }
DAY_START_MIN = 420; DAY_END_MIN = 1200; SLOT_MIN = 15
slotRange(s: PlanSession): { from: number; to: number }  // grid rows, clamped to the day window, to > from
layoutDay(sessions: PlanSession[]): { session: PlanSession; col: number; cols: number }[]  // overlap clusters, greedy columns
weekDays(sessions: PlanSession[], w: IsoWeek): Date[]    // Mon–Fri + Sat/Sun only if a session falls on them
type MyGroups = Record<string, number>
parseMyGroups(raw: string | null): MyGroups              // garbage → {}; drops non-numeric keys/values
filterMyGroups(s: PlanSession[], g: MyGroups): PlanSession[]  // keep if classId null || groupId null || g[classId] undefined || g[classId]===groupId
// plan-queries.ts (RO pool, v_* only; each returns the SQL it ran, like entity-queries)
listWeekSessions(pool, w: IsoWeek, f?: { subjectId?: number; lecturerId?: number }): Promise<{ sql: string; rows: PlanSession[] }>
sessionRange(pool, f?): Promise<{ first: Date; last: Date } | null>
listMyGroupOptions(pool): Promise<{ classId: number; subjectName: string; className: string; groups: { id: number; name: string }[] }[]>  // classes that have sessions, ordered by subject name, KIND_ORDER
planListPage(pool, o: GridOpts & { subjectId?: number; lecturerId?: number }): Promise<SqlPage>  // v_class_sessions ORDER BY starts_at
```
`subjectCode` comes from joining `v_subjects`. Relations: `v_class_sessions` → subject_id/v_subjects, class_id/v_classes, group_id/v_class_groups, lecturer_id/v_lecturers. Designer: add `v_class_sessions` in column 5 below `v_files` (no overlap test must still pass; adjust MIN_HEIGHT if needed). View links: `v_class_sessions` `subject_name`→subject, `class_name`→class, `group_name`→group, `lecturer_name`→lecturer (generic `*_id` rules already apply).

- [ ] **Step 1: Failing tests:** ISO weeks (2026-12-31 → 2026-W53, 2027-01-04 → 2027-W01, `parseIsoWeek('2026-W54')` null, shift across year end); `defaultWeek` inside/outside range; `layoutDay` (3 sessions where A overlaps B and C but B/C don't → cols 2, A col 0, B and C col 1; non-overlapping → cols 1); `slotRange` 08:00–09:30 → {4, 10}, 06:00–07:30 clamps to {0, 2}; `weekDays` adds Saturday only when present; `parseMyGroups('{"3":7,"x":1,"4":"a"}')` → `{"3":7}`, `parseMyGroups('nope')` → `{}`; `filterMyGroups` keeps lecture (group null), keeps unknown class, drops other group. DB tests (pattern `entity-queries.test.ts`, seed via `syncTimetable` on the db fixture or direct inserts): week query returns only that week (Mon 00:00 ≤ start < next Mon), subject/lecturer filters, `sessionRange`, `listMyGroupOptions` shape; schema-relations/designer/view-links/db-tabs tests extended.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm --filter @studies/web test`, typecheck).
- [ ] **Step 5: Commit** `feat(web): plan helpers, session queries and v_class_sessions wiring`

### Task 8: `/plan` screen (Tydzień, Lista, Moje grupy)

Invoke `design-taste-frontend` (and `minimalist-ui`) before writing UI; match the existing phpMyAdmin shell (ScreenHeader, ResultGrid, PreviewPanel styling, tokens in `globals.css`).

**Files:**
- Create: `apps/web/app/(app)/plan/page.tsx`, `apps/web/components/plan/WeekView.tsx` (client), `apps/web/components/plan/SessionPanel.tsx` (client), `apps/web/components/plan/MyGroupsForm.tsx` (client), `apps/web/components/plan/useMyGroups.ts`
- Modify: `apps/web/app/globals.css` (7 `--kind-*` colour pairs for light/dark), `apps/web/components/shell/NavPanel.tsx` / nav loader (node "Plan zajęć" under studies_db above Przedmioty), every page using `dbTabs` keeps working

**Interfaces — Consumes:** Task 7, `getPlanSyncStatus` (Task 4, via `getDb()`). Page: `requireUser()`; `?tab=week|list|groups` (default week), `?week=YYYY-Www` (invalid → default), Lista uses `parseEntityGrid` paging. Week view: server passes `PlanSession[]` (dates as ISO strings) + `days` to `WeekView`; `WeekView` applies `filterMyGroups(useMyGroups())` client-side; banner `Filtr: Moje grupy` + link `zmień` → `?tab=groups` when non-empty; grid rows 07:00–20:00 per 15 min with hour labels; block shows subject code or name, `<className> <groupName>`, room, lecturer; cancelled: line-through + `Odwołane`; blocks are `<button>`s with `data-testid="plan-block"`, open `SessionPanel` (Escape/close button closes) with date, time, room, label, status and links: subject `explorerHref` with class/group, lecturer `lecturerHref`, `Pokaż w SQL` → `sqlHref('SELECT * FROM v_class_sessions WHERE id = <id>')`. Navigation links `‹ Poprzedni`, `Dziś`, `Następny ›`; heading `Tydzień <n> · <Mon date> – <Fri/Sun date>`. Empty week → `Brak zajęć w tym tygodniu.` `MyGroupsForm`: one `<select>` per `listMyGroupOptions` row (`Wszystkie` + groups), Zapisz writes localStorage and returns to week; `Wyczyść`. Footer: `Ostatnia synchronizacja: <Warsaw datetime>` or `Plan nie był jeszcze synchronizowany`; when `lastError` is set and newer than `lastOkAt`: warn box `Synchronizacja nie powiodła się — pokazuję ostatnie dane` (error text in a `<details>`).

- [ ] **Step 1:** Implement page + components; `pnpm --filter @studies/web exec tsc --noEmit` and `pnpm lint` clean.
- [ ] **Step 2:** Smoke against the dev DB after a manual sync (Task 10 data or the fixture via a scratch script): screenshots light/dark of week, panel, groups form at 1440 px and 390 px; overlapping blocks side by side; no horizontal clipping on desktop (mobile scrolls horizontally inside the grid).
- [ ] **Step 3: Commit** `feat(web): Plan zajęć week view, list and Moje grupy`

### Task 9: Subject/lecturer Plan tabs and Courses+ display

**Files:**
- Modify: `apps/web/lib/explorer.ts` (`ExplorerTab` += `'plan'`, in `TABS`), `apps/web/app/(app)/subjects/[code]/page.tsx`, `apps/web/app/(app)/lecturers/[id]/page.tsx`, tests `explorer.test.ts`, `entity-page.test.ts` as needed

**Interfaces — Consumes:** `WeekView` (Task 8) with `listWeekSessions(pool, w, { subjectId | lecturerId })`, `sessionRange` with the same filter for the default week; week links keep `tab=plan`.

- Subject screen: tab `Plan` (icon `CalendarBlank`) after Prowadzący; header shows `UPeL / platforma ↗` (`target=_blank rel="noopener noreferrer"`) when `platformUrl` set; Prowadzący tab rows gain `Konsultacje`, `Pokój` columns; a `Zajęcia` table at the top of the Prowadzący tab lists each class: name, `Zaliczenie` = `ASSESSMENT_NAMES[a]` + ` — note`, `Platforma ↗` link.
- Lecturer page: tab `Plan`; header shows `Konsultacje: …`, `Pokój: …` when set.
- Only `http(s)` URLs are rendered as links (defence in depth; else plain text).

- [ ] **Step 1:** Unit test for the explorer tab parse (`?tab=plan`) and a helper `safeExternalUrl(s): string | null` in `lib/format.ts` (`javascript:` → null, `https://upel.agh.edu.pl/x` → same).
- [ ] **Step 2:** Implement; typecheck + lint + `pnpm --filter @studies/web test` PASS.
- [ ] **Step 3: Commit** `feat(web): Plan tabs on subject and lecturer pages; course fields`

### Task 10: e2e and live import verification

**Files:**
- Modify: `apps/web/e2e/global-setup.ts` (seed: run `syncTimetable` on `packages/db/test/fixtures/unitime.ics` *or* insert sessions for subject `FIZ` in a fixed week, plus `classes.platform_url`, lecturer `office_hours`), Create `apps/web/e2e/plan.spec.ts`

- [ ] **Step 1: Write e2e** (`/plan?week=<seeded week>`): blocks visible with room text; open a block → panel shows lecturer link; Moje grupy: choose group 2 for a class with groups 1 and 2 → group-1 block disappears, lecture still shown, banner visible; reload → filter persists; Wyczyść restores; `?tab=list` grid has `v_class_sessions` SQL; subject `?tab=plan` shows only that subject; lecturer page Plan tab; Prowadzący shows office hours; platform link present.
- [ ] **Step 2:** `pnpm --filter @studies/web e2e` → all pass (twice in a row).
- [ ] **Step 3: Commit** `test(web): e2e for Plan zajęć`
- [ ] **Step 4 (controller, not committed):** put the user's `UNITIME_ICAL_URL` into `.env`; `pnpm db:migrate`; run `runPlanSyncOnce` once against the dev DB via a scratch script; check: 9 new subjects, 23 lecturers with emails, session count = expanded total of the real file, warnings empty, second run all zeros; `grep -r "plan.agh.edu.pl/UniTime/export" $(git ls-files)` empty; open `/plan` in the dev server and look at the current week.

---

## Self-review notes

- Spec coverage: §1 → T1; §2 → T2–T4; §3 → T5 (worker), T6 (bot); §4 → T7–T8 (+ subject/lecturer Plan tabs T9); §5 → T9; testing → each task + T10; error handling → T4/T5.
- Deviation recorded: wall-time convention (Global Constraints).
- Spec says "all 433 sessions"; the stored count is the expanded occurrences (433 events, the 14 weekly ones expand), verified in T10 Step 4.
