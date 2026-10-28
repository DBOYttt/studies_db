# qa-mobile — Mobilna Marta — 2026-10-25-ux

Summary: At 375x812 the simple UI mostly holds up. The drawer, the full-screen session panel and file preview panel, the native date/time inputs and the subject-page Entry quiz section all work and read well. The week grid scrolls sideways inside its own container. The main problems are in the new Test / Entry quiz footer bars: in narrow (overlapping) blocks they are clipped or cover the class text, and the bars and several controls are well under 44 px. Also, the current week (W43) makes the whole page scroll sideways (document width 714 px).

Screenshots are in `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-25-ux/` (file names `mobile-N.png`). The dev server was slow while other personas were active and showed Fast Refresh rebuilds, so some waits were long. I treated that as noise unless noted.

## Findings

### F1 [medium] Current week makes the whole page scroll sideways (document 714 px wide)
- Where: `/s/plan` (and `/s/plan?week=2026-W43`, the week that contains today, Sun 25 Oct). The advanced `/plan` has not been tested for it.
- Steps: 1. Open Timetable on a 375 px viewport in the current week. 2. Take a full-page screenshot or try to drag the page sideways.
- Expected: only the grid scrolls inside its box, as in W44 and W45.
- Actual: the full-page screenshot is 714x812 (the other weeks and other pages are 375x812). The header and content occupy only the left 375 px and the rest is blank.
- Evidence: `mobile-24.png`, `mobile-25.png`, `mobile-28.png` (714 wide) against `mobile-27.png`, `mobile-29.png` (375 wide).
- Guess at cause: in the W43 snapshot the visually hidden "(today)" text sits at x=713 (box 713,296,1x1). An absolutely positioned sr-only element inside the clipped scroller may escape the clipping, so the scroll width grows to 714. W43 is the only week with a today marker.
- Suggestion: make the grid container `relative` (or `overflow: clip` plus `position: relative`) so the sr-only text cannot widen the page.

### F2 [medium] Two footer bars (Test and Entry quiz) cover the text of a narrow class block and block taps on it
- Where: `/s/plan?week=2026-W44`, Tue 27 Oct, ASD Laboratorium Gr. 1 10:00. An event (Kolokwium 1) sits next to it, so the block is only 57 px wide. The advanced `/plan` looks the same.
- Steps: 1. Turn on an Entry quiz for ASD Laboratorium Gr. 1 (subject page). 2. Add a Test on that session ("+ Test" in the session panel). 3. Look at the block.
- Expected: the title, room and lecturer stay readable. The block opens its panel when tapped.
- Actual: the two stacked 24 px bars fill the lower part of the 82 px block. The "ASD / Laboratorium Gr. 1 / room" text is struck through by the dashed Entry quiz bar and is unreadable. The bar label "ENTRY QUIZ" and the arrow are wider than the block, so the arrow is cut off and the note never shows. The "TEST" bar is cut at the right edge too. Playwright could not tap the block because the bar subtree intercepts the click, so the block can only be opened by its small visible top strip.
- Evidence: `mobile-22.png`, `mobile-19.png` (Test alone, narrow, cropped), `mobile-8.png`, and `mobile-39.png` (advanced).
- Suggestion: at narrow widths show the bar as an icon or a short badge with no label. Or increase the block height, or cap the stack at one bar plus "+1". Do not let the bars hide the subject code and class text.

### F3 [low] Footer bars are about 24 px high, with 11 px text
- Where: week grid, Test links (`/s/wydarzenia/N`) and Entry quiz buttons (Tailwind `h-6`, `text-[11px]`).
- Actual: the bars measure 114x24 in a normal block and 51x24 in a narrow one. They sit directly under the block's own tap area, and the Test bar and Entry quiz bar are 2 px apart when stacked.
- Evidence: `mobile-10.png`, `mobile-18.png`; sizes from the snapshots.
- Suggestion: this is hard to fix inside a 82 px block. Make the whole block's panel list the quiz and the test (the panel already does) and keep the bar mainly as an indicator. Or use at least 32 px bars in a taller block.

### F4 [low] The Test footer bar label is cut off to the point of being unhelpful
- Where: week grid, Mon 26 Oct (ASD and BD lectures).
- Actual: the bars read "TEST  Kolokwi…" and "TEST  Test z b…". The full title is only in the title attribute, which does not exist on a phone. The link goes to the event page.
- Evidence: `mobile-10.png`.
- Suggestion: acceptable as it is. An idea is to show only "TEST" and the time or the subject, since the title is mostly cut anyway.

### F5 [low] Many tap targets are below 44 px
- Where, with measured size (width x height):
  - top bar: menu button 32x32, the Simple/Advanced toggle about 28x16 per option, Sign out icon 19x15 (`mobile-1.png`).
  - session panel: close "x" 26x26, "Not this week", "Edit", "+ Test", "Subject" about 33 high (`mobile-11.png`, `mobile-20.png`).
  - Entry quiz popover: close 24x24, buttons 28 high (`mobile-9.png`).
  - subject page: filter pills 32 high, Preview/Download 32 high, "Turn on" / "Turn off" / "Save note" 32 high, "Undo" on a skipped date is a small text link (`mobile-21.png`).
  - file preview: zoom out/in 25x30 and 26x30, Previous/Next 30 high.
  - My groups: selects 28 high, reminder checkboxes 13x13 (the row is 38 high) (`mobile-30.png`).
  - event page: Edit/Delete 32 high, 8 px apart; the confirm row "Yes, delete" sits next to "Cancel" (`mobile-17.png`).
  - "Yes, delete" and "Delete" are in the same place, so a double tap can confirm by accident (guess, not tried).
- Suggestion: on small screens use `min-h-11` for buttons and links, and make the whole checkbox row the label target (it may already be one). The Sign out and Advanced controls are the smallest and should grow first.

### F6 [low] The preview panel on a phone keeps "Loading preview…" for a long time, and the close link reacted only after about 20 s
- Where: `/s/subjects/ASD?file=2` (PDF).
- Actual: the first load showed "Loading preview…" for more than 5 s (`mobile-31.png`, `mobile-32.png`). A reload later rendered the PDF with paging and zoom (`mobile-34.png`, `mobile-35.png`). After tapping "Close preview" the panel stayed on screen with the dev "Rendering…" badge for about 20 s before the URL changed and the panel went away (`mobile-36.png`, `mobile-37.png`). The Advanced link behind it was unreachable meanwhile.
- Note: probably the loaded dev server, so this may not happen in production. The panel itself has no instant feedback, though.
- Suggestion: hide the panel immediately on tap (optimistic close) and show a skeleton while loading.

### F7 [low] PDF toolbar wraps: "+" falls onto its own line
- Where: file preview, 375 px (`mobile-34.png`, `mobile-35.png`).
- Actual: "Zoom in" (+) sits alone under the "Previous | Page 1/1 | Next | - 100%" row. The separator "|" is stray.
- Suggestion: let the zoom group stay together (`flex-nowrap`, or put zoom on its own row with the page buttons).

### F8 [low] "Full screen" opens the raw PDF with no way back inside the app
- Where: file preview "Full screen" -> `/files/2/preview` (`mobile-33.png`).
- Actual: the browser's own PDF viewer fills the screen (download, print, menu). There is no link back to the subject page.
- Expected: acceptable for a raw file route, but a phone user has to use the browser Back button.
- Suggestion: idea only. Open it in a new tab or keep the pdf.js viewer inside the app panel.

### F9 [low] The event form drops the chosen session after a server error
- Where: `/s/wydarzenia/nowe?kind=kolokwium&subject=1&class=2&group=1&session=9`.
- Steps: 1. Open the form from "+ Test" in the session panel (session preselected, `mobile-12.png`). 2. Fill a title and set "To" before "From". 3. Press Add event.
- Expected: the error "The end must be after the start." appears and the form keeps its values.
- Actual: the error is shown just above the submit button, so it is visible without scrolling (`mobile-14.png`). But "Pick a session" is reset to "Choose a session". Submitting without re-picking could create a Test that is not attached to the session (I picked it again, so I did not test that outcome).
- Suggestion: keep the session field in the state kept after an error.

### F10 [low] Native validation scrolls the empty field under the sticky header
- Where: event form, empty Title (`mobile-13.png`).
- Actual: the browser bubble "Please fill in this field." works, and the field is visible, but its label is hidden under the 48 px top bar.
- Suggestion: `scroll-margin-top: 64px` on inputs.

### F11 [low] Delete confirmation changes the layout
- Where: event page (`mobile-16.png`, `mobile-17.png`).
- Actual: pressing Delete turns the button into "Delete this event? Yes, delete / Cancel". "Cancel" wraps to a second line and the Materials block moves down by about 40 px.
- Suggestion: reserve the row height, or put the confirmation on its own line from the start.

### F12 [idea] The event page does not say which class session a Test belongs to
- Where: `/s/wydarzenia/12` (a Test attached to ASD Laboratorium Gr. 1, Tue 27 Oct).
- Actual: it shows When, Subject, Place, Added by. The class and group are not shown (`mobile-15.png`).
- Suggestion: add "Class: Laboratorium Gr. 1" so the student can check the Test is on the right session.

### F13 [idea] The first link on an event page is "+ Add event"
- Where: `/s/wydarzenia/12` (`mobile-15.png`).
- Actual: there is no "back to Timetable" link above the title (the breadcrumb has one, truncated to "Kolokw…"), and the most prominent link is for adding another event.
- Suggestion: only the breadcrumb leads back. Consider a visible "Back" link.

### F14 [low] Breadcrumb truncates the current page ("Add e…", "Kolokw…")
- Where: event form and event page; the drawer button and the 127 px right group take the space (`mobile-12.png`, `mobile-15.png`).
- Suggestion: on mobile show only the last crumb, or drop "Start".

### F15 [low] Entry quiz popover and note text
- Where: the popover (`mobile-9.png`) fits the screen and its two buttons are readable. The footer bar in the block only shows the note as far as the width allows ("B ›"), so the note is only visible after opening the popover (`mobile-40.png`).
- Suggestion: none. A short note that "tap for note" would help is optional.

### F16 [low] Dev-only: hydration mismatch error on the timetable after saving My groups
- Where: `/s/plan` after pressing Save in My groups. The console shows "A tree hydrated but some attributes of the server rendered HTML didn't match" (1 error, the Next dev issue badge shows "1 Issue", `mobile-24.png`).
- Not reproduced afterwards (I did not look for the cause). Reported because the page was in the filtered state.
- Suggestion: check the filter banner, which has a date or locale dependent text (guess).

### F17 [low] `favicon.ico` returns 404
- Where: any page, console on first load.

## What worked well
- Drawer: opens from the 32 px menu button, closes with Escape and returns focus to the button. Its 38 px rows follow a link to the right page (`mobile-2.png`). The drawer has no visible close button; a tap on the dimmed backdrop was not tried.
- Breadcrumbs fit one line and the link targets work (Start > Timetable > Add event).
- Week grid scrolls sideways inside its own box with the time gutter and day header kept in place (`mobile-18.png`). Blocks are readable at 120 px width. The all-day strip fits (`mobile-40.png`; its title "Wyjazd integrac..." is cut).
- "+ Add event" is reachable above the grid (105x31).
- Session panel and the Entry quiz popover both have a Close control, and the panel fills the screen with readable rows (`mobile-11.png`).
- Subject-page Entry quiz section: clear "On / Off", note, group selector, skipped dates with Undo (`mobile-7.png`, `mobile-21.png`). All fields are full width and nothing overflows.
- Event form uses native date and time inputs (`mobile-12.png`). Errors appear next to the button without scrolling (`mobile-14.png`). The submit button was reachable.
- File preview: paging, zoom (100% to 150% worked), Download and Full screen buttons are large (`mobile-35.png`).
- My groups and Reminders fit one column; the reminder checkbox toggled (and was reset by me) (`mobile-30.png`).
- Advanced mode on the subject and the timetable: usable. The tab row is scrollable ("SQL" is cut at the edge), the result table scrolls inside its own box, and the Console bar is a fixed bottom bar that covers the last 36 px of content (`mobile-38.png`, `mobile-39.png`).

## Not tested / blocked
- Real touch gestures (pinch zoom, long press), the on-screen keyboard and `visualViewport` behaviour: the headless browser has no keyboard. "Inputs hidden behind the keyboard" is therefore not tested.
- Tapping the dimmed drawer backdrop to close it.
- "Not this week" from the popover (another persona had already skipped Tue 27 Oct; I only undid it from the subject page) and "Edit" of an entry quiz note.
- Uploading files ("Add files" with a file) and the edit form; "Add files" with no files showed no visible message in my check (not conclusive).
- Deleting an event (I only opened the confirmation and cancelled).
- The advanced pages other than the subject page and the timetable (`/sql`, `/admin`).
- Data from other personas appeared on screen (Test bars on Mon 26 Oct, an Entry quiz skip on Tue 27 Oct, an Entry quiz on AM2) and I treated it as normal.
- I left behind: an Entry quiz on ASD Laboratorium Gr. 1 (note "Bring laptop, 5 questions on heaps"), a Test "Kolokwium z kopców (mobile)" (event 12), and I undid the skip on Tue 27 Oct. My groups and the 24 h reminder were reset.
