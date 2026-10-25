# qa-curator — Ula Kuratorka (curator, admin) — 2026-10-25-ux

Summary: The interface is coherent, calm and readable in light and dark. The English copy is mostly clean, with a few term collisions (Test / Kolokwium / Exam / Egzamin, Materials / files / posts). The new timetable footer bars work, but they break down when a block has two bars or sits in a narrow column. Most of the usefulness gains are in shortening paths: the event form, the subject page quiz section, search that ignores events, and an audit log that names no one's action in words.

Coverage: simple and advanced, 1440 and 375, light and dark. Not every combination was captured for every screen. The 375 views were mainly dark, with light for admin, advanced plan, SQL and the subject quiz. Screenshots are in `.qa/screens/2026-10-25-ux/curator-NN-*.png` (about 70 files). I created one Test event (event 8, "Kolokwium 1 ASD (curator)") to see the bars. Other personas also added data, which I treated as normal.

Method: I used the audit criteria from the `redesign-existing-projects` and `minimalist-ui` skills. I checked the design reference only in passing and did not review it in detail. I did not open `apps/web/app/globals.css`.

## Findings (errors)

### F1 [medium] Two footer bars crush a 90-minute class block until the class name is unreadable
- Where: `/s/plan?week=2026-W44`, Wed, "ASD Ćwiczenia Gr. 2" (09:45-11:15), a block with both an Entry quiz bar and a Test bar. Source: `apps/web/components/plan/WeekView.tsx` (`barBase`, `testBar`, `quizBar`).
- Actual: the two 24 px bars take the whole lower half of the block. The header (subject code, class, room, lecturer) is clipped to a one-line sliver and overlaps the dashed rule, so you can't tell which class it is. Zoom: `.qa/screens/2026-10-25-ux/curator-32-bars-overlap-dark-zoom.png`. Full view: `curator-31-plan-dark-1440.png`.
- Expected: the block identity is always readable.
- Suggestion: with two bars on a block under about 100 px, merge them into one bar ("TEST + QUIZ >") or move the bars next to the title as 2 chips. Alternatively give the block a minimum height of 2 bars plus 2 text lines.

### F2 [medium] Bars overflow their block in narrow columns (side-by-side overlaps)
- Where: `/s/plan?week=2026-W44`, Tue "ASD Laboratorium Gr. 1" beside the Kolokwium event. At 1440 the "ENTRY QUIZ" label has no detail, a stray `>` sits outside the block in the Wed column, and the text above is struck through by the dashed rule. At 375 the same block is illegible. See `curator-09-panel-onthissession-light-1440.png`, `curator-51-plan-dark-375.png`.
- Expected: the bar clips inside the block (`overflow-hidden`), and the label degrades (icon or "Q") when the block is narrower than about 90 px.
- Suggestion: hide the `>` caret and the detail below a minimum width. Put the full text in `title` and `aria-label`.

### F3 [low] Dashed rule of the Entry quiz bar touches the lecturer line
- Where: `/plan` (advanced), Tue Gr. 1 block, and simple Fri "AM2 Wykład". The lecturer name ("Katarzyna Lewandowska") sits directly on the dashed border with zero padding, and it is truncated to "Lewando..." when the panel is open.
- Suggestion: 2-3 px of space above the bar. Truncate the lecturer before the bar, not after it.

### F4 [medium] The session panel squeezes the grid and cuts off Sunday
- Where: `/s/plan?week=2026-W44`, click any block at 1440. See `curator-04-session-panel-light-1440.png`, `curator-10-panel-withtest-light-1440.png`.
- Actual: the panel takes about 340 px. The grid keeps 6 columns, shrinks, and Sunday ("Sun") and the Konsultacje event are cut off with no scrollbar cue. Narrow blocks make F1 and F2 worse.
- Suggestion: overlay the panel on the right edge (slide-over) instead of resizing the grid, or collapse the sidebar while the panel is open.

### F5 [low] Panel "On this session" and Description copy
- Where: session panel, `curator-10-panel-withtest-light-1440.png`.
- Actual:
  - the link reads "Test: Kolokwium 1 ASD (curator)". The prefix repeats the kind and the title repeats the subject;
  - "Description: Algorytmy i struktury danych — Wykład" repeats the heading and the Class row above it;
  - the same field reads "Ćwiczenia gr 2" in `curator-09-panel-onthissession-light-1440.png`, against "Ćwiczenia Gr. 2" in the Class row. The "Gr." casing differs;
  - the panel has no Entry quiz action. It can only add a Test, so the quiz is managed in another place (the subject page).
- Suggestion: drop the Description row when it equals the title. Show "Test · 08:00" with an icon. Add an "Entry quiz" button or toggle to the panel, with the same prefilled context.

### F6 [medium] Terminology: Test / Kolokwium / Exam / Egzamin / Entry quiz / Wejściówka
- Where, across screens:
  - The event type is "Test" (`EVENT_KINDS.kolokwium.label`), but the Discord tag, the subject page file filter ("Type: Kolokwium"), the report card ("Tests from the last 30 days - Topics tagged Kolokwium") and every title say Kolokwium.
  - The exam block says "Exam" and its title says "Egzamin z sieci" (`curator-70-plan-w2027-03-light-1440.png`).
  - The Start sidebar says "files", the report says "Materials", the event page says "Materials" and "Link posts", and the report card says "Topics".
  - The audit log and the sidebar use `class_mark` / `v_class_marks` / `v_class_mark_skips` for what the UI calls Test and Entry quiz.
- Suggestion: pick one student-facing word per concept. For example, keep "Test" as the label and show "Kolokwium" only as content. Rename "Materials" in the reports to "Files". In the audit and the view tree, map `class_mark.add` to "Entry quiz turned on" with a tooltip that keeps the technical name.

### F7 [medium] Emoji as icons (and an icon with no meaning)
- Where: `/s` "Upcoming events" (📝 🚌 ➕), timetable event pills, the event page badge ("📝 Test"), the panel link.
- Actual: the app uses lined SVG icons everywhere else (Phosphor-like, consistent stroke), but event kinds use colour emoji. These render differently per OS, clash visually (see the yellow notepad vs the grey ➕ in dark) and violate the minimalist standard. ➕ for "Konsultacje" (type "Extra class") reads as "add", not as a class. In dark mode ➕ is a flat grey glyph.
- Suggestion: replace `EVENT_KINDS[k].symbol` with an SVG set (test = pencil or check-square, exam = graduation cap, trip = bus, extra class = plus-in-calendar, other = dot). Keep the emoji for Discord only.

### F8 [low] Simple/Advanced toggle is icon-only at 375 and its icons have no meaning
- Where: any page at 375 (`curator-50-start-dark-375.png`). Two small glyphs (sparkle and terminal) replace "Simple" and "Advanced". There's no label or tooltip, and a sparkle doesn't say "simple".
- Suggestion: keep the text on mobile ("Simple | Advanced" at 11 px) or put the toggle in the drawer menu. Use a simple "list" icon vs a "code" icon.

### F9 [low] Mobile text wrapping and truncation
- Where: `/s/subjects/ASD` at 375. File meta wraps mid-value ("181" / "B", "22" / "Oct 2026") — `curator-53-subject-dark-375.png`. The preview zoom controls break into three lines with an orphan "|" and a lone "+" (`curator-54-preview-dark-375.png`, also at 1440 in `curator-13-preview-light-1440.png`). Breadcrumbs are cut to "Add e…" on the event form and "studies_db » A… » Au…" on advanced admin pages.
- Suggestion: use non-breaking spaces between value and unit and inside dates (`white-space: nowrap`). Make the zoom control a single row (`[-] 100% [+]`) and drop the "|" separator. On mobile show only the last breadcrumb item with a back chevron.

### F10 [low] Event form: layout and wording
- Where: `/s/wydarzenia/nowe` (`curator-05-eventform-light-1440.png`, `curator-36-eventform-dark-1440.png`).
  - Fields have 4 different widths (Type, Title, Subject, Pick a session are full; Repeat, Class are narrower; Class + Group are half each). The form hugs the left with 500 px of empty space.
  - "From (time)" and "To (time)" repeat the type in brackets.
  - Title has no placeholder, so a Test's title is empty (the form accepts "Kolokwium 1 ASD (curator)" but gives no hint).
  - The date input shows `dd/mm/yyyy` while the app writes "26 Oct 2026".
- Suggestion: make all fields one width. Use "Starts" and "Ends" with the helper "Leave empty for an all-day event". Suggest a title from kind + class ("Test, ASD Wykład").

### F11 [low] Event page: file input and Discord jargon
- Where: `/s/wydarzenia/8` (`curator-06-event-created-light-1440.png`, `curator-35-event-dark-1440.png`).
  - "Choose files No file chosen" (the native input) sits next to a separate "Add files" button, so it looks like two controls.
  - "Discord post: being prepared" is shown to students with no meaning for them.
  - The materials empty state ("They appear once you link posts that have files") is cryptic.
  - The top "+ Add event" link on an event page is out of place.
- Suggestion: one dropzone ("Drop files or choose"). Hide the Discord line unless it failed. Rewrite the empty state ("No files yet. Add files above."). Remove "+ Add event" from the event page, or move it to the breadcrumb.

### F12 [low] Search highlight splits words and gaps
- Where: `/s/search?q=kolokwium` (`curator-14-search-light-1440.png`). The yellow highlight has horizontal padding, which creates a visible gap in "Kolokwium 1" and breaks the filename `kolokwium|-sql-przyklad.txt`.
- Suggestion: highlight with a background and no padding (`box-decoration-break: clone`, zero inline padding).

### F13 [medium] Simple and advanced disagree
- Search: simple returns "4 files"; advanced returns 5 matches (includes topics). The same query gives different counts and neither explains why. `/s/search?q=kolokwium` vs `/search?q=kolokwium` (`curator-22-adv-search-light-1440.png`).
- Names: subject platform link is "Subject platform" in simple and "UPeL / platform" in advanced. The same screen is "Designer" (`/schema` tab), "Data map" and "Schema" (subject tabs).
- Features: advanced Timetable has a "List" tab that simple lacks; simple has "Recently added" and "Ready-made reports", advanced has no page for them.
- Start: simple opens on Subjects, advanced on a SQL result of the same data. The Add action there is "Go" (search) in one place and "Search" in another.
- Suggestion: use one name per concept. Add the "List" view to simple (see U4) or drop it from advanced. State "N files, M topics" in both searches.

### F14 [medium] Audit log does not read as a log
- Where: `/admin`, `/admin/audit` (`curator-26-admin-light-1440.png`, `curator-28-audit-light-1440.png`). The Table column holds raw ids ("14", "class_mark:3", "series:1"). The Statement column is empty for every non-SQL action. The "Admin" column and filter list students (Ola Studentka). The "Everyone / Admins" toggle repeats the Admin select. The time reads 01:09 for something the sandbox clock created at about 01:09, with no time zone label. At 375 the Action column is off-screen (`curator-61-audit-dark-375.png`).
- Suggestion: rename "Admin" to "User", fill "Target" with a human label and link ("Test: Kolokwium 1 ASD, 26 Oct"), and replace the empty Statement column with a "Details" summary. Add a zone label (CEST) to Time.

### F15 [low] Admin SQL editor collapses to a line before hydration
- Where: `/admin/sql` first paint (`curator-27-adminsql-light-1440.png`). The editor is a 1-line strip until CodeMirror loads, then grows to 180 px (dark screenshot shows the loaded state with a placeholder). It causes layout shift.
- Suggestion: reserve the final height with CSS.

### F16 [low] Schema designer and Structure page
- Where: `/schema` (`curator-24-adv-schema-light-1440.png`): connector lines cross through other tables and the layout is dense. `/structure` (`curator-25-adv-structure-light-1440.png`): "Size" shows "—" in every row, and the "Total 308" sums rows across unrelated views. The Structure tab also doesn't mention the 3 new `v_class_*` and `v_events` views.
- Suggestion: remove the Size column for views, drop the Total or label it "rows across views", route connectors around tables.

### F17 [low] Reports: wording and gaps
- Where: `/s/reports` (`curator-16-reports-light-1440.png`). The third card says "Tests from the last 30 days" but its description says "Topics tagged Kolokwium", so it counts file posts, not the new Test events. A student expects the events.
- Suggestion: make the report "Tests and exams in the next 30 days" from `v_events`, and keep the topics report under a different name.

## Usefulness

### U1 [idea] Start (`/s`): "what's next" is below the fold
- Likely task: "Is there anything this week, and where is the file for it?" Today: open Start, scroll past 6 subject cards, find "Upcoming events", click an event, then click Materials. About 3-4 steps.
- Change: move "Upcoming events" above the subject grid, or into a two-column layout at 1440 (subjects left, a 5-item "Next 7 days" column right with kind icon, date, class). At 375 show the events first. Add Test and Exam badges to subject cards ("Test on 27 Oct").

### U2 [idea] Timetable (`/s/plan`): defaults for a student
- Likely task: "What do I have today and tomorrow, and is there a Test?" Today: Timetable, then My groups tab, set 7 selects, Save, Week tab, find the day (4-5 steps), and the page opens on a full week where "Today" is a grey column.
- Changes:
  1. If no groups are saved, show a one-line banner above the grid: "Showing all groups. Pick yours" with a link to My groups.
  2. On 375 the grid shows only 2.5 columns. Add an agenda view (one day per section, with times as text) as the default under 640 px. Blocks also have no time text, so the time is only readable from the axis.
  3. Show time on blocks ("08:00-09:30") at 1440.
  4. Add a legend toggle: "Only Tests and quizzes".
  5. "The timetable has not been synced yet" (My groups) contradicts a full grid. Show the last sync time or hide the line.

### U3 [idea] My groups: seven selects with no memory
- Likely task: "Set my groups once." Today: 7 manual selects, then Save and Clear, with the label "All" meaning "no group chosen".
- Change: pre-select the group when the user has uploaded or been seen in a "Gr. N" thread. Show a short "Pick Gr. 1, 2 or 3 per class" help. Label the default "All groups (not picked)". Auto-save on change with a toast.

### U4 [idea] Test / Entry quiz flow (focus area)
- Likely task: "Add the kolokwium on Tuesday" (click block, panel, "+ Test", form, Add event). 4 clicks plus Title. Good prefill (kind, subject, class, session). Improvements:
  1. Pre-fill Title with kind + class ("Test, ASD Wykład"), so "Add event" is enabled with one click.
  2. In `/s/wydarzenia/nowe`, put "Pick a session" directly under Class and above Date, since it fills Date, Time and Place. At 375 it currently sits after 9 fields (`curator-55-eventform-dark-375.png`).
  3. When a class has groups (12 options for ASD Laboratorium), show the user's My groups sessions first, or pre-select when only one is in My groups.
  4. Mark sessions that already have a Test in the "Pick a session" select ("Tue 27 Oct, 10:00 - Test already added"). Today the list gives no hint.
  5. After "Add event" return to the timetable week of the new event, not the event page, with the new bar focused.
- Entry quiz: the only place to turn it on is the bottom of the subject page (below 9 files, 768 px wide against a 1080 px page: `curator-12-subject-quiz-light-1440.png`). Move the section to a "Quiz" tab or an anchor chip near the class filters ("Entry quiz: on for Gr. 1"). Show "On / Off" as a switch with a visible state, not "Turn on" / "Turn off" plus "On · Gr. 1" (ambiguous). Add the same toggle in the session panel.
- Subject page "Next classes" cards (`curator-12-...`): add the Test and quiz chips there too, so the subject page and the timetable agree.

### U5 [idea] Search: nothing for events
- Likely task: "When is the Algebra kolokwium?" Today: search "kolokwium" returns 4 files and no event (`curator-14-search-light-1440.png`). The student has to go back to the timetable or Start.
- Change: add an "Events" section above the files, with date and a link. Make the empty state ("Nothing found. Try another word.") offer actions: "Browse subjects" and "Add event".

### U6 [idea] Subject page: first files and filters
- Likely task: "Get last year's kolokwium PDF." Today: Subject, then the Type filter chip "Kolokwium", then Preview or Download (3 clicks). Good.
- Change: remember the last filter per subject, show "9 files" counts on chips (Wykład 3, Laboratorium 3, Kolokwium 2). The preview panel hides the filter chips on narrow widths. Put Download on the row (already) and let Esc close the preview.

### U7 [idea] Recent
- Likely task: "What was added today?" Fine as a flat list. Change: group by day ("Today", "Yesterday") and show a count at the top ("22 files"). Add "Subject" chips to filter. A new-file dot would help return visits.

### U8 [idea] Admin overview (`/admin`)
- Likely task: "Did anything go wrong, who changed what?" Today: the first screen is counters plus the raw log. Change: show a "Needs attention" line (failed jobs, failed Discord posts, events added by banned users) above the counters. Make each counter a link (Jobs failed leads to the filtered list). Show the time zone. In SQL - write, keep the example placeholder (shown in dark) in both themes.

### U9 [idea] Advanced start and SQL
- Likely task: "Run a query on the views" (SQL tab, one query). Change: make the opening screen of the advanced mode the SQL console with the last query, not a large auto-generated SELECT that fills the screen at 375 (`curator-60-adv-start-dark-375.png`). In the SQL console column list, widen so `discord_channel_id` doesn't truncate, and show the History count only when above 0 ("History (0)..." is clutter).

## What worked well
- Both themes are well tuned: dark mode uses an off-black canvas, readable tinted accents and no pure-white text. The class kinds keep their hue in both modes, and the Test bar inverts correctly (`curator-31-plan-dark-1440.png`).
- Footer bars are a good solution at normal block height: 24 px targets, small caps label plus detail, dashed vs solid separation for quiz vs Test (`curator-07-plan-testbar-light-1440.png`).
- Cancelled sessions (strike-through, red "Cancelled") are clear.
- Empty states have an icon and a sentence (search, materials). Subject cards, file rows and report tables share consistent spacing and a single accent colour.
- The 375 layout keeps the main flow usable: the drawer, stacked cards, full-screen file preview and session panel all work.
- The "Pick a session" select adapts to the class (4 sessions for the Wykład, 12 with group names for the Laboratorium) and prefills date, time and place from the URL.

## Not tested / blocked
- Two transient `ERR_ABORTED` / `ERR_CONNECTION_REFUSED` errors appeared on the sandbox for a few seconds at about 23:13 UTC (dev server recompile or restart by another persona). A retry succeeded. I did not treat them as a finding.
- Not captured in every combination:
  - light mode at 375 for the simple Search, Recent, Reports, My groups and Event pages;
  - dark mode at 1440 for Recent and Search results;
  - dark 375 for Search, Recent and My groups.
- I did not check keyboard focus order, the 24 px target sizes by measurement, or screen reader output. The accessibility persona covers them.
- I did not review the Moje grupy tab in advanced mode (`/plan` "My groups") or `/wydarzenia/[id]` in advanced.
- I did not test event deletion or editing.
- Exam events: only one (event 14) exists, and clicking it opens the event page, not the panel. I didn't see an imported exam session.
- The sandbox shows "The timetable has not been synced yet" on My groups. That can be a sandbox data state, not a bug (guess).

## Top 5 changes by expected impact
1. **Fix the footer bars on crowded and narrow blocks** (F1, F2, F3). Merge two bars into one when the block is short, clip inside the block, and degrade the label in narrow columns. Today the headline feature makes the class unreadable in the busiest weeks.
2. **Shorten the Test and Entry quiz flow** (U4). Pick a session first, prefill the title, prefer the user's groups, mark sessions that already have a Test, and add an Entry quiz toggle to the session panel and to the top of the subject page.
3. **Put "what's next" first on Start and mobile Timetable** (U1, U2). Upcoming events above the subject grid, an agenda view under 640 px, and time text on blocks.
4. **Unify the vocabulary and replace emoji with real icons** (F6, F7, F17). One name per concept (Test, Exam, Files), Polish only as content, consistent between simple, advanced, reports, audit and the view names.
5. **Make search and the audit log answer real questions** (U5, F13, F14). Search should include events, show the same counts in both modes, and the audit log should read "who did what to which item" with names, links and a time zone.
