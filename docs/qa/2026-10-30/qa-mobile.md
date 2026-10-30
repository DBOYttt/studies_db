# qa-mobile — Mobilna Marta — 2026-10-30

Summary: At 375x812 the simple mode is mostly usable. There is no page-level horizontal scroll, the week grid scrolls sideways inside its own box, and the forms stack cleanly. The weak spots are small tap targets in the top bar and on action buttons, the inline PDF preview (it sat on "Loading preview…" for about 40 s), and the week view, which does not scroll to today. The sandbox dev server was recompiling and fully reloading pages every few seconds the whole time (Next "Compiling" badge, repeated Fast Refresh). This caused flaky clicks, "Execution context was destroyed" errors and one `ERR_EMPTY_RESPONSE`. Findings that may be affected are marked as such.

## Findings

### F1 [medium] Top bar tap targets are far below 44 px (Sign out, Advanced, menu)
- Where: every page, top bar (`/s`, `/s/plan`, `/plan`)
- Steps: 1. Open any page at 375 px. 2. Measure the top bar with snapshot boxes.
- Expected: tap targets of about 44 px, with space between them.
- Actual: "Sign out" is 19x15 px, with a 1 px-wide icon button sitting next to the avatar. The "Advanced" link is 63x21. The menu button is 32x32. The back link is 28x28. "Simple" and "Advanced" sit together in a 27 px-tall pill. Sign out is easy to hit by accident next to the avatar.
- Evidence: `.qa/screens/2026-10-30/mobile-1.png`, `.qa/screens/2026-10-30/mobile-8.png`
- Suggestion: give the buttons at least a 44x44 hit area (padding or `min-h`/`min-w`), and put a gap between the avatar and Sign out.

### F2 [medium] Inline PDF preview stays on "Loading preview…" with no spinner or error for about 40 s
- Where: `/s?file=22` and `/s/subjects/SK?file=22`, preview panel
- Steps: 1. Open a PDF preview. 2. Wait.
- Expected: the PDF appears quickly, or a visible progress indicator or error shows up.
- Actual: plain text "Loading preview…" for about 40 s, three times. The viewer (page 1 / 1, 100 %, zoom buttons) appeared only once. Afterwards the page reloaded and the preview went back to "Loading preview…", so I could not test zoom in/out or page buttons. This may be caused by dev-mode compilation of the PdfViewer chunk (guess). The "Full screen" link (`/files/22/preview`) opened the native PDF viewer straight away and was fine.
- Evidence: `.qa/screens/2026-10-30/mobile-11.png`, `.qa/screens/2026-10-30/mobile-12.png`, `.qa/screens/2026-10-30/mobile-15.png` (loaded)
- Suggestion: show a spinner or skeleton, add a timeout with the existing "Could not load the PDF preview" message, and offer "Full screen" as a fallback.

### F3 [medium] The PDF viewer toolbar buttons are small
- Where: preview panel after loading
- Actual: the source (`apps/web/components/PdfViewer.tsx`) gives the buttons `h-7` (28 px), and the screenshot shows the page and zoom buttons at about 28 to 32 px.
- Evidence: `.qa/screens/2026-10-30/mobile-15.png`
- Suggestion: use `h-11` on small screens. This is also hard to use for pinch-zoom alternatives.

### F4 [medium] Week view opens on Monday, not on the current day
- Where: `/s/plan` (and `/plan`), week view
- Steps: 1. Open the timetable on Friday 30 Oct.
- Expected: today's column in view, or at least a visible scroll cue.
- Actual: about 2.5 columns (Mon, Tue, half of Wed) show, each 128 px wide. Today (Fri, x=577 to 705 in a 944 px grid) is off-screen. There is no hint that you can scroll sideways. Only a clipped "Wed" header suggests it. Upcoming events on Sat and Sun are hidden too.
- Evidence: `.qa/screens/2026-10-30/mobile-6.png`, `.qa/screens/2026-10-30/mobile-8.png` (after focusing a Friday block)
- Suggestion: scroll the grid to today's column on load, and add a fade or arrow on the right edge. A day-by-day view for phones would also help.

### F5 [low] Week blocks: overlapping blocks and the sticky time column hurt readability
- Where: week view
- Actual: where two items overlap (Tue 12:00 ASD Laboratorium Gr. 2 next to "Spotkanie z opiekunem roku"), the blocks get 57 px and 60 px width and the text is cut ("Laborato…", "Spot…"). Lecturer names are cut off with an ellipsis ("Katarzyna Lewando…"). The sticky hour labels have no background, so "09:00" prints over a block's text when scrolled sideways. The "Entry quiz" button inside a block is 24 px tall and overlaps the bottom of the block text. Tapping a block opens a full-screen sheet that shows the full details, so the data is reachable.
- Evidence: `.qa/screens/2026-10-30/mobile-6.png`, `.qa/screens/2026-10-30/mobile-8.png`, `.qa/screens/2026-10-30/mobile-7.png` (sheet)
- Suggestion: give the sticky time column a solid background, and stack overlapping blocks or show a "+1" chip on phones.

### F6 [low] Action buttons on the event page and prev/next are too small and too close
- Where: `/s/wydarzenia/12`, `/s/plan`
- Actual: Edit (72x32) and Delete (89x32) are 8 px apart. The delete confirmation ("Only this one", "This and following", "Cancel") is also about 32 px tall in a tight wrap. "Search" under Link posts is 28 px tall, and "Add files" is 32 px. On the timetable, Previous, Today and Next are 33 px tall, and the Week / My groups tabs are 31 px. The reminder checkboxes are about 13 px (the rows are about 38 px).
- Evidence: `.qa/screens/2026-10-30/mobile-23.png`, `.qa/screens/2026-10-30/mobile-24.png`, `.qa/screens/2026-10-30/mobile-26.png`
- Suggestion: raise the touch height to 44 px on small screens, and add distance between the destructive Delete and the other buttons.

### F7 [low] Breadcrumb is cut to a few characters on narrow screens
- Where: top bar on `/s/subjects/ASD` ("Algorytmy i s…"), `/s/wydarzenia/12` ("Konsultacje …"), and `/plan` (advanced, "studies_db » T")
- Actual: the breadcrumb gets only about 129 px next to the Simple/Advanced pill. In advanced mode the current page name is cut to "T". The full name is still shown in the page title.
- Evidence: `.qa/screens/2026-10-30/mobile-9.png`, `.qa/screens/2026-10-30/mobile-27.png`
- Suggestion: hide the mode pill on narrow screens (move it into the drawer), or give the breadcrumb more room.

### F8 [medium] Possible: the event form loses date and time after a server error (could not be confirmed)
- Where: `/s/wydarzenia/nowe`
- Steps: 1. Fill in the title, date 05/11/2026, start 14:00 and end 13:00. 2. Tap "Add event".
- Expected: the message "The end must be after the start." with all the values kept.
- Actual: the message appeared (red box under the Note field, so it is only visible after scrolling down; the screenshot shows it only because the page was already scrolled). The Title was kept, but Date, Starts and Ends were back to the empty placeholders. This suggests the React 19 form reset after the action (a guess). Later attempts were interrupted by page reloads, so I could not reproduce it cleanly.
- Evidence: `.qa/screens/2026-10-30/mobile-19.png`
- Suggestion: keep the submitted values (controlled inputs or return them from the action), and show the error near the top or the submit button, or focus it.

### F9 [low] Drawer: the first tap on the menu button sometimes did nothing
- Where: `/s`, "Open navigation panel"
- Actual: several first taps (while the dev server was recompiling) did not open the panel, and a second tap did. Following a link from the drawer (Timetable) did not navigate in one attempt (still on `/s` after 3 s). It is most likely caused by the dev reloads (guess), so I could not confirm it as a bug. When open, the drawer is 280 px wide, with rows of about 38 to 40 px and a visible backdrop strip. Closing worked.
- Evidence: `.qa/screens/2026-10-30/mobile-2.png` (closed after tap), `.qa/screens/2026-10-30/mobile-3.png` (open)
- Suggestion: retest on a production build.

### F10 [idea] Advanced mode on a phone
- Where: `/plan`, `/sql`
- Actual: works, nothing broken. The tab strip scrolls sideways and the active "SQL" tab is cut at the right edge ("S"), with no scroll hint. The fixed bottom "Console / Query history" bar permanently takes about 44 px. After "Go" on `/sql` the results appear below the fold and the page does not scroll to them (a green "Showing rows 0 – 5" bar is the only hint).
- Evidence: `.qa/screens/2026-10-30/mobile-27.png`, `.qa/screens/2026-10-30/mobile-29.png`, `.qa/screens/2026-10-30/mobile-30.png`
- Suggestion: scroll the active tab into view, and scroll to the results after a query.

## What worked well
- No horizontal scrolling of the whole page on any screen I opened. The wide week grid scrolls inside its own container.
- Start page, subject cards and the file list reflow into one column. Every Preview and Download button (32 px tall) is a separate target.
- Tapping a timetable block opens a readable sheet with a close button; "Add event" is at the top of the week view and always reachable.
- The event form is a single column with native date and time pickers. Required-field validation is shown right at the field ("Please fill in this field."). Date and time fill in correctly.
- The delete confirmation on the event page offers "Only this one", "This and following" and "Cancel". Cancel is available.
- The event page materials list, "Add files" and the limit text are clean. My groups and Reminders are readable.
- The advanced mode is not broken: timetable, tabs and SQL console work. The inline preview's "Full screen" link opens the PDF in the native viewer.

## Not tested / blocked
- PDF zoom in/out, page buttons and closing the preview from the loaded viewer: the page kept reloading (dev recompile), so the loaded state did not last. I only saw the close "X" (32x32) in the loading state.
- Actually saving an event and uploading files from the event page (the server dropped the connection once, and the form was reset by reloads).
- The Edit page (`/s/wydarzenia/12/edytuj`), the search results, and "Ready-made reports" and "Recently added" pages.
- Keyboard overlap (no real on-screen keyboard in headless mode).
- Screenshots of the full page do not capture content inside the scrolling `main` container (they show a blank area below the fold, for example `mobile-9-full.png`).
