# Semesters 1–7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support semesters 1–7: per-semester Discord categories, per-semester UniTime feeds configured in the admin panel, and a per-browser semester switcher on the website.

**Architecture:** `SEMESTERS` widens to 1–7 everywhere. A new private table `unitime_feeds` holds one class feed (+ optional exam feed) per semester; `class_sessions.feed_semester` scopes each feed's deletions. The web reads `?sem=` or the `studiesdb.semester` cookie and passes an optional `semester` into the existing view queries.

**Tech Stack:** Drizzle/MariaDB, discord.js 14, Next 16 App Router, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-semesters-design.md`

## Global Constraints

- Never `drizzle-kit push`; generate migrations with `pnpm --filter @studies/db exec drizzle-kit generate --name <name>` and validate with `node .claude/skills/create-migration/check-migrations.mjs`.
- Feed URLs are secrets: never in logs, audit payloads, errors, HTML (only `host` + `/…` + last 4 chars), never in `CONTENT_TABLES`, `PUBLIC_VIEWS` or any `studies_rw` grant.
- UI strings English (`pnpm check:lang`); Discord category names stay Polish `Semestr N`; log messages may be Polish.
- Client components import only from `@studies/db/constants` and `@studies/db/fields`.
- Every page/route handler calls `requireUser()`; every admin page/action calls `requireAdmin()`; redirect targets go through `safeNext`.
- Client-handled forms carry `method="post"`.
- DB tests run sequentially; never run two DB suites at once.
- Commit unsigned (`git -c commit.gpgsign=false commit`), author DBOYttt, no AI attribution or trailers.
- UI tasks invoke the taste skills (`minimalist-ui`, `redesign-existing-projects`) before writing markup and must match the existing shells' tokens.

## Review Focus

1. A feed URL reaching a log line, an audit row, an error string or rendered HTML (e.g. via a fetch error that echoes the URL, or the form re-rendering the submitted value).
2. A tampered `studiesdb.semester` cookie or `?sem=` (`0`, `8`, `1;drop`, `all`, repeated params) — must silently mean "all" / ignored, never a 500 or SQL text.
3. The same UniTime uid+start present in two semester feeds — must never be deleted while one feed still contains it.
4. Subject-less events while a semester is chosen — must still appear in the events index, upcoming card and timetable.
5. The env-feed leftovers (`feed_semester IS NULL`) — removed only after every configured class feed of that run succeeded; a single failure keeps them.

---

### Task 1: DB foundation — semester bounds, feed table, feed module

**Files:**
- Modify: `packages/db/src/admin-fields.ts`, `packages/db/src/schema.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/unitime/feeds.ts`, migration `packages/db/migrations/0027_semester_feeds.sql` (+ meta, generated)
- Test: `packages/db/test/feeds.test.ts`, extend `packages/db/test/readwrite-user.test.ts` (or the file that tests `studies_rw` grants)

**Interfaces:**
- Produces: `SEMESTERS = [1,2,3,4,5,6,7] as const`, `type Semester = (typeof SEMESTERS)[number]`, `isSemester(n: unknown): n is Semester` (all in `admin-fields.ts`, import-free).
- Produces (schema): `unitimeFeeds` table (`semester` tinyint PK, `classUrl` varchar 500 notNull, `examUrl` varchar 500 nullable, `updatedAt` datetime default now, `updatedBy` int → users.id set null; CHECK `semester BETWEEN 1 AND 7`); `classSessions.feedSemester: tinyint('feed_semester')` nullable.
- Produces (`unitime/feeds.ts`, re-exported from `@studies/db`):
  - `feedAllowedHosts(env?: NodeJS.ProcessEnv): string[]` — same list as `importAllowedHosts` (call it).
  - `validateFeedUrl(raw: string, allowedHosts: readonly string[]): { ok: true; url: string; host: string } | { ok: false; error: string }`.
  - `maskFeedUrl(url: string): string` → `"<host>/…<last 4 chars>"`.
  - `interface StoredFeed { semester: Semester; classUrl: string; examUrl: string | null; updatedAt: Date; updatedBy: number | null }`
  - `listFeeds(db: DbExecutor): Promise<StoredFeed[]>` ordered by semester.
  - `setFeed(db, input: { semester: Semester; classUrl?: string; examUrl?: string | null; userId: number }): Promise<{ ok: true; classHost: string; examHost: string | null } | { ok: false; field: 'class_url' | 'exam_url'; error: string }>` — `classUrl` undefined keeps the stored one (required when none stored); `examUrl` undefined keeps, `null` removes. Validates with `feedAllowedHosts()`.
  - `clearFeed(db, semester: Semester): Promise<boolean>` (true if a row was removed).

- [ ] **Step 1: Failing tests** in `feeds.test.ts`:
  - `SEMESTERS` equals `[1..7]`; `isSemester(7)` true, `isSemester(8)`/`isSemester('3')`/`isSemester(0)` false.
  - `validateFeedUrl` accepts `https://plan.agh.edu.pl/UniTime/export?x=abc`; refuses `http://…`, `https://user:p@plan.agh.edu.pl/x`, `https://evil.example/x`, a 501-char URL; no refusal message contains the raw input.
  - `maskFeedUrl('https://plan.agh.edu.pl/UniTime/export?x=abcdk3x9')` === `'plan.agh.edu.pl/…k3x9'`.
  - `setFeed` without stored row and without `classUrl` → `{ ok:false, field:'class_url' }`; with it → row stored; second call with only `examUrl` keeps class URL; `examUrl: null` removes exam URL; `listFeeds` ordered; `clearFeed` true then false.
  - Grants: after creating `studies_rw`, `SHOW GRANTS` mentions no `unitime_feeds`; `CONTENT_TABLES` does not include `'unitime_feeds'`.
- [ ] **Step 2:** `pnpm --filter @studies/db exec vitest run test/feeds.test.ts` → FAIL.
- [ ] **Step 3:** Implement: widen `SEMESTERS`, add `Semester`/`isSemester`; schema changes; generate migration `semester_feeds` (rename to `0027_semester_feeds.sql` only if generate names it otherwise — keep journal consistent); `feeds.ts`; exports. Replace `1 | 2` literals found by `grep -rn "1 | 2" packages apps --include=*.ts` that mean semester.
- [ ] **Step 4:** Run the test file, then `node .claude/skills/create-migration/check-migrations.mjs`, then `pnpm --filter @studies/db test` and `pnpm --filter @studies/db typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(db): semesters 1-7 and per-semester UniTime feed storage`.

### Task 2: Sync scoping and per-feed status

**Files:**
- Modify: `packages/db/src/unitime/sync.ts`, `packages/db/src/unitime/status.ts`
- Test: `packages/db/test/unitime-sync.test.ts` (existing sync test file; add a `describe('feed semesters')`), status tests where `planStatusText` is tested.

**Interfaces:**
- Consumes: `classSessions.feedSemester`, `Semester` (Task 1).
- Produces:
  - `SyncOptions.feedSemester?: Semester` (absent = env feed, rows stored with NULL).
  - `removeUnscopedSessions(db: Db): Promise<number>` — deletes `class_sessions` with `feed_semester IS NULL`, returns count.
  - `interface FeedStats { semester: number; ok: boolean; created: number; updated: number; deleted: number }`; `SyncStats.feeds?: FeedStats[]`.
  - `planStatusText` appends `Semester N: +c ~u -d` or `Semester N: failed` per `stats.feeds` entry (after the "Last sync" line).

- [ ] **Step 1: Failing tests:**
  - `feed 3 does not delete feed 5 rows`: sync ics A with `feedSemester: 3`, ics B with `feedSemester: 5`, re-sync A without one event → only that A row deleted, all B rows kept.
  - `a row in two feeds is taken over, not deleted`: same uid+start in both; after syncing 3 then 5 the row has `feed_semester = 5`; re-syncing 3 counts it updated (back to 3), never deleted; total rows unchanged.
  - `new subject gets the feed semester`: unknown subject in ics synced with `feedSemester: 6` → `subjects.semester = 6`; an existing subject (semester 1) stays 1.
  - `env feed keeps semesterFor`: no `feedSemester` → rows `feed_semester` NULL, subject semester from `semesterFor`.
  - `exam feed scoped too`: `{ allExams:true, source:'exams', feedSemester:3 }` deletes only exam rows of 3.
  - `removeUnscopedSessions` deletes only NULL rows.
  - `planStatusText` with `feeds: [{semester:3,ok:true,created:1,updated:0,deleted:2},{semester:5,ok:false,...}]` contains `Semester 3: +1 ~0 -2` and `Semester 5: failed`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: pass `feedSemester` into `Resolver` (subject creation semester), into each `SessionRow` (`feedSemester ?? null`), into `sameSession`, and into the delete rule (`row.source === source && (row.feedSemester ?? null) === (opts.feedSemester ?? null)`); select `feedSemester` in `existing`.
- [ ] **Step 4:** `pnpm --filter @studies/db test` and typecheck → PASS.
- [ ] **Step 5:** Commit `feat(db): scope timetable sync by feed semester`.

### Task 3: Worker runs every semester feed

**Files:**
- Modify: `apps/worker/src/plan-sync.ts`, `apps/worker/src/index.ts`, `compose.yaml` (worker `environment:` gets `UNITIME_IMPORT_HOSTS: ${UNITIME_IMPORT_HOSTS:-}`)
- Test: `apps/worker/test/plan-sync.test.ts`

**Interfaces:**
- Consumes: `listFeeds`, `validateFeedUrl`, `feedAllowedHosts`, `removeUnscopedSessions`, `SyncOptions.feedSemester`, `FeedStats` (Tasks 1–2).
- Produces: `runPlanSyncOnce(deps: { db: Db; url?: string; examUrl?: string; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: () => Date }): Promise<void>`; `startPlanSyncLoop` no longer exits when `url` is unset — it polls, and a run with no stored feeds and no env URL records nothing and logs `Plan: brak źródeł planu — pomijam` at most once per process.

- [ ] **Step 1: Failing tests** (fake `fetchImpl` keyed by URL, test DB):
  - two stored feeds (3, 5) → both fetched in semester order, sessions carry their `feed_semester`, `stats.feeds` has two `ok:true` entries.
  - feed 3 fetch throws an error whose message contains the full URL → feed 5 still synced; `lastError` contains `Semester 3:` and the host but not the URL; captured `console.error` output never contains the URL.
  - stored feed on a host outside `UNITIME_IMPORT_HOSTS` (pass `env`) → not fetched, error `Semester N: host not allowed`.
  - leftovers: seed a `feed_semester NULL` session; all feeds ok → removed; one class feed fails → kept.
  - no stored feeds + env url → old behaviour (rows NULL); no feeds and no url → nothing fetched, status untouched.
  - exam feed of semester 3 runs right after its class feed with `source:'exams'`.
- [ ] **Step 2:** `pnpm --filter @studies/worker exec vitest run test/plan-sync.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Secrets for `scrub` = every stored URL + env URLs. Totals (`created/updated/deleted/unchanged/warnings`) sum the successful class feeds plus their exam feeds as today.
- [ ] **Step 4:** worker tests + typecheck → PASS.
- [ ] **Step 5:** Commit `feat(worker): sync one UniTime feed per semester`.

### Task 4: Admin "Timetable feeds" card

**Files:**
- Create: `apps/web/lib/admin-feeds.ts` (Server Actions + form parsing), `apps/web/components/admin/FeedsCard.tsx`
- Modify: `apps/web/app/(app)/admin/sync/page.tsx`, `apps/web/lib/admin-audit-targets.ts` (target `semester:<n>` renders "Semester n"), `apps/web/lib/admin-sync.ts` if it loads the page data
- Test: `apps/web/test/admin-feeds.test.ts`

**Interfaces:**
- Consumes: `listFeeds`, `setFeed`, `clearFeed`, `maskFeedUrl`, `requestPlanSync`, `isSemester` (Task 1), existing `audit()`/`requireAdmin()` helpers used by `lib/admin-actions.ts`.
- Produces: `saveFeedAction(prev: ActionState, fd: FormData): Promise<ActionState>` (fields `semester`, `class_url`, `exam_url`, `remove_exam`), `clearFeedAction(prev, fd)` (field `semester`), `loadFeedRows(db): Promise<{ semester: number; classMasked: string | null; examMasked: string | null; updatedAt: Date | null }[]>` (always 7 rows).

- [ ] **Step 1: Failing tests:** non-admin → 404 path (as other admin action tests do); `semester=8` refused; bad URL → `{ field: 'class_url' }` and the returned state/message never contains the submitted URL; success writes `admin_audit` `plan.feed_set`, target `semester:3`, payload `{ classHost, examHost }` and `source:'web'` with no `http` substring anywhere in the row; success calls `requestPlanSync` (`plan_sync.requested_at` set); `clearFeedAction` audits `plan.feed_clear`; `loadFeedRows` returns 7 rows with masked values only.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Invoke `minimalist-ui` before the card markup; reuse the Sync page's existing card/table classes. Inputs `type="url"`, `autoComplete="off"`, never `defaultValue` from storage; form `method="post"`; Clear uses the existing confirm pattern of the Sync page's cancel button. Copy: card title "Timetable feeds", hint "One UniTime iCal link per semester. Links are secret: only the host is shown.", row "Not set".
- [ ] **Step 4:** web tests (incl. `test/forms-method.test.ts`) + typecheck + `pnpm check:lang` → PASS.
- [ ] **Step 5:** Commit `feat(web): admin timetable feeds per semester`.

### Task 5: Semester selection and filtered queries

**Files:**
- Create: `apps/web/lib/semester.ts`, `apps/web/app/semester/route.ts`
- Modify: `packages/db/src/plan.ts` (`PlanFilter.semester`, `filterWhere`, `listUpcomingEvents` option, `listMyGroupOptions` option), `packages/db/src/search.ts` (optional semester filter), `apps/web/lib/mode.ts` (`modeTarget` keeps `sem`), `apps/web/lib/simple-queries.ts`, `apps/web/lib/subjects-grid.ts`, `apps/web/lib/events-index.ts`, `apps/web/lib/upcoming-events.ts`, `apps/web/lib/plan-week-data.ts`, nav-tree data loader (wherever `NavSubject[]` is queried), plan list loader
- Test: `apps/web/test/semester.test.ts`, extend `packages/db/test/plan*.test.ts` and `search.test.ts`, extend web query tests

**Interfaces:**
- Consumes: `Semester`, `isSemester` (Task 1).
- Produces (`lib/semester.ts`): `SEMESTER_COOKIE = 'studiesdb.semester'`; `parseSemesterValue(v: string | string[] | undefined): Semester | null` (first value only, exact `/^[1-7]$/`); `semesterFromRequest(sp: Record<string, string | string[] | undefined>, cookieValue: string | undefined): Semester | null` (`?sem=all` → null even with a cookie; a bad `?sem` falls back to the cookie); `currentSemester(sp): Promise<Semester | null>` (reads `cookies()`); `semesterCookieOptions()` (path `/`, 1 year, `sameSite:'lax'`, `secure` in production, not httpOnly); `withoutSem(path: string): string`.
- Produces (route): `GET /semester?to=&next=` → `requireUser()`; `to` 1–7 sets cookie, `all` deletes it, anything else leaves it; redirect 303 to `withoutSem(safeNext(next) ?? '/s')`.
- Produces (queries): each list function takes a trailing optional `semester?: Semester | null`; `PlanFilter.semester?: number` applied as `s.semester = ?` in `weekSessionsQuery` and the list query; events: `(e.subject_id IS NULL OR s.semester = ?)`.

- [ ] **Step 1: Failing tests:**
  - `parseSemesterValue`: `'3'`→3; `'0'`,`'8'`,`'1;drop'`,`' 3'`,`'03'`,`undefined`→null; `['5','2']`→5.
  - `semesterFromRequest({sem:'all'}, '4')` → null; `({sem:'9'}, '4')` → 4; `({}, '4')` → 4; `({}, 'x')` → null.
  - route: `to=3&next=/s/plan?sem=5&week=2026-W44` → cookie `3`, Location `/s/plan?week=2026-W44`; `next=//evil.com` → `/s`; `to=all` deletes the cookie; unauthenticated → login redirect.
  - `modeTarget('advanced', '/s/plan?sem=3')` keeps `sem=3`.
  - db: `weekSessionsQuery(w, { semester: 3 })` params include 3 and SQL contains `s.semester = ?`; rows of semester 5 excluded (DB test); `listUpcomingEvents` with semester 3 returns semester-3 and subject-less events, not semester-5 ones; search with semester excludes other semesters' hits.
  - web: `listSubjectCards(db, 3)` only semester 3; `querySubjectsGrid(pool, 3)` same; nav subjects same.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Read `apps/web/node_modules/next/dist/docs/` for route handlers and `cookies()` first. Values are always bound parameters, never interpolated.
- [ ] **Step 4:** db + web tests, typechecks → PASS.
- [ ] **Step 5:** Commit `feat(web): semester filter for lists, timetable, events and search`.

### Task 6: Semester switcher UI and page wiring

**Files:**
- Create: `apps/web/components/SemesterSwitcher.tsx`, `apps/web/e2e/semesters.spec.ts`
- Modify: `apps/web/components/simple/SimpleShell.tsx` (top bar), the advanced header in `apps/web/components/shell/`, the pages listed in spec §4 (simple Start, `/s/subjects`, `/s/plan`, `/s/wydarzenia`, `/s/search`, advanced home, `/subjects`, `/plan`, `/wydarzenia`, `/search`, My groups tab loader), `apps/web/e2e/global-setup.ts` (fixtures in semesters 1 and 3)
- Test: `apps/web/test/semester-switcher.test.ts` (pure helper), e2e spec

**Interfaces:**
- Consumes: `currentSemester`, `withoutSem`, query `semester` args (Task 5).
- Produces: `semesterOptions(present: number[], current: Semester | null, path: string): { label: string; href: string; current: boolean }[]` in `lib/semester.ts` — `[]` when fewer than 2 distinct semesters; else `All` first then present semesters ascending; hrefs `/semester?to=<n|all>&next=<encoded path>`; `listPresentSemesters(pool): Promise<number[]>` (`SELECT DISTINCT semester FROM v_subjects ORDER BY semester`).
- Empty-state line when a semester is chosen and a list is empty: "Showing semester N only." + link "Show all semesters" (→ `to=all`).

- [ ] **Step 1: Failing tests:** `semesterOptions([1], null, '/s')` → `[]`; `([3,1], 3, '/s/plan?week=x')` → labels `All, 1, 3`, `3` current, hrefs encode the path; e2e: log in as the e2e student, Start shows both semester subjects; choose `3` → semester-1 subject card gone; open timetable → still filtered (cookie); choose `All` → both back; on a 375 px viewport the switcher is a `<select>` that navigates on change (progressive enhancement: a submit button inside `<noscript>`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Invoke `minimalist-ui` and `redesign-existing-projects`, then build: segmented links on `sm:` and up, a labelled `<select>` (`aria-label="Semester"`) below; `aria-current="page"` on the current option; `max-sm:min-h-11` tap targets; tokens from the shell only. Wire every page from spec §4: read `currentSemester(sp)` once per page and pass it to its loaders; add the empty-state line.
- [ ] **Step 4:** web tests, typecheck, lint, `check:lang`, `pnpm --filter @studies/web e2e e2e/semesters.spec.ts` and the full e2e → PASS.
- [ ] **Step 5:** Commit `feat(web): semester switcher in both modes`.

### Task 7: Bot and seed

**Files:**
- Modify: `apps/bot/src/commands/definitions.ts` (choices follow `SEMESTERS`; nothing to change if it already maps — verify), `apps/bot/src/ui/admin.ts` (`parseSemester` returns `Semester | null`, `SEMESTER_TEXT = 'Semester must be a whole number from 1 to 7.'`), `apps/bot/src/setup/plan.ts` (numeric category order; >50 forums warning), the subject option label builders in `apps/bot/src/ui/views/student.ts` and `events.ts`, `packages/db/src/seed-core.ts` (subjects in semesters 3, 5, 7 with a class, group and sessions)
- Test: `apps/bot/test/setup-plan.test.ts`, `apps/bot/test/ui-admin.test.ts`, views tests, `packages/db/test/seed.test.ts` (if present)

**Interfaces:**
- Consumes: `SEMESTERS`, `Semester`, `isSemester` (Task 1).
- Produces: `subjectOptionLabel(s: { code: string; name: string; semester: number }, total: number): string` in `apps/bot/src/ui/views/` shared helper — `S<n> · <code> <name>` when `total > 25`, else `<code> <name>`, clipped as today.

- [ ] **Step 1: Failing tests:** slash `semester` choices are 1–7; modal parser accepts `7`, refuses `8`/`0`/`2.5` with the new text; planner with subjects in semesters 7, 2, 10-free set orders categories `Semestr 1…7` numerically (include a case where string order would differ, e.g. a stored semester 10 written through the console sorts after 7); 51 subjects in one semester → 50 forum creates + one warning line `Semestr N has more than 50 subjects; …` in the plan report; label prefix appears only over 25 subjects; seed has subjects in ≥ 4 semesters.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. My groups / event pickers need `semester` in their subject rows (add to `modalSubjects` and the My groups loader select).
- [ ] **Step 4:** bot + db tests, typechecks → PASS. Note in the commit body that `pnpm --filter @studies/bot register` must be re-run.
- [ ] **Step 5:** Commit `feat(bot): semesters 1-7 in setup, admin input and pickers`.

### Task 8: Docs

**Files:** `CLAUDE.md`, `docs/deploy.md` (section "Upgrading to semesters (0027)": migration adds a column and a table, no backfill; give the worker `UNITIME_IMPORT_HOSTS`; move env feeds into the admin panel per semester; re-run bot `register`), `.env.example` (`UNITIME_ICAL_URL` now the fallback when no semester feeds are stored), `docs/glossary.md` (Semester, Timetable feed).

- [ ] **Step 1:** Write the docs: CLAUDE.md worker bullet ("per-semester feeds from `unitime_feeds`, env feed as fallback"), Timetable section (`feed_semester` scoping, leftovers rule), Admin panel bullet (Timetable feeds card, `plan.feed_set`/`plan.feed_clear`, target `semester:<n>`, URLs secret), UI modes bullet (`studiesdb.semester`, `?sem`, `/semester`, what is filtered).
- [ ] **Step 2:** `pnpm lint` and `pnpm check:lang` → PASS.
- [ ] **Step 3:** Commit `docs: semesters 1-7`.
