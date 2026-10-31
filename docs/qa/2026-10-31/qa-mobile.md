# qa-mobile — Mobilna Marta — 2026-10-31

Summary: The new phone semester row works in both modes. It does not overflow, does not cover content, filters correctly, and the empty-state line appears as specified. The main weaknesses are tap targets under 44 px (the select is only 40 px wide, plus many secondary controls) and one mode-switch glitch with `?sem=`. The dev server was very slow and hot-reloading throughout, which cost some retries (see F7).
Screenshots: `.qa/screens/2026-10-31/mobile-<n>.png`. Viewport 375x812 for the whole session.

## Findings
### F1 [low] Semester select tap target is 40 px wide
- Where: every page with the phone row (e.g. /s, /s/plan, advanced /)
- Steps: 1. Open any page at 375 px. 2. Measure the combobox "Semester".
- Expected: at least 44x44 px.
- Actual: the select box is 40x44 and the row is 45 px tall, so only the width is short. The "Semester" label is not tappable. The label at 12 px from the edge is fine.
- Evidence: mobile-1.png, mobile-6.png
- Suggestion: add `min-w-11` or `px-2` to the select, and make the label focus the select (it already has htmlFor).

### F2 [low] "Show all semesters" link in the empty state is about 18 px tall
- Where: /s?sem=2 (simple) and /?sem=2 (advanced)
- Actual: the line "Showing semester 2 only. Show all semesters" renders correctly, but the link box is 125x18. Next to it in the simple Start page the line sits at the bottom of a collapsed Subjects list.
- Evidence: mobile-10.png (simple), mobile-14.png (advanced, shown as a yellow banner above the result)
- Suggestion: give the link `max-sm:inline-block max-sm:min-h-11 max-sm:leading-[44px]` or make the line a block with padding.

### F3 [medium] Mode switch drops a one-off `?sem=` and applies the cookie instead
- Where: /s?sem=2 then top bar "Advanced"
- Steps: 1. Choose semester 5 with the select (cookie). 2. Open /s?sem=2 (switcher shows 2). 3. Tap "Advanced".
- Expected: advanced Subjects still filtered to 2 (CLAUDE.md says modeTarget keeps `sem`).
- Actual: landed on `/` with the switcher showing 5 and the SQL `WHERE s.semester = 5`. The link href was `/mode?to=advanced&next=%2Fs%3Fsem%3D2`, so `sem` was dropped on the way.
- Evidence: mobile-12.png (before), mobile-13.png (after)
- Suggestion: check that the mode redirect passes `sem` through (or sets the cookie); a test for `?sem=` in `/mode`.

### F4 [medium] Preview close button is 32x32; many controls are under 44 px
- Where and measured sizes (simple unless noted):
  - File preview "Close preview" link 32x32 (mobile-18.png). Download button 39 px tall.
  - Preview / Download buttons in file lists 32 px tall (mobile-17.png, Start "Recently added").
  - Start card links "Timetable", "See all events", "+ Add event" 21 px tall (mobile-1.png).
  - Subject filter chips (Class / Type) about 32 px.
  - Event form: all inputs 32 px, "Add event" button 33 px, "Cancel" link 21 px (mobile-20.png). "Add files" on the event page 32 px.
  - My groups: group selects 28 px, Save 31 px, Clear 33 px, Preview 33 px, checkboxes 13 px with a 38 px row (mobile-30.png).
  - Navigation drawer links 38 px (mobile-15.png).
  - Advanced mode: pagination buttons, "Select all", "Print", "Export CSV" are 16-26 px (mobile-13.png).
- Expected: about 44 px, with space between neighbours.
- Suggestion: extend the existing `max-sm:min-h-11` rule to these; at least the preview close button, form submit and Cancel.

### F5 [low] Drawer has no visible close button
- Where: navigation drawer (mobile-15.png)
- Actual: the drawer covers 280 px with a dimmed backdrop. Escape closes it; the backdrop is the only touch way. The hamburger is hidden behind the drawer (the top bar is dimmed, not reachable except via the backdrop).
- Suggestion: an "X" in the drawer header, 44 px.

### F6 [idea] Filter leaves unrelated blocks visible, which looks inconsistent on phones
- Where: /s?sem=2 and /s with semester 5
- Actual: "Today / Next class" (shows ASD, semester 1), "Recently added" (files from semester 1) stay unfiltered next to "Showing semester 2 only". This matches the documented design but reads as a bug on the phone, where the select says 2 right above.
- Evidence: mobile-6.png, mobile-10.png
- Suggestion: a small "all semesters" hint on those cards, or filter them.

### F7 [medium] Submitting the event form before hydration wipes it silently
- Where: /s/wydarzenia/nowe
- Steps: 1. Open the form right after a fresh load (the dev server was compiling). 2. Fill title, date, start 12:00, end 10:00. 3. Tap "Add event".
- Expected: inline error "The end must be after the start.".
- Actual: twice the page reloaded with an empty form and no message (URL unchanged). After a 8 s wait the same input showed the correct inline error under "Ends", focused and visible without scrolling (mobile-27.png). The first two attempts may have been dev Fast Refresh full reloads (the console log showed repeated "Fast Refresh rebuilding"); I could not tell the difference. Guess: the form posts natively before React hydrates.
- Evidence: mobile-22.png, mobile-26.png (empty form after submit), mobile-27.png (working case)
- Suggestion: check whether the no-JS fallback keeps the typed values and shows the error.

### F8 [low] Advanced Subjects header says "Showing rows 0 – 0 (1 total)"
- Where: / with semester 5 (mobile-13.png)
- Actual: one row is shown, but the banner says rows 0 – 0. (The phpMyAdmin style is 0-based, but a student reads it as zero rows.)

### F9 [low] First semester change can take over 20 s with no feedback
- Where: select on /s (cold dev server)
- Actual: the first select change did nothing visible for more than 30 s, and the select went back to "All" after a re-navigation (the `/semester` route was compiling). Afterwards it worked in about 2 s. Probably a dev-only effect, but the select gives no busy state.
- Suggestion: disable the select or show a spinner while `window.location.assign` is pending.

## What worked well
- Phone row: 45 px tall, below the 48 px top bar, in both shells; no horizontal page scroll; nothing covered. The "Semester" label and the select fit in one line. Options are All, 1, 3, 5, 7 (only semesters with subjects).
- The filter applies on the Start subject cards, upcoming events, the timetable (semester 5 showed only UM, semester 7 an empty week), and advanced Subjects with the SQL showing `WHERE s.semester = N`.
- Empty state "Showing semester 2 only. Show all semesters" in simple (mobile-10.png) and advanced (mobile-14.png, with the "empty result" banner).
- Week timetable: scrolls sideways inside its own container, blocks readable (mobile-8.png), "+ Add event" reachable next to the paging buttons.
- PDF preview: full-screen sheet, 44 px zoom and page buttons, zoom to 150% works (mobile-18.png, mobile-19.png).
- Event form: native date and time pickers, inline error under the field (mobile-27.png), event page Edit/Delete are 44 px, delete asks for confirmation without a layout jump (mobile-29.png).
- Top bar controls (hamburger, back, mode links, sign out) are 44 px.

## Not tested / blocked
- Advanced mode beyond Subjects (timetable, SQL, search, designer); advanced event pages.
- "Add files" upload, event edit form, Search page.
- The sideways scroll of the advanced tab bar and the bottom "Console" bar overlapping content (seen only on Subjects, no overlap there).
- Closing the PDF preview with "Close preview": clicked, but I did not capture the result. I did not test the on-screen keyboard (a headless browser has none).
- The dev server hot-reloaded repeatedly, so behaviour after a reload may differ from production.
