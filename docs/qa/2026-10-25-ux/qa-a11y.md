# qa-a11y — Klawiaturowy Kuba (keyboard and screen-reader user) — 2026-10-25-ux

Summary: The new timetable footer bars, the quiz popover and the session panel are keyboard-friendly, and I found no
blocker. Escape closes both, and focus returns to the trigger. The "On this session" list is real list markup, "Not
this week" has a good label, and the "Undo <date>" labels are precise. The error text colour passes comfortably in
both themes. The gaps are mostly navigation and announcements. There is no skip link. Plan buttons carry no day or
date. Nearly every success (Turn on, Save note, Turn off, Not this week, the "Pick a session" auto-fill) is silent,
and the file preview opens at the very end of the tab order.

Environment note, not an app defect: during the run the shared dev sandbox fully reloaded the page every ~15-30 s
(Fast Refresh "rebuilding", `performance.now()` reset). That reset focus, and it first made Turn on / Turn off look
like they dropped focus to `<body>`. On stable pages, with `performance.now()` continuous, the focus behaviour was
fine (see "What worked well"). I re-verified each result below on a page that did not reload.

Method: keyboard only after login (Tab, Shift+Tab, Enter, Space, Escape, typeahead). Read-only `browser_evaluate` for
`document.activeElement`, computed colours and the tab-stop count. Screenshots are in `.qa/screens/2026-10-25-ux/`.

Data I touched in the sandbox:
- AM2 Wykład entry quiz: turned on, turned off, then on and off again. It is off now.
- ASD Laboratorium Gr. 1 quiz (belongs to the mobile persona): I pressed "Not this week" for 27 Oct, then pressed
  Undo. It is restored.
- Created test event #24 "Kuba" on the ASD Lab Gr. 1 session of 27 Oct. That session now has "2 tests".

## Findings

### F1 [medium] No skip link; 15 (simple) / 43 (advanced) tab stops before the main content
- Where: every page. Measured on `/s/plan`, `/s/subjects/ASD` and `/plan`.
- Steps: 1. Load the page. 2. Press Tab and count the stops until the first control inside `<main>`.
- Expected: a "Skip to content" link as the first stop, or a quick way past the side panel (WCAG 2.4.1 Bypass Blocks).
- Actual: no skip link. The first Tab goes to the logo. `<main>` starts at focusable #15 in simple mode. In advanced mode
  it starts at #43, because the "Database tree" sidebar is expanded and has ~40 tab stops. Landmarks do exist
  (`complementary "Navigation panel"`, `navigation`, `banner`, one `main`), so a screen-reader user can jump, but a
  keyboard-only user cannot.
- Evidence: `evaluate`: `{total:82, firstInMain:43, skipLinks:0}` for `/plan`.
- Suggestion: add a visually-hidden-until-focused `<a href="#main">Skip to content</a>` at the top of both shells, and
  give `<main>` an `id` and `tabIndex=-1`.

### F2 [medium] Timetable session buttons and event links have no day or date in their name
- Where: `/s/plan?week=2026-W44`, `/plan` (week grid).
- Steps: 1. Open the week view. 2. Read the blocks with the a11y tree or Tab through them.
- Expected: each block says which day it is on, for example "Tue 27 Oct, 10:00–11:30 ...", or the day columns are named
  groups / grid columns (WCAG 1.3.1, 2.4.6).
- Actual: the day columns are anonymous `<div>`s, and the day headings (Mon 26 Oct ...) are separate `generic`s that are
  not tied to the columns. The block name is "10:00–11:30 ASD Laboratorium Gr. 1 C-2 015 Tomasz Zieliński". Event links
  read "10:00 Kolokwium 1 AM2 C-12". The footer bars ("Test: ...", "Entry quiz ...") don't have the date either. A
  screen-reader user learns the day only by opening the panel ("Tuesday, 27 October 2026").
- Evidence: DOM check: no `role`/`aria-label` on the column wrappers, `[role=columnheader],th` count = 0.
- Suggestion: give each column `role="group"` with `aria-labelledby` pointing at its day header, or add the day to the
  block's accessible name (a visually-hidden prefix).

### F3 [medium] File preview opens silently and sits at the end of the tab order
- Where: `/s/subjects/ASD`, "Preview file ..." link, simple mode.
- Steps: 1. Tab to "Preview file zakres-egzaminu.txt" (~27 Tabs). 2. Press Enter.
- Expected: focus or a status announcement moves to the preview (WCAG 2.4.3, 4.1.3).
- Actual: the URL becomes `?file=9` and the `complementary "File preview"` appears, but focus stays on the link. Nothing
  is announced. The panel is outside `<main>`, as the last block in the DOM. Its first control is tab stop 72 of 75 on
  that page. Reaching the panel you just opened means ~45 more Tabs. (Escape does close it and keeps focus on the link.)
  The placeholder "Loading preview…" is plain text, not a live region.
- Evidence: `evaluate` (`?file=9`): `{total:75, firstInPreview:72, mainIdx:15, previewInMain:false}`.
- Suggestion: on open, move focus to the panel heading ("File preview", `tabIndex=-1`) or add `role="status"` text
  ("Preview opened"). Alternatively render the panel right after the list.

### F4 [medium] Status changes are not announced (Turn on, Save note, Turn off, Not this week, session auto-fill)
- Where: subject page "Entry quiz every session" (`/subjects/AM2`, `/s/subjects/AM2`, `/s/subjects/ASD`); timetable
  quiz popover and session panel; event form "Pick a session".
- Steps and observed results (all on a page that did not reload):
  - "Turn on": focus stays on the Turn on button. A new group "On · All groups" appears above it. No live region, no
    text; the SR user hears nothing.
  - "Save note": focus stays on "Save note", which silently becomes `aria-disabled=true`. Nothing says "Saved".
  - "Turn off": focus moves to the section heading ("Entry quiz every session"). That is a good park, but the heading
    gives no result. The row is just gone.
  - Panel "Not this week": the "Entry quiz · Bring laptop..." line disappears and focus lands on the heading "Class".
    Nothing says the quiz was skipped for 27 Oct.
  - Event form "Pick a session": choosing an option fills Date, From, To and Place with no announcement. The options
    list also changes from "Loading sessions…" to the real options with no announcement.
  - My groups (`/plan?tab=groups`) autosaves each pick; I found no success text or live region in the code (code-read,
    not exercised).
- Expected: a polite live region ("Entry quiz turned on", "Note saved", "Skipped on Tue 27 Oct", "Date, time and place
  filled in") (WCAG 4.1.3).
- Actual: only errors are announced (`role="alert"`). Successes are not. The `role="status"` regions in the app are only
  for the SQL console, the result grid and Reminders.
- Evidence: after each action `[role=status],[aria-live]` count was 0 on the subject page. The panel snapshot after
  "Not this week" shows the heading `[active]` and no quiz line.
- Suggestion: one `<div role="status" class="sr-only">` per section, filled by the action result message.

### F5 [medium] Required fields in the event form are not marked
- Where: `/s/wydarzenia/nowe` (and `/wydarzenia/nowe`): Title and Date.
- Steps: 1. Open the form. 2. Look at the labels. 3. Press "Add event" with an empty Title.
- Expected: a visible "required" marker plus `aria-required`, or a note "Fields marked * are required" (WCAG 3.3.2).
- Actual: Title and Date have the native `required` attribute only. The labels say just "Title" and "Date" (see
  screenshot). Submitting empty works well (focus jumps to Title and the browser reports "Please fill in this field."),
  but that bubble is in the browser's language and not tied to the page. The "Without a time the event lasts all day."
  hint is not linked to the time fields via `aria-describedby`.
- Evidence: `.qa/screens/2026-10-25-ux/a11y-7-eventform.png`.
- Suggestion: add "(required)" or an asterisk with a legend, and `aria-describedby` on the From/To inputs.

### F6 [medium] Footer bars cover the block text in short and narrow blocks
- Where: `/s/plan?week=2026-W44`: Wed 28 Oct 09:45 ASD Ćwiczenia Gr. 2 (Entry quiz + Test), Tue 27 Oct ASD Lab column (a
  narrow column that also holds an event), Mon ASD Wykład (Test bar over the lecturer name).
- Steps: 1. Open week 44 at 1280 px. 2. Look at the blocks with two bars.
- Expected: the block title stays readable (WCAG 1.4.4 / 1.4.10 spirit; contents don't overlap).
- Actual: a 90-minute block is 82 px tall and a bar is 24 px. The Wed 09:45 block with two bars
  (~50 px) has "ASD / Ćwiczenia Gr. 2 / B-1 110" drawn under the bars: the text is garbled. In the narrow Tue column
  "ENTRY QUIZ" is clipped to "ENTRY QUIZ ›" over the block title. The bars use 10-11 px text. The accessible name is not
  affected, so this hurts low-vision users, not screen-reader users.
- Evidence: `.qa/screens/2026-10-25-ux/a11y-5-testbar-focus.png`, `.qa/screens/2026-10-25-ux/a11y-8-plan-dark.png`.
- Suggestion: collapse to the 4 px stripe (or a single "2 items" bar) when the free height is below the content
  height, or raise the minimum block height when badges exist.

### F7 [low] Quiz popover: Tab out of the last control drops focus to the end of the page
- Where: timetable (`/s/plan?week=2026-W44`), "Entry quiz" bar popover.
- Steps: 1. Focus the Entry quiz bar and press Enter. Focus goes to "Not this week". 2. Tab to "Edit". 3. Tab again.
- Expected: focus continues to the next control after the trigger, or stays trapped until closed (WCAG 2.4.3).
- Actual: the popover is portalled to the end of `<body>`. Tab from "Edit" closes it and `activeElement` becomes
  `<body>`, so the next Tab restarts at the top of the page and the user loses their place in the grid. Tab from the
  trigger (not Enter) goes to the next bar, not into the popover, which is acceptable because Enter moves focus in.
  Shift+Tab from "Not this week" goes to "Close", fine.
- Evidence: `evaluate` after the second Tab: `{a:"body", dlg:false}`.
- Suggestion: on focus-out by Tab, return focus to the trigger and let the browser continue from there, or add a
  focus trap.

### F8 [low] Panel heading is the generic word "Class"; "2 tests" button has no popup/expanded state
- Where: session panel (`complementary "Class details"`), "2 tests" footer button.
- Steps: 1. Open any session. 2. Read where focus lands.
- Expected: the heading says what was opened (subject/class/date), or the trigger exposes its state (WCAG 2.4.6, 4.1.2).
- Actual: focus lands on `heading "Class"`, which says nothing. The session block button has `aria-pressed`, but the
  "2 tests: Kolokwium z kopców (mobile), Kuba" button has no `aria-haspopup`, `aria-expanded`, or `aria-controls`. The
  name itself is good (visible text "2 tests" is contained in the name). The "Add test" link's visible text is just
  "Test" (the name "Add test" still contains it).
- Evidence: panel snapshot above; `evaluate` on the focused "2 tests" button: `hp:null, exp:null`.
- Suggestion: heading text like "ASD · Laboratorium Gr. 1 · Tue 27 Oct"; `aria-pressed` or `aria-expanded` on the bar.

### F9 [low] Form errors are not tied to fields; the event form's submit button is `disabled` while saving
- Where: entry quiz section, quiz popover, event form.
- Steps: 1. On `/subjects/AM2` turn on the Wykład quiz twice. 2. Read the message.
- Expected: the message is announced and, where it concerns a field, linked with `aria-describedby`/`aria-invalid`
  (WCAG 3.3.1).
- Actual: "Entry quiz is already on for this class." is a `role="alert"` `<p>` after the form. It is announced, and focus
  stays on "Turn on", which is good. It is not linked to any field. Code-read: `EventForm.tsx` uses
  `disabled={pending}` on the submit button, so focus can drop while saving, unlike the quiz buttons, which use
  `aria-disabled` on purpose. I could not provoke a server-side event-form error to see it.
- Evidence: screenshot `.qa/screens/2026-10-25-ux/a11y-2.png`.
- Suggestion: `aria-disabled` on the event submit button. Keep the alert, and on failed submits move focus to it or to
  the first invalid field.

### F10 [low] Repeated control names on the subject page; Polish content with `lang="en"`
- Where: `/subjects/AM2` and `/s/subjects/AM2` Entry quiz section; subject tables; plan blocks.
- Expected: unique names (WCAG 2.4.6, 3.3.2) and a `lang` on foreign-language text (WCAG 3.1.2).
- Actual:
  - A class with no quiz shows `textbox "Note (optional)"` + `button "Turn on"`, once per class. The class names ("Wykład",
    "Ćwiczenia") are only in `<h3>`s, not in the accessible names, so forms-mode users hear identical names. The "on"
    rows are named correctly (`group "Entry quiz: All groups"`).
  - `<html lang="en">`, but class names, subject titles and file titles are Polish with no `lang`, so an English screen
    reader mispronounces them. The advanced file table header "Akcje" is Polish in the English UI.
- Suggestion: `aria-labelledby` of the h3 on each add-form (`role=group`); `lang="pl"` on content spans; "Actions".

### F11 [idea] "Turn off" has no confirmation and a non-admin cannot undo it
- Where: entry quiz section.
- Actual: Turn off applies at once. Only admins see "Turned off · Restore" (not tested, I'm not an admin). It is a
  wiki-style action that affects every student. A short confirm, or an "Undo" for the person who did it, would help
  keyboard users who press Enter by mistake.

### F12 [idea] Event type on start page and week grid lives only in an `aria-hidden` emoji
- Where: `/s` "Upcoming events", week grid event links ("Kolokwium 1", "Konsultacje").
- Actual: the type icon (📝, ➕, 🚌) is `aria-hidden`, so the type is in the name only if the title says so. The event
  page does show the type as text ("Test"), and the footer bars say "Test", so nothing relies on colour alone; this
  is a polish item (WCAG 1.3.1).

## Contrast (computed from `apps/web/app/globals.css` tokens and checked live)

| Pair | Light | Dark |
|---|---|---|
| Error text `text-err-fg` on page/panel (live: rgb(153,27,27) on #fff, rgb(252,165,165) on rgb(9,9,11)) | 8.31:1 | 10.48:1 |
| Error text on `err-bg` box (event form) | 7.60:1 | 9.43:1 |
| Error text on `surface` | 7.56:1 | 9.33:1 |
| Muted text `--muted` / `--faint` on bg | 7.73 / 4.83 | n/a / 6.13 |
| Accent link ink on panel | 7.37:1 | 9.00:1 |
| Class block ink on tint (Wykład, Lab, Ćwiczenia, Projekt) | 6.27-7.72 | 8.67-10.07 |
| Footer bars, live computed in dark (Test, Entry quiz) | n/a | 8.67-10.07 |
| Focus ring (accent, 2 px) on page | 7.37:1 | 3.85:1 (≥3:1 OK) |

All text pairs I checked pass 4.5:1. `--subtle` (#a1a1aa, 2.56:1 on white) is used only for `aria-hidden` separators and
icons. Bar text is small (10-11 px) but passes the ratio. Evidence screenshots:
`.qa/screens/2026-10-25-ux/a11y-2.png` (light error), `.qa/screens/2026-10-25-ux/a11y-3-dark.png` (dark error).

## What worked well
- Footer bars have good names. "Test: <title>" is a link to the event; "Entry quiz <note>" is a button
  (`aria-haspopup=dialog`); "2 tests: A, B" is a button that opens the panel. Test vs quiz differ by text and
  fill vs dashed rule, not by colour only. "Cancelled" is spelled out, and "(today)" is text.
- Quiz popover: Enter opens it and focus goes to "Not this week" (`data-autofocus`). Dialog name is "Entry quiz" via
  `aria-labelledby`. Shift+Tab reaches "Close". Escape closes and returns focus to the bar, and (per the code) leaves
  the session panel open.
- Session panel: focus moves to the heading on open. Escape closes and returns focus to the session block (`aria-pressed`
  goes back to false). "On this session" is a `<h3>` + `list "Tests"` + the quiz line with "Not this week" and "Edit". The
  emoji is `aria-hidden`. With two tests both are listed with their names.
- Subject page: "On" rows are `group "Entry quiz: All groups"`, "Undo Tue 27 Oct" is labelled per date, and Turn off /
  Undo park focus on the section heading (`tabIndex=-1`) instead of losing it. "Save note" keeps focus. Errors use
  `role="alert"` and focus stays. A URL fragment `#entry-quiz` (what "Edit" links to) sets the keyboard start point
  inside the section: the next Tab was "Turn off".
- Event form: the "Pick a session" select is labelled and `aria-describedby` its hint. `session=9` in the URL preselects it
  and fills Date/Time/Place. It works with typeahead. After submit the app redirects to the new event page.
- Focus ring is a 2 px solid outline with 2 px offset on the bars, buttons and links I inspected; in light mode it is
  visible on the dark Test bar (screenshot a11y-5). Headings: one h1 per page, h2/h3 below. Landmarks: nav, banner,
  main, complementary with names.

## Not tested / blocked
- "Restore" in the Turned-off list (admin only; I am not an admin).
- Actually forcing the quiz popover error ("Not this week" refused) and a server-side event-form error; only the
  duplicate "Turn on" alert was triggered.
- My groups save feedback and Reminders (code-read only), the upload status live region (`EventUploads.tsx` has
  `aria-live="polite"`; I did not upload), the PDF/image preview content, SQL console, Designer, search.
- 200 % / 400 % zoom and reflow, Windows high-contrast / forced colours, `prefers-reduced-motion`, a real screen
  reader (I used the Playwright accessibility tree only).
- Native date/time picker behaviour (headless Chromium).

Screenshots (all in `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-25-ux/`):
`a11y-1.png` (advanced subject page after Turn on), `a11y-2.png` (error text, light), `a11y-3-dark.png` (error text, dark),
`a11y-4-dark-focus-turnoff.png` (focus on "Turn off", dark), `a11y-5-testbar-focus.png` (focus ring on a Test bar and
overlapping bars), `a11y-6-quiz-popover.png` (quiz popover), `a11y-7-eventform.png` (event form), `a11y-8-plan-dark.png`
(week 44 in dark mode), `a11y-9-panel-2tests-light.png` (session panel with two tests).
