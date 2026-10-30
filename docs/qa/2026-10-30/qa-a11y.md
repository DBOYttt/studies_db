# qa-a11y — Klawiaturowy Kuba — 2026-10-30

Summary: The simple UI is in good shape for keyboard and screen-reader use. It has a working skip link, sensible landmarks and headings, named controls, a visible focus ring, polite status messages ("Group saved."), and dark mode passes the contrast check. I found no task that cannot be done by keyboard. The gaps are smaller: focus is lost after cancelling the delete confirmation, the page title is the same on every page, form errors are not tied to their field, and a few muted texts sit just under 4.5:1.

Test note: the sandbox runs `next dev`. It often reloaded the page by itself in the middle of key sequences (Fast Refresh and "Loading <url>" titles), so I repeated those tests until I got a clean run with a marker in `window` to prove there was no reload. I treat these reloads as sandbox noise, not as app findings. Where a result was ambiguous because of a reload, I did not report it.

## Findings

### F1 [medium] After "Cancel" in the delete confirmation, focus drops to `<body>`
- Where: `/s/wydarzenia/12` (event page, Delete button)
- Steps: 1. Tab to **Delete** and press Enter. The group "Delete this event?" appears and Delete has `aria-expanded=true`. 2. Tab to "Only this one", "This and following", "Cancel". 3. Press Enter on **Cancel**.
- Expected: Focus returns to **Delete**. It is a disclosure that collapses.
- Actual: The confirmation closes but `document.activeElement` is `BODY`. I confirmed it with a `window.__mk` marker, so there was no reload. A keyboard user has to Tab from the top of the page again (WCAG 2.4.3 Focus Order, 3.2.2).
- Evidence: `activeElement` = `BODY`, `__mk` = 1, Delete `aria-expanded="false"`.
- Suggestion: On Cancel, call `deleteButton.focus()`.

### F2 [medium] Every page has the same `<title>`
- Where: all pages (`app/layout.tsx` has `metadata = { title: 'Studies DB | TP 4.0' }`)
- Steps: Open `/s`, `/s/plan`, `/s/subjects/ASD`, `/s/wydarzenia/nowe`, `/s/wydarzenia/12`, `/plan`, `/subjects/ASD`.
- Expected: A distinct title per page, for example "Timetable – Studies DB", "Algorytmy i struktury danych – Studies DB".
- Actual: Always "Studies DB | TP 4.0". Screen-reader users and browser tab/history users cannot tell pages apart, and a soft navigation announces nothing new (WCAG 2.4.2 Page Titled).
- Suggestion: Add `generateMetadata` or `title.template` and per-page titles.

### F3 [medium] Form error is a general alert, not tied to the field, and focus does not move to it
- Where: `/s/wydarzenia/nowe` (and the edit form)
- Steps: 1. In Title type only two spaces. 2. Set the date 11/05/2026 using the keyboard. 3. Press Enter to submit.
- Expected: Focus goes to the error or to the field. The field has `aria-invalid="true"` and `aria-describedby` pointing to the message.
- Actual: A `role="alert"` div below the form says "The title must be 1 to 100 characters." It is announced. But Title has no `aria-invalid` and no `aria-describedby`, and focus stays on the Date field. The message names the field only in words (WCAG 3.3.1, 1.3.1, 3.3.3). The submit button does point to the message (`aria-describedby=event-form-error`).
- Evidence: `.qa/screens/2026-10-30/a11y-3.png`. DOM: title `aria-invalid=null`, `aria-describedby=null`.
- Suggestion: For field-specific errors set `aria-invalid` and `aria-describedby` on the field, and focus the first invalid field. Browser validation for empty required fields is fine: Enter on an empty form focused Title with "Please fill in this field."

### F4 [low] Muted text just under 4.5:1 in light mode (file counts, tree counts)
- Where: sidebar subject file counts on `/s` and `/s/plan` (12 px); tree counts in the advanced sidebar on `/plan` (11 px)
- Steps: Compute contrast (read-only).
- Expected: At least 4.5:1 (WCAG 1.4.3).
- Actual: rgb(113,113,122) on rgb(244,244,245) is 4.40:1 (6 elements on `/s`, 23 on `/plan`). Dark mode on `/s`, `/s/plan` and `/plan`: 0 failures.
- Suggestion: Darken the muted text token a little (for example zinc-600, rgb(82,82,91)) or lighten the badge background.

### F5 [low] Escape does not close the delete confirmation
- Where: `/s/wydarzenia/12`
- Steps: Open the delete confirmation, press Escape.
- Expected: It closes, as the preview panel and the session panel do (they close on Escape and return focus).
- Actual: Nothing happens and focus stays on "Only this one". The Cancel button still works, so this is not a blocker.
- Suggestion: Handle Escape, and send focus back to Delete (see F1).

### F6 [low] Ambiguous, duplicate link names in lists
- Where: Start and subject pages (`/s`, `/s/subjects/ASD`), advanced table `/subjects/ASD`
- Actual: (a) In the simple file lists the filename link and the "Preview file X" link have the same href, so there are two tab stops per file. (b) In the advanced table every row has links named only "Preview" and "Download" (no `aria-label`; the simple UI does give "Preview file X"). (c) On the plan, the "Entry quiz" button is named only "Entry quiz" and does not say which class (WCAG 2.4.4, 2.4.6). (d) The advanced table has no caption or `aria-label`. (e) Advanced sidebar tree has duplicate toggles ("Collapse: Subjects" and "Subjects 6" both with `aria-expanded`), and "Sign out" appears twice (sidebar and top bar).
- Suggestion: Add row context to the names (`aria-label="Preview <filename>"`), name the quiz button after its class, and give the table an accessible name.

### F7 [low] Subject names in the simple sidebar have no `lang="pl"`
- Where: the sidebar "Subjects" navigation in the simple UI (`<span class="min-w-0 flex-1 leading-snug">Algorytmy i struktury danych</span>`)
- Actual: Cards, file names and headings carry `lang="pl"`; the sidebar subject names do not. A screen reader will read Polish names with an English voice (WCAG 3.1.2).
- Suggestion: Add `lang="pl"` to the sidebar labels, as already done elsewhere.

### F8 [idea] The preview panel is not a modal on small screens
- Where: the file preview and session panels (`aside` with `fixed inset-0` below `lg`)
- Actual (code reading plus DOM, not tested in a narrow viewport): below `lg` the panel covers the page, but the background links stay in the tab order and there is no `aria-modal` or `inert`. A keyboard user can Tab to content hidden behind the panel (WCAG 2.4.11 Focus Not Obscured). I did not test it at a narrow width.
- Suggestion: Make the page behind `inert` while the panel is full-screen, or tab-trap the panel and restore focus on close (it already does).

## What worked well
- Skip link exists, becomes visible on focus (outline 2px rgb(35,90,129)), and moves focus to `main#content` (tabindex -1). The Tab order is: skip link, logo, search, menu, subjects, top bar, main. This is logical.
- Landmarks: complementary "Navigation panel", navigation "Menu"/"Subjects"/"Breadcrumb"/"View mode"/"Weeks"/"Timetable view", banner, main. Headings: one h1 per page, then h2 and h3 for sections (for example the entry quiz groups).
- Current state is exposed: `aria-current` on the menu, the filter chips ("All"), the view toggle and the Timetable tabs.
- Timetable grid: each day is a `group "Fri 30 Oct (today)"`, each class a button whose name says date, time, subject, class type, room and lecturer. Events are links with the type in text ("Test: Kolokwium 1"). "Today" is shown by the text "(today)" and not only by colour. Class types, events and entry quiz are in a "Class types" list, so colour is not the only cue.
- File preview and session panels: opening moves focus to the panel heading, Escape closes, and focus goes back to the opener. I confirmed this for the file preview (back to "Preview file …") and the session panel (back to the block). Close buttons are named "Close preview" and "Close details". PDF controls are labelled (Previous page, Next page, Zoom out/in).
- My groups: each select has a Polish-content name ("Algorytmy i struktury danych · Laboratorium"). Picking a group saves at once and `role="status"` says "Group saved.". The filter summary on the plan says how many classes are hidden.
- Event form: labels on all fields. Title and Date are `required`, the form has a "Fields marked * are required." note, and native validation focuses the first invalid field. The time-all-day hint is linked with `aria-describedby`. The file upload input is `sr-only` inside a label with `focus-within` outline, and there are `role="status"` regions for upload and link-search status.
- Dark mode: 0 contrast failures on `/s`, `/s/plan` and advanced `/plan` (screenshots `.qa/screens/2026-10-30/a11y-4.png`, `a11y-5.png`). Light mode: only F4.
- Advanced table: `aria-sort` on the sorted column, "Select row N" checkboxes, and `lang="pl"` on Polish content.

## Not tested / blocked
- Real file upload and the upload status announcements: a headless file chooser can't be driven with the keyboard here.
- PDF preview contents: the preview stayed at "Loading preview…" for ~25 s while the dev server was busy, so I checked the controls by reading `PdfViewer.tsx` and the screenshot `.qa/screens/2026-10-30/a11y-1.png` only. Whether the PDF has a text layer for a screen reader is unknown.
- Narrow viewport, zoom and reflow (1.4.10, 1.4.4) and Windows high-contrast mode.
- Advanced mode: only the Timetable, subject page and sidebar tree were read. SQL console, Search, Designer and Data map were not exercised. Admin pages are out of scope.
- Keyboard use of the advanced tree toggles and the table row actions.
- "Entry quiz" on/off on the subject page (status text only seen in the DOM, not exercised).
- Side effect: my persona now has one group picked in My groups (the last Systemy operacyjne lab select). This filters the advanced plan for this persona ("13 classes hidden").

Screenshots: `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-30/a11y-1.png` to `a11y-6.png`.
