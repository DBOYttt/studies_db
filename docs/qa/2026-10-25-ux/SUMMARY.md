# QA run 2026-10-25-ux — UX review (timetable assessments, simple + advanced, desktop + mobile)

Sandbox: http://localhost:3200, DB `studies_qa_test`, branch `chore/security-audits` at 90c6585 (Next 16.4.3, dev mode).
Screenshots: `.qa/screens/2026-10-25-ux/`.

The new Test / Entry quiz footer bars were the main topic of the run. Four of the five personas hit the same defect:
on a short block with two bars, or in a narrow column, the bars cover the class text or spill out of the block. No
persona found anything critical or high. The rest is mostly navigation defaults (the timetable opens on the past week
and shows all groups), missing success feedback and announcements, and mixed vocabulary.

Environment note: the shared sandbox `next dev` disposed and recompiled on-demand entries under load, which caused
full page reloads every 15–30 s (closed panels, lost focus, lost select values, slow navigations). Findings caused only
by that are marked **Env**. The personas did not file most of these effects.

## Personas

Counts are as filed in each report, before dedup.

| Persona | critical | high | medium | low | idea | Report |
|---|---|---|---|---|---|---|
| qa-curator (Ula, admin) | 0 | 0 | 7 | 10 | 9 (U1–U9) | [qa-curator.md](qa-curator.md) |
| qa-novice (Pan Zenon) | 0 | 0 | 5 | 2 | 1 | [qa-novice.md](qa-novice.md) |
| qa-mobile (Marta, 375×812) | 0 | 0 | 2 | 13 | 2 | [qa-mobile.md](qa-mobile.md) |
| qa-a11y (Kuba, keyboard / SR) | 0 | 0 | 6 | 4 | 2 | [qa-a11y.md](qa-a11y.md) |
| qa-student (Ola) | 0 | 0 | 5 | 5 | 1 | [qa-student.md](qa-student.md) |
| security runtime (UX items only: F5, F6) | 0 | 0 | 0 | 0 | 2 | [security-runtime.md](../../audits/2026-10-25/security-runtime.md) |

**After dedup: 52 findings. critical 0, high 0, medium 20, low 26, idea 6.**
Verification against the code (read-only): **Yes 39, Partly 7, No 3, Env 1, By design 2.**

## Findings (deduplicated, by severity)

"Verified" values: **Yes**, the code shows the cause (file:line). **Partly**, part of the finding holds, or the cause
is only partly in the code. **No**, the code contradicts the finding or the cause could not be found. **Env**, an
environment artefact. **By design**, an agreed decision. Paths are relative to `apps/web/` unless they start with
`packages/`.

### Medium

| ID | Finding | Hit by | Verified |
|---|---|---|---|
| D1 | **Two footer bars crush a short class block.** On a 90-min block (82 px) with Entry quiz + Test, the subject, class and room lines are drawn under the bars, and the dashed quiz rule sits on the lecturer line. | curator [F1](qa-curator.md), [F3](qa-curator.md); a11y [F6](qa-a11y.md); mobile [F2](qa-mobile.md); student [F5](qa-student.md) | **Yes.** `lib/plan-view.ts:144-145`: `badgeBarsFit` accepts 82 px for 2 bars (34 + 48), which leaves 27 px for 4 text lines. The text button clips at its padding box (`WeekView.tsx:568-576`, `overflow-hidden` + `paddingBottom`), so the overflowing text renders in the padding area under the absolutely placed bars (`WeekView.tsx:452`). |
| D2 | **Bars overflow narrow (overlapping) columns.** The "ENTRY QUIZ" label and `›` caret stick out of a ~57–70 px block, the TEST bar is cut, the bars intercept taps on the block, and on phones the Test title is truncated to "Kolokwi…" with the full title only in `title`. | curator [F2](qa-curator.md); novice [F4](qa-novice.md); mobile [F2](qa-mobile.md), [F4](qa-mobile.md), [F15](qa-mobile.md); student [F5](qa-student.md); a11y [F6](qa-a11y.md) | **Yes.** `WeekView.tsx:384-387`: the bars are `whitespace-nowrap` with no `overflow-hidden`. The label and caret are `shrink-0` (`:393`, `:401`). `badgeBarsFit` checks height only, never width (`plan-view.ts:144`). The bar stack is `z-[1]` over the block button (`WeekView.tsx:452`). |
| D3 | **The current week makes the whole page scroll sideways at 375 px** (document 714 px wide; the other weeks are fine). | mobile [F1](qa-mobile.md) | **Yes.** The sr-only "(today)" is `position:absolute` (`WeekView.tsx:237`). None of its ancestors is positioned (the header cell at `:225`, the scroller at `:212`), so it is placed against the initial containing block and escapes the `overflow-x-auto` clip. The mobile persona's guess is right. |
| D4 | **The session panel squeezes the grid** at 1440. Sunday/Friday and the Konsultacje event are cut off, which makes D1/D2 worse. | curator [F4](qa-curator.md); student [F11](qa-student.md) | **Yes.** `WeekView.tsx:210` makes the grid and the 340 px panel (`:365`) flex siblings. The grid keeps `minWidth: 48 + n×128` (`:216-217`), so it scrolls inside its box with no visible cue. |
| D5 | **"Hidden classes … fill in My groups" and "change" on `/s/plan` open the advanced UI.** | student [F2](qa-student.md) | **Yes.** `WeekView.tsx:189` and `:196` hard-code `/plan?tab=groups` and ignore the `simple` prop. |
| D6 | **My groups copy contradicts the filter.** It says classes without a picked group "stay visible", but they are hidden, and the bar then says "fill in My groups" to someone who already did. | student [F3](qa-student.md) | **Yes.** The copy is at `components/plan/MyGroupsForm.tsx:115-119`. `packages/db/src/plan.ts:262-265` only keeps sessions without a class or group. A grouped session of an unpicked class fails `mineByClass[cls] === groupId`. The label is at `WeekView.tsx:199`. |
| D7 | **"Not this week" has no undo where you press it.** The quiz line just disappears from the panel and the bar. Undo exists only at the bottom of the subject page. | student [F4](qa-student.md); a11y [F4](qa-a11y.md) (silent) | **Yes.** `SessionPanel.tsx:249-251` and `EntryQuizBadge.tsx:72-76` skip, then park focus with no undo or status. Undo is only in `EntryQuizSection.tsx` (Skipped dates). |
| D8 | **"What's next" is not where a student looks.** On a Sunday the timetable opens on the past week, with today an empty column. Start shows subjects first, then events, and no classes. | novice [F1](qa-novice.md); student [F1](qa-student.md); curator U1, U2 | **Yes.** `lib/plan.ts:43-55`: `defaultWeek` always returns the current week. `app/(simple)/s/page.tsx:59-60` renders `SubjectCards` before `UpcomingEvents`, and the page has no class data. |
| D9 | **All groups are shown until My groups is set.** The only hint is grey intro text. | novice [F2](qa-novice.md); curator U2.1 | **Yes.** The filter bar only renders when the filter is on (`WeekView.tsx:184`). Otherwise the only hint is `app/(simple)/s/plan/page.tsx:61-62`. |
| D10 | **TEST / ENTRY QUIZ bars are unexplained.** The legend doesn't mention them, and "Kolokwium 1" (event block) next to "TEST Kolokwium 1" (bar) reads like two things. | novice [F3](qa-novice.md) | **Yes.** The legend `WeekView.tsx:327-361` lists class kinds, Exam and Events, but not Test or Entry quiz. |
| D11 | **"+ Test" opens a generic "Add event" form with an empty Title.** | novice [F5](qa-novice.md); curator [F10](qa-curator.md), U4.1 | **Yes.** The visible text is "Test" under `aria-label="Add test"` (`SessionPanel.tsx:176-184`). The heading and crumb are always "Add event" (`app/(simple)/s/wydarzenia/nowe/page.tsx:35,41`). `title: ''` (`lib/event-form-page.ts:34`), and the input has no placeholder (`EventForm.tsx:226-232`). |
| D12 | **Polish and English words for the same thing are used inconsistently.** The "Tests from the last 30 days" report says "Topics tagged Kolokwium". Start/sidebar say "files" while reports and event pages say "Materials" and "Topics". The audit log and view tree show raw `class_mark` for "Entry quiz". The advanced grid has a Polish sr-only header "Akcje". | curator [F6](qa-curator.md); novice [F3](qa-novice.md); a11y [F10](qa-a11y.md) | **Partly.** By design: the subject-page file filter "Kolokwium" and event titles are Polish tag or content (glossary). Real: `lib/simple.ts:47` ("Topics tagged Kolokwium" under a "Tests" title), `lib/simple.ts:53` vs the sidebar "files", `components/admin/AuditTable.tsx:26` (prints the raw action key; the label is only in `title`), and `components/ResultGrid.tsx:614` ("Akcje", missed by `check:lang` because it has no diacritics). |
| D13 | **Event kinds use colour emoji** (📝 🎓 🚌 ➕ 📌) in an otherwise SVG-icon UI. ➕ for "Extra class" reads as "add", and the type is in an `aria-hidden` glyph only. | curator [F7](qa-curator.md); a11y [F12](qa-a11y.md) | **Yes.** `packages/db/src/constants.ts:98-106` (`symbol`) is rendered in `WeekView.tsx:699`, `SessionPanel.tsx:224`, `components/events/EventDetails.tsx:84` and `components/simple/UpcomingEvents.tsx:35`. |
| D14 | **Simple and advanced disagree.** Search gives "4 files" vs "5 matches". "Subject platform" vs "UPeL / platform". "Designer / Data map / Schema". "Go" vs "Search". | curator [F13](qa-curator.md) | **Partly.** Real: simple keeps materials only (`lib/simple-queries.ts:200-206`) while advanced counts topic hits too (`app/(app)/search/page.tsx:41,123`). The link labels differ (`app/(app)/subjects/[code]/page.tsx:314` vs `app/(simple)/s/subjects/[code]/page.tsx:191`). Designer, Data map and Schema are separate glossary terms for separate screens, and the different start screens are by design. |
| D15 | **The audit log doesn't read as a log.** The "Admin" column lists students, Table holds raw ids (`14`, `class_mark:3`), Statement is empty for non-SQL actions, the time has no zone, and Action is off-screen at 375. | curator [F14](qa-curator.md); security §8 side remark | **Yes.** `components/admin/AuditTable.tsx:57-58` (header "Admin"), `:99` (raw `target`), `:104-112` (statement preview only). `app/(app)/admin/audit/page.tsx:67,100-106` (the toggle and the select repeat each other). |
| D16 | **No skip link.** There are 15 (simple) / 43 (advanced) tab stops before `<main>`. | a11y [F1](qa-a11y.md) | **Yes.** `components/simple/SimpleShell.tsx:206-208` and `components/shell/ShellFrame.tsx:178-180`: `<main id="content">` has no skip link and no `tabIndex=-1`. |
| D17 | **Timetable blocks and event links don't name their day.** | a11y [F2](qa-a11y.md) | **Yes.** The day columns are anonymous `div`s (`WeekView.tsx:282-292`). The block name starts with the time only (`:534`, `:645`, `:697`). |
| D18 | **File preview opens silently and sits at the end of the tab order** (stop 72 of 75). | a11y [F3](qa-a11y.md) | **Yes.** `SimpleShell.tsx:214` renders the `aside` after `<main>`. `components/simple/SimplePreview.tsx:66-74` moves no focus and has no status. "Loading preview…" is plain text (`components/FilePreview.tsx:8,27`). |
| D19 | **Successes are neither announced nor shown.** Turn on, Save note, Turn off, Not this week, the session auto-fill, My groups, Reminders and Link post give no "Saved". | a11y [F4](qa-a11y.md); student [F9](qa-student.md); novice [F6](qa-novice.md) (no "Saved") | **Yes.** `EntryQuizSection.tsx` has only `role="alert"` errors (`:216`). `MyGroupsForm.tsx:159-166` and `RemindersForm.tsx:80-84` show only failures. `EventForm.tsx:140-149` (`pickSession`) is silent. |
| D20 | **Required event-form fields are not marked**, and the "all day" hint is not linked to the time inputs. | a11y [F5](qa-a11y.md) | **Yes.** `EventForm.tsx:224-247` (`required` only, labels "Title" and "Date"). The hint at `:276-278` has no `id` / `aria-describedby`. |

### Low

| ID | Finding | Hit by | Verified |
|---|---|---|---|
| D21 | Tab out of the quiz popover drops focus to `<body>`. | a11y [F7](qa-a11y.md) | **Yes.** It is portalled to `body` (`EntryQuizBadge.tsx:159-219`), and `onFocusOut` → `close(false)` doesn't refocus the trigger (`:88-93`). |
| D22 | The panel heading is the generic "Class", the "2 tests" bar has no expanded state, and "+ Test" shows "Test" while it is named "Add test". | a11y [F8](qa-a11y.md); novice [F5](qa-novice.md) | **Yes.** `SessionPanel.tsx:91-98` and `:176-184`. `WeekView.tsx:467-476` has no `aria-expanded`/`aria-controls`. |
| D23 | Form errors are not tied to fields, and the event submit is `disabled` while saving, which drops focus. | a11y [F9](qa-a11y.md) | **Yes.** `EventForm.tsx:440-451`: the alert has no `aria-describedby`, and the submit uses `disabled={pending}`. |
| D24 | Repeated control names in the Entry quiz add-forms ("Note (optional)", "Turn on" once per class), and Polish content inside `lang="en"`. | a11y [F10](qa-a11y.md) | **Yes.** `EntryQuizSection.tsx:131` (the h3 isn't linked to the form at `:170-214`). `app/layout.tsx:12` with no `lang="pl"` on content spans. |
| D25 | Session panel copy: the Description row repeats the heading and Class, "Test:" prefixes the test link, and "gr 2" vs "Gr. 2". | curator [F5](qa-curator.md) | **Partly.** The duplicate row is `SessionPanel.tsx:82`, and the prefix is `:225`. "Ćwiczenia gr 2" is the raw UniTime label (content, by design). |
| D26 | Entry quiz controls are only at the bottom of the subject page, and there is no "Turn on" path from the timetable. | student [F6](qa-student.md); curator [F5](qa-curator.md), U4 | **Yes.** `app/(simple)/s/subjects/[code]/page.tsx:225-236` (after files and Next classes). `SessionPanel.tsx:153-165` only lists an existing quiz. |
| D27 | The Simple/Advanced toggle is icon-only at 375, and the sparkle icon doesn't mean "simple". | curator [F8](qa-curator.md) | **Yes.** `components/shell/ModeSwitch.tsx:30,36` (`max-md:sr-only`) and `:45` (no `title` on Simple). |
| D28 | Mobile wrapping and truncation: file meta wraps mid-value, the PDF toolbar wraps ("+" alone, stray "\|"), and breadcrumbs cut the current page to "Add e…". | curator [F9](qa-curator.md); mobile [F7](qa-mobile.md), [F14](qa-mobile.md) | **Yes.** `components/simple/FileList.tsx:53-54` (no `nowrap` on the values), `components/PdfViewer.tsx:52,72`, and `components/simple/Crumbs.tsx:16,33` (earlier crumbs are `shrink-0`, only the last one truncates). |
| D29 | Event form layout and wording: four field widths, "From (time)" / "To (time)", the date shows `dd/mm/yyyy` while the app writes "26 Oct 2026", and "Pick a session" comes after 9 fields on mobile. | curator [F10](qa-curator.md), U4.2 | **Yes.** `EventForm.tsx:234,250,263,280,339,383` (the picker is placed after Subject, Class and Group). The native date format follows the browser locale. |
| D30 | Native validation scrolls the empty Title so that its label is hidden at the top. | mobile [F10](qa-mobile.md) | **Partly.** The header is not over `<main>` (`SimpleShell.tsx:156,206`). The input is scrolled to the top edge of the `main` scroller with no `scroll-margin`, so the label above it is cut off. No `scroll-margin` exists in `app/globals.css`. |
| D31 | Event page controls: native "Choose files" next to "Add files", the cryptic materials empty state, and "+ Add event" as the first link. | curator [F11](qa-curator.md); mobile [F13](qa-mobile.md) | **Yes.** `components/events/EventUploads.tsx:130-141`, `EventDetails.tsx:129`, `app/(simple)/s/wydarzenia/[id]/page.tsx:55-61`. |
| D32 | "Discord post: being prepared" shown to students with no explanation, and no "Saved" after creating an event. | curator [F11](qa-curator.md); novice [F6](qa-novice.md) | **Yes.** `lib/event-page.ts:47-52`, rendered unconditionally by `EventDetails.tsx:112`. |
| D33 | The search highlight has inline padding, which splits words ("kolokwium\|-sql"). | curator [F12](qa-curator.md) | **Yes.** `app/globals.css:193-198` (`mark { padding: 0 2px }`). |
| D34 | The admin SQL editor collapses to one line before hydration (layout shift). | curator [F15](qa-curator.md) | **Yes.** `components/admin/AdminSqlConsole.tsx:293-300`: `height="100%"` on a wrapper with no min-height. |
| D35 | Schema designer connectors cross tables. On Structure, Size is always "—" and Total sums unrelated views. | curator [F16](qa-curator.md) | **Partly.** The Structure part holds: `app/(app)/structure/page.tsx:64,115,123`. The connector routing (`lib/designer-layout.ts`) is only confirmed from the screenshot. |
| D36 | The "Tests from the last 30 days" report counts posts tagged Kolokwium, not Test events. | curator [F17](qa-curator.md) | **Yes.** `lib/example-queries.ts:26-33` (topics joined to tag `Kolokwium`) and `lib/simple.ts:47`. |
| D37 | Tap targets are below 44 px: footer bars 24 px, menu 32, Sign out 19×15, panel close 26, selects 28, checkboxes 13. | mobile [F3](qa-mobile.md), [F5](qa-mobile.md) | **Yes.** `WeekView.tsx:385` (`h-6`), `SimpleShell.tsx:164` (`size-8`), `:195-201`, `SessionPanel.tsx:30` (`size-[26px]`), `MyGroupsForm.tsx:18` (`h-7`), `EntryQuizBadge.tsx:23,188`. |
| D38 | The preview stays on "Loading preview…" for a long time, and Close took about 20 s. | mobile [F6](qa-mobile.md) | **Env.** Close is a plain `Link` navigation (`SimplePreview.tsx:75-83`), so the delay is the recompiling dev server. A later reload rendered fine. |
| D39 | "Full screen" opens the raw PDF with no way back. | mobile [F8](qa-mobile.md) | **No.** The link already opens a new tab (`target="_blank"`, `SimplePreview.tsx:101-104`). The single-tab headless browser showed it in place. |
| D40 | The event form drops the picked session after a server error. | mobile [F9](qa-mobile.md) | **No.** The persona edited "To" before submitting, and editing a time deliberately clears the session (`EventForm.tsx:267-271`). The picker has no `name` (`:388`), so the session isn't submitted anyway. The Test attaches through class, group and date, so the feared "unattached Test" can't happen this way. |
| D41 | The delete confirmation reflows the row ("Cancel" wraps, Materials jumps about 40 px). | mobile [F11](qa-mobile.md) | **Yes.** `components/events/EventButtons.tsx:75-118` swaps in the confirmation inline in a `flex-wrap` row. |
| D42 | A hydration-mismatch dev error on `/s/plan` after saving My groups. | mobile [F16](qa-mobile.md) | **No.** Not reproduced, and the filter bar (`WeekView.tsx:184-203`) has no date- or locale-dependent text. Possibly a reload mid-render. Watch for it in the next run. |
| D43 | `favicon.ico` returns 404. | mobile [F17](qa-mobile.md); student (console) | **Yes.** There is no `app/icon.*`, `app/favicon.ico` or `public/favicon.ico`, and `app/layout.tsx:7` sets no icons. |
| D44 | "The timetable has not been synced yet" under a full grid looks like an error. | novice [F7](qa-novice.md); curator U2.5 | **Partly.** The text is accurate for the seeded sandbox (no UniTime sync). The copy is at `app/(simple)/s/plan/page.tsx:108` and `app/(app)/plan/page.tsx:97`, and it doesn't explain that the data exists anyway. |
| D45 | Search ignores diacritics in file names but not in file text ("zlozonosc" misses the `złożoność` text hit). | student [F7](qa-student.md) | **Yes.** `packages/db/src/search.ts:122-129` runs FULLTEXT on the raw text under `utf8mb4_unicode_ci` (`compose.yaml:21`), where `ł` ≠ `l`. The name hit came from the ASCII filename. No folded search column exists. |
| D46 | The event type is "Test" while titles and files say "kolokwium". | student [F10](qa-student.md) | **By design.** `docs/glossary.md` maps Kolokwium → Test, and titles are content. |

### Idea

| ID | Finding | Hit by | Verified |
|---|---|---|---|
| D47 | The event page doesn't show which class or group a Test belongs to. | mobile [F12](qa-mobile.md) | **Yes.** `EventDetails.tsx:63-79` has no Class row. |
| D48 | "Turn off" (entry quiz) applies at once, and a non-admin can't undo it. | a11y [F11](qa-a11y.md) | **Yes.** `EntryQuizSection.tsx:256-262`. Restore is admin-only (`:145-166`). |
| D49 | Simple search results show no snippet. | student [F8](qa-student.md) | **Yes.** `lib/simple-queries.ts:200-206` keeps only material ids from `searchAll`, and the snippet is dropped. |
| D50 | The entry-quiz stale-version message says "this event". | security [F5](../../audits/2026-10-25/security-runtime.md) | **Yes.** `packages/db/src/class-marks.ts:13,208,240` reuses `CONFLICT` from `packages/db/src/events.ts:65-66`. |
| D51 | Spec text still describes Polish messages. | security [F6](../../audits/2026-10-25/security-runtime.md) | **Partly.** CLAUDE.md and the glossary say the UI is English. The spec files that still say Polish were not located in this pass. |
| D52 | No Saturday column. | novice [F8](qa-novice.md) | **By design.** `packages/db/src/plan.ts:354-356` shows Mon–Fri plus any weekend day that has sessions or events. |

## Ideas

### Curator's top 5 (from [qa-curator.md](qa-curator.md))

1. **Fix the footer bars on crowded and narrow blocks** (D1, D2): merge two bars on a short block, clip inside the block, and degrade the label in narrow columns.
2. **Shorten the Test and Entry quiz flow** (D11, D26, U4): pick the session first, prefill the title, prefer My groups sessions, mark sessions that already have a Test, and add an Entry quiz toggle to the session panel and the top of the subject page.
3. **Put "what's next" first** on Start and the mobile timetable (D8, U1, U2): Upcoming events above the subject grid, an agenda view under 640 px, and time text on blocks.
4. **Unify the vocabulary and replace emoji with icons** (D12, D13, D36).
5. **Make search and the audit log answer real questions** (U5, D14, D15): events in search, the same counts in both modes, and an audit log that says who did what to which item.

### Raised by two or more personas

- **Show what's next on Start / open the timetable on the next class:** novice F1, student F1, curator U1/U2 (D8).
- **An obvious "Show only my groups" prompt when no groups are picked:** novice F2, curator U2.1 (D9).
- **Merge the two bars into one ("Quiz + Test") or cap the stack at one bar + count:** curator F1, student F5, mobile F2, a11y F6 (D1).
- **Prefill the Test title and label the action "Add test":** novice F5, curator F10 / U4.1 (D11).
- **Entry quiz on/off reachable from the timetable panel:** curator F5 / U4, student F6 (D26).
- **Visible "Saved" confirmations:** student F9, novice F6, a11y F4 (D19).
- **Undo next to destructive one-click quiz actions:** student F4 (Not this week), a11y F11 (Turn off) (D7, D48).
- **A legend or explanation for the Test / Entry quiz bars:** novice F3, curator U2.4 (D10).

## Proposed fix groups

Each group is one implementable task. The acceptance check is the one-line test or observation that closes it.

| # | Group | Findings | Files | Acceptance check |
|---|---|---|---|---|
| G1 | **Timetable bars on short / narrow / crowded blocks** | D1, D2, D37 (bar part) | `lib/plan-view.ts` (`badgeBarsFit` takes height **and** width; a combined "Quiz + Test" bar when two bars don't fit with 2 text lines), `components/plan/WeekView.tsx` (`overflow-hidden` on bars and block, hide detail and caret under ~90 px, `title`/`aria-label` keep full text), `test/plan-view.test.ts` | An e2e at 1440 and 375 on W44 (quiz + test on a 90-min block, and a 2-column overlap): every bar's bounding box is inside its block, and the subject code + class line boxes don't intersect any bar. |
| G2 | **Mobile horizontal overflow and wrapping** | D3, D28, D41, D30, D27 | `WeekView.tsx` (`relative` on the scroller / header cell), `components/simple/FileList.tsx`, `components/PdfViewer.tsx`, `components/simple/Crumbs.tsx` (mobile: last crumb + back chevron), `components/events/EventButtons.tsx` (confirmation on its own row), `components/shell/ModeSwitch.tsx`, `app/globals.css` (`scroll-margin-top` on form controls) | At 375 px `document.documentElement.scrollWidth === 375` on `/s/plan` (current week), the subject page, the preview and the event pages. The PDF toolbar is one row. |
| G3 | **Session panel layout and actions** | D4, D7, D22, D25 | `WeekView.tsx` (panel as a slide-over at `lg`, not a flex sibling), `components/plan/SessionPanel.tsx` (heading "ASD · Laboratorium Gr. 1 · Tue 27 Oct", drop the Description row when it equals subject + class, "Quiz skipped · Undo" row after a skip, visible "Add test" text), `components/plan/useSkipMark.ts` | With the panel open at 1440 all day columns are fully visible, and after "Not this week" the panel shows an Undo that restores the bar. |
| G4 | **A11y: skip link, announcements, labels** | D16, D17, D18, D19, D20, D21, D23, D24, D22 (`aria-expanded`) | `components/simple/SimpleShell.tsx`, `components/shell/ShellFrame.tsx` (skip link, `main tabIndex=-1`), `WeekView.tsx` (day columns `role="group"` + `aria-labelledby`), `components/simple/SimplePreview.tsx` (focus the heading on open), `components/plan/EntryQuizSection.tsx`, `components/plan/MyGroupsForm.tsx`, `components/plan/RemindersForm.tsx`, `components/events/EventForm.tsx` (polite `role="status"` messages, required markers, `aria-describedby`, `aria-disabled` submit), `components/plan/EntryQuizBadge.tsx` (refocus the trigger on Tab-out), `app/layout.tsx` / content spans (`lang="pl"`) | The first Tab shows "Skip to content" and Enter focuses `main`. Each listed success writes a message into a `role="status"` region (vitest + one e2e). Opening a preview moves focus into it. |
| G5 | **Copy and terminology** | D12, D32, D31, D36, D44, D50, D33, D10 | `lib/simple.ts` (report descriptions, "Files" vs "Materials"), `lib/example-queries.ts` (rename the topics report, or base it on `v_events`), `components/admin/AuditTable.tsx` (show the label, keep the key in `title`), `components/ResultGrid.tsx:614` ("Actions"), `lib/event-page.ts` / `EventDetails.tsx` (hide the Discord line unless it failed; a plain empty state), `app/(simple)/s/wydarzenia/[id]/page.tsx` (drop the top "+ Add event"), `components/events/EventUploads.tsx` (one file control), `app/(simple)/s/plan/page.tsx` + `app/(app)/plan/page.tsx` (sync line), `packages/db/src/class-marks.ts` (a quiz-specific conflict text), `app/globals.css` (`mark` padding), `WeekView.tsx` legend (Test, Entry quiz); also `docs/glossary.md`, and `scripts/check-ui-language.mjs` to catch "Akcje"-style words | `pnpm check:lang` passes with a word list that includes "Akcje". A copy test asserts the report, audit and conflict strings, and the legend lists Test and Entry quiz when the week has them. |
| G6 | **Start page and timetable defaults** | D8, D9, D5, D6 | `lib/plan.ts` (`defaultWeek`: when no session or event remains in the current week, go to the next week), `app/(simple)/s/page.tsx` (Upcoming events above Subjects), `WeekView.tsx` (a "Showing all groups. Pick yours" banner when no groups are saved; links honour `simple` → `/s/plan?tab=groups`; "N classes hidden: pick a group for AM2, BD…"), `components/plan/MyGroupsForm.tsx` (copy matches `filterMyGroups`, "All groups (not picked)") | On a Sunday with nothing left this week, `/s/plan` opens next week. In simple mode every My groups link stays under `/s`. The My groups text matches a vitest on `filterMyGroups`. |
| G7 | **Test / Entry quiz add flow** | D11, D29, D47, D26 (link part) | `lib/plan-events.ts` (`newTestHref` passes a title such as "Test – ASD Laboratorium"), `lib/event-form-page.ts` (prefill the title; heading "Add test" when `kind=kolokwium`), `app/(simple)/s/wydarzenia/nowe/page.tsx` + advanced twin, `components/events/EventForm.tsx` (Pick a session directly under Subject/Class; one field width; "Starts" / "Ends"), `components/events/EventDetails.tsx` (Class row), `SessionPanel.tsx` (an "Entry quiz settings" link to `#entry-quiz` when the class has no quiz) | From a session block, "Add test" then "Add event" creates the Test with no typing, and the event page shows "Class: Laboratorium Gr. 1". |
| G8 | **Icons for event kinds** | D13 | New `components/events/EventKindIcon.tsx` (Phosphor set); replace `EVENT_KINDS[k].symbol` in `WeekView.tsx`, `SessionPanel.tsx`, `EventDetails.tsx`, `UpcomingEvents.tsx` (keep emoji for Discord only) | `grep -rn "\.symbol" apps/web/components apps/web/app` returns nothing, and the kind is exposed as text (sr-only) where the icon stands alone. |
| G9 | **Admin audit log and advanced screens** | D15, D34, D35, D14 (labels, counts) | `components/admin/AuditTable.tsx` ("User" column, human target label + link, Details summary, time zone), `app/(app)/admin/audit/page.tsx` (drop the duplicate toggle), `components/admin/AdminSqlConsole.tsx` (reserve the editor's min-height), `app/(app)/structure/page.tsx` (drop Size for views, label Total), `app/(app)/subjects/[code]/page.tsx` ("Subject platform"), both search pages ("N files, M topics") | The audit row for an `event.add` reads "User · Event added · Test: Kolokwium 1 ASD, 26 Oct" with a link. The SQL write page has CLS 0 on load. |
| G10 | **Search folding and snippets** | D45, D49 | `packages/db` migration adding a folded text column, or a diacritic-folded query in `search.ts` (custom migration, never `push`), `lib/simple-queries.ts` + `components/simple/FileList.tsx` (pass and show the snippet) | `searchAll(db, { q: 'zlozonosc' })` returns the same materials as `'złożoność'` (`packages/db/test/search.test.ts`), and simple results show the snippet. |
| G11 | **Small fixes** | D43 | `app/icon.svg` (or `app/favicon.ico`) | No 404 for the favicon in the console. |

No action: D38 (Env), D39, D40, D42 (No), D46, D52 (By design), D51 (doc cleanup only, after locating the spec).

### Deferred (product decision)

These are larger product changes, not fixes. They need a decision before any task is planned.

- A "Today / This week" **classes** block on Start, filtered by My groups (student F1, curator U1 two-column layout). G6 only reorders the existing cards.
- An agenda (day list) view as the mobile default under 640 px, and time text on blocks (curator U2.2, U2.3).
- An "Only Tests and quizzes" timetable toggle (curator U2.4).
- My groups pre-selection from Discord activity, and auto-save with a toast (curator U3).
- A full Entry quiz on/off toggle in the session panel, a "Test already added" marker in "Pick a session", My groups sessions listed first, and a return to the timetable after "Add event" (curator U4.3–U4.5). G7 only adds a link.
- Events in search results and actionable empty states (curator U5).
- Subject page: remember the filter, counts on chips (curator U6). Recent: grouped by day, subject chips, "new" dots (curator U7).
- Admin "Needs attention" line and linked counters (curator U8). Advanced start on the SQL console (curator U9).
- Feature parity between modes (a "List" tab in simple; "Recently added" and reports in advanced) (curator F13).
- A confirm / undo policy for wiki-style quiz Turn off (a11y F11, D48).
- Showing Saturday always (novice F8, D52).

## Not tested / blocked

- **Environment:** the dev server's on-demand recompiles caused reloads every 15–30 s and a few `ERR_CONNECTION_REFUSED` / `ERR_EMPTY_RESPONSE` / `UND_ERR_SOCKET` windows. Lost or delayed actions were retried; a few remain unverified (student: the edit form fell back to a native GET before hydration, and "Simple" hung about 20 s after a restart; mobile: preview close; a11y: early focus losses, re-checked on stable pages). Re-run the timing-sensitive checks against a production build.
- **Not exercised:**
  - Real touch gestures, the on-screen keyboard, and tapping the drawer backdrop (mobile).
  - A real screen reader, 200 %/400 % zoom, forced colours and reduced motion (a11y used the Playwright tree only).
  - Restore of entry quizzes and events, i.e. the admin paths (a11y, student).
  - Event editing and deletion beyond opening the confirmation (curator, mobile).
  - File upload to events (mobile, student), and the Discord post and reminder DM (no bot in the sandbox).
  - Advanced `/wydarzenia/[id]` and the advanced My groups tab (curator).
  - Imported exam sessions (only event 14 existed).
- **Partial coverage:** the curator did not capture every combination (light 375 for Search, Recent, Reports, My groups and Event; dark 1440 for Recent and Search; dark 375 for Search, Recent and My groups).
- **Security runtime items F1–F4** (headers, login/logout CSRF, read-console server details, dev stack frames) are not UX findings. They are tracked in [security-runtime.md](../../audits/2026-10-25/security-runtime.md) and the static audit (L1, L2, I4).
- **Sandbox leftovers from the personas:** events 8, 9, 12, 14 and 24, soft-deleted events 11 and 15–23, 30 queued uploads on event 11, an Entry quiz on ASD Laboratorium Gr. 1, and quiz marks 5 and 6 turned off.
