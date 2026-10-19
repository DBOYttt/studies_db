# QA Round 1b (English Interface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every string a user reads on the website and in Discord is English; content stays Polish.

**Architecture:** Plain English strings in place (no i18n layer). Shared messages are translated once in
`packages/db`. A glossary fixes the vocabulary, and a `check:lang` script finds leftover Polish (diacritics) in UI code.
Each task translates one area and updates the tests that assert its text.

**Tech Stack:** TypeScript, Next 16 / React 19, discord.js 14, Drizzle, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-qa-round1b-english-ui-design.md`

## Global Constraints

- Vocabulary comes from `docs/glossary.md` (Task 1). A new term is added there in the task that introduces it.
- Unchanged: content (subject/file/lecturer/room names, descriptions, topic titles, seed data); class-type tags
  Wykład, Laboratorium, Ćwiczenia, Projekt, Seminarium, `Gr. N` and their parsing (`Gr3`, `Grupa 3`, `G3`); stored keys
  (`kolokwium`, `egzamin`, …), cookie names, `custom_id`s; URLs and routes; Discord channel names; `console.*` log
  text; comments; test fixture content; the "When" input syntax `DD.MM[.YYYY] [HH:MM[-HH:MM]]`.
- Dates display `en-GB`, 24-hour, Warsaw wall clock (e.g. "Tue 20 Oct 2026, 10:00"). Collation stays `'pl'`.
- English plurals (1 file / 2 files).
- Commits as DBOYttt, signed, no AI attribution; never push; if signing hangs, stop and report BLOCKED.
- Tests: `fileParallelism: false` stays; e2e via `pnpm --filter @studies/web e2e`.

## Review Focus

1. Polish content inside an English sentence must stay intact, e.g. "Laboratorium, Gr. 2 · Room 204" — tests in
   Tasks 2 and 5 assert a class/group label renders unchanged.
2. An English string that is also parsed back (e.g. the "When" hint, a select value, a CSV header used by a test)
   must still round-trip: Task 2's event-form e2e saves an event after translation.
3. Strings in `aria-label`, `title`, `alt` and `placeholder` are easy to miss: `check:lang` covers diacritics; each UI
   task greps its files for `aria-label=`/`title=`/`placeholder=` and lists any Polish ones left (must be none).
4. Discord limits: translated button labels ≤ 80 chars, select placeholders ≤ 150, modal titles ≤ 45, `custom_id`
   untouched — Task 5 asserts the limits in `ui/limits.ts` still hold for every view (existing limit tests).
5. Plurals at 0, 1, 2 and 5 ("0 files", "1 file", "2 files", "5 files") — Task 1 unit-tests the helper.

---

### Task 1: Glossary, shared messages, formatting, check script

**Files:**
- Create: `docs/glossary.md` (the spec's §2 table plus any term added in this task), `scripts/check-ui-language.mjs`,
  root `package.json` script `"check:lang": "node scripts/check-ui-language.mjs"`
- Modify: user-facing strings in `packages/db/src` (events.ts, event-series.ts, admin-actions.ts, plan.ts, search.ts,
  reminders.ts, web-uploads.ts, event-posts.ts, files.ts, constants.ts labels, unitime/sync.ts results shown to users);
  `apps/web/lib/format.ts` (dates + plural helper), `apps/web/lib/plan-view.ts` (date formats), `apps/web/lib/admin-audit.ts`
  (time format), `apps/web/app/layout.tsx` (`lang="en"`)
- Test: `packages/db/test/*` that assert those messages; `apps/web/test/format.test.ts` (create if missing)

**Interfaces:**
- Produces: `plural(n: number, one: string, many: string): string` in `apps/web/lib/format.ts` (returns e.g.
  "1 file", "2 files"), replacing the Polish plural helpers; `EVENT_KINDS[k].label` English (Test, Exam, Trip,
  Extra class, Other — match keys in constants.ts); `check-ui-language.mjs [paths…]` (default: the spec's scope), exits
  1 and prints `file:line: text` for each hit.

`check-ui-language.mjs`: regex `[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]` per line; skip lines that are comments (`//`, `*`, `/*`),
contain `console.`, `localeCompare`, `toLocale`, or match the allowlist (`ALLOW` array in the script: the class-tag
constants file, `packages/db/src/hierarchy.ts` group regex, `packages/db/src/cli/**`, test files). Scope: `apps/web/app`,
`apps/web/components`, `apps/web/lib`, `apps/bot/src`, `packages/db/src`.

- [ ] **Step 1:** write `format.test.ts`: `plural(0,'file','files')` → "0 files", 1 → "1 file", 2 → "2 files",
  5 → "5 files"; the event date formatter gives "Tue 20 Oct 2026, 10:00" for wall 2026-10-20 10:00. Change the db
  tests asserting translated messages to the English text (e.g. NOT_FOUND → "Event not found.").
- [ ] **Step 2:** run `pnpm --filter @studies/db test` and `pnpm --filter @studies/web exec vitest run test/format.test.ts` — FAIL.
- [ ] **Step 3:** write the glossary; translate; implement `plural` and the formatters; write the script.
- [ ] **Step 4:** `pnpm --filter @studies/db test`, `pnpm --filter @studies/web test` and `pnpm --filter @studies/bot test`
  (db strings reach both) — fix every test whose expected text changed; `node scripts/check-ui-language.mjs packages/db/src`
  → no hits.
- [ ] **Step 5:** commit `feat(i18n): glossary, English shared messages and formatting`.

### Task 2: Website simple mode, events, plan, login

**Files:** `apps/web/app/(simple)/**`, `apps/web/components/simple/**`, `apps/web/components/events/**`,
`apps/web/components/plan/**`, `apps/web/app/login-info/**`, `apps/web/app/auth/**`, `apps/web/app/mode/**`, and the lib
files they use: `simple.ts`, `event-view.ts`, `event-actions.ts`, `event-page.ts`, `event-upload.ts`, `plan.ts`,
`plan-events.ts`, `plan-queries.ts`, `upcoming-events.ts`, `nav-tree.ts`. Tests: the matching `apps/web/test/*` and
`apps/web/e2e/{simple,events,plan,my-groups,auth,smoke}.spec.ts`.

**Interfaces:** Consumes Task 1's glossary, `plural`, formatters, English db messages.

- [ ] **Step 1:** update the tests in scope to the English texts (glossary terms; e.g. the "Plan zajęć" link becomes
  "Timetable"). Add an e2e assertion that a class/group label renders unchanged, e.g. "Laboratorium" and "Gr. 2" on the
  timetable, and keep the event-form e2e saving an event.
- [ ] **Step 2:** run the vitest files and the e2e specs in scope — FAIL.
- [ ] **Step 3:** translate every user-visible string in the files above (incl. `aria-label`, `title`, `alt`,
  `placeholder`, breadcrumbs, metadata titles).
- [ ] **Step 4:** run `pnpm --filter @studies/web test`, the e2e specs in scope, typecheck, and
  `node scripts/check-ui-language.mjs` on the task's files → no hits; grep the task's files for
  `aria-label=|title=|placeholder=|alt=` and list any Polish value left (must be none) in the report.
- [ ] **Step 5:** commit `feat(i18n): English simple mode, events and timetable`.

### Task 3: Website advanced mode (non-admin)

**Files:** `apps/web/app/(app)/**` except `admin/**`, `apps/web/components/{shell,explorer}/**`, the remaining top-level
components (`DesignerDiagram`, `EntityFilesGrid`, `FilePreview`, `PdfViewer`, `ResultGrid`, `SqlConsole`, `SqlText`,
`TagBadge`, `ViewSearchForm`, `Highlight`), lib: `sql-console.ts`, `sql-messages.ts`, `db-errors.ts`, `result-grid.ts`,
`graph-layout.ts`, `schema-relations.ts`, `example-queries.ts`, `entity-*`. Tests: matching vitest files and
`e2e/{entities,explorer,schema,smoke}.spec.ts`.

Steps 1–5 as in Task 2 (commit `feat(i18n): English advanced mode`). Example queries' SQL stays as is; only their titles
and descriptions are translated.

### Task 4: Website admin pages

**Files:** `apps/web/app/(app)/admin/**`, `apps/web/components/admin/**`, lib `admin-*.ts`. Tests: `apps/web/test/admin-*`,
`e2e/admin.spec.ts`.

Steps 1–5 as in Task 2 (commit `feat(i18n): English admin pages`). Audit action codes (`event.add`, `sql.rejected`, …)
stay; their displayed labels are translated.

### Task 5: Bot panels, modals, commands, setup

**Files:** `apps/bot/src/ui/**` (except `plan-image.ts`), `apps/bot/src/commands/**`, `apps/bot/src/setup/**`,
`apps/bot/src/{admin-flag,ops,sync,catchup,ingest}.ts` (user-facing replies only). Tests: matching `apps/bot/test/*`.

- [ ] **Step 1:** update the tests in scope to English; keep a test asserting a class/group label renders unchanged
  in a panel view.
- [ ] **Step 2:** run them — FAIL.
- [ ] **Step 3:** translate (command/option descriptions in `commands/definitions.ts` too). Don't touch `custom_id`s.
- [ ] **Step 4:** `pnpm --filter @studies/bot test` (including the existing `limits` tests), typecheck,
  `check-ui-language.mjs apps/bot/src/ui apps/bot/src/commands apps/bot/src/setup` → no hits.
- [ ] **Step 5:** commit `feat(i18n): English Discord panels and commands`. In the report, say that
  `pnpm --filter @studies/bot register` must be run once after deploy.

### Task 6: Bot event posts, reminders, digest, uploads, plan image

**Files:** `apps/bot/src/events/**`, `apps/bot/src/reminders.ts`, `apps/bot/src/ui/plan-image.ts`, any other remaining
`apps/bot/src` file with user-facing text. Tests: matching `apps/bot/test/*`.

Steps 1–5 as in Task 5 (commit `feat(i18n): English event posts, reminders and plan image`). The upload message is
"File from <name> (via the website)". After this task `check-ui-language.mjs apps/bot/src` → no hits.

### Task 7: Docs, full check, QA

- [ ] **Step 1:** update `CLAUDE.md`: the "UI strings, log messages and domain terms are Polish …" sentence becomes
  "UI strings are English (vocabulary in docs/glossary.md); content and class-type tags stay Polish; log messages may be
  Polish." Fix other CLAUDE.md mentions of Polish UI labels (e.g. "Plik od <nazwa> (przez stronę)" → the English text).
- [ ] **Step 2:** `pnpm check:lang` → no hits; `pnpm test`, the four typechecks, `pnpm lint`, `pnpm --filter @studies/web e2e`
  → pass (worker tests needing LibreOffice/pdftotext excepted).
- [ ] **Step 3:** sandbox QA: `pnpm qa:sandbox`, `pnpm qa:serve` (background), dispatch `qa-curator` and `qa-novice`
  (run `2026-10-xx-r1b`) asking them to report any leftover Polish UI text and unclear English; write
  `docs/qa/<run>/SUMMARY.md`; stop the server.
- [ ] **Step 4:** commit `docs: English UI; round 1b QA`.

## Notes
