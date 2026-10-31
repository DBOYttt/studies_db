# qa-a11y — Klawiaturowy Kuba — 2026-10-31

Summary: The basics are in good shape. There is a working skip link, which moves focus to `main`. Landmarks and headings make sense, controls have names, and focus is visible (2px outline). Contrast in light and dark mode is fine (the only sub-4.5 text is an aria-hidden separator). Event form errors are tied to their field. The file preview and the event "Event saved." status behave well. The new semester switcher is usable by keyboard, but it announces the change poorly. The mobile select navigates on every change. The Timetable feeds card is admin-only, so I reviewed its source only.
Reliability caveat: the sandbox dev server kept recompiling ("Compiling…") and the page reloaded by itself in the middle of my Tab sequences (`performance.getEntriesByType('navigation')` type `reload`). Long Tab chains were therefore unreliable. This is an environment issue, not an app finding. Keyboard stops were checked in short runs and by DOM order.

## Findings
### F1 [medium] Changing the semester gives no announcement and resets focus
- Where: top bar Semester nav, e.g. `/s`, `/plan`.
- Steps: 1. Tab to link "3" (17 Tab stops from page load on `/s`, past the whole sidebar). 2. Press Enter.
- Expected: the new choice is announced, or focus stays near the switcher. WCAG 4.1.3 Status Messages, 3.2.2.
- Actual: `/semester?to=3` is a full navigation. `activeElement` is `BODY` afterwards. The page title is unchanged ("Start · Studies DB") and there are no live regions. A screen-reader user only learns the filter is on from `aria-current` on "3" if they tab back to it. Nothing in the page content says "Semester 3" (the sidebar silently shows 1 subject instead of 9).
- Evidence: `.qa/screens/2026-10-31/a11y-1.png` (switcher), DOM check after the switch.
- Suggestion: put the semester in the page title or in a visible, announced "Semester 3 · showing 1 subject" line near the H1. Alternatively focus `main` or the switcher after the redirect.

### F2 [medium] Mobile semester select navigates on every change (guess for some browsers)
- Where: `SemesterSwitcher.tsx` `PhoneRow` (`<select id="semester-select">`). It is `display:none` at desktop width, so I read the source and the DOM rather than using it.
- Expected: WCAG 3.2.2 On Input. A change of a select must not move the user without a submit.
- Actual: `onChange` calls `window.location.assign(...)`. In browsers where Arrow keys on a closed select fire `change` (Firefox and Chrome on Windows, as I recall), a keyboard or screen-reader user stepping through "All, 1, 3, 5, 7" is thrown to a new page on the first arrow press. The Go button exists only in `<noscript>`.
- Suggestion: add a visible "Apply" button (or navigate on blur/Enter only).

### F3 [low] Semester links have bare digit names
- Where: `nav[aria-label=Semester]`.
- Actual: links are announced as "1", "3", "5", "7" and the current one as "All, current page" inside a nav named "Semester". Out of the list context ("link, 3") this is ambiguous. The visible "Semester" label is `sr-only` at `lg` and below, which is fine.
- Suggestion: `aria-label="Semester 3"` (and "All semesters"). Keep the visible text, since it is contained in the name (2.5.3). Also, `aria-current="page"` on a non-link `<span>` is acceptable, but `aria-current="true"` fits better because it is not a page.

### F4 [low] Semester switcher is 17+ Tab stops from the top, and there is only one skip link
- Where: all pages. The sidebar (search, 4 menu links, 9 subject links) comes before the header in DOM order.
- Actual: "Skip to content" jumps to `main` (works; `#content` has `tabindex=-1`, focus lands on `<main>`). There is no way to reach the top-bar controls (semester, mode, sign out) without passing the sidebar. WCAG 2.4.1 is satisfied by the skip link, so this is an idea.
- Suggestion: a second skip link ("Skip to navigation tools") or put the header before the sidebar in DOM order.

### F5 [low] Feeds card (source review only): "Edit" button name does not contain its visible text
- Where: `/admin/sync`, `components/admin/FeedsCard.tsx`. I got 404 as a non-admin, as expected, so this is not browser-verified.
- Actual: the button's visible text is "Set" / "Edit" / "Close", but `aria-label="Edit semester N feed"` is constant. For "Set" and "Close", the accessible name does not contain the visible label (WCAG 2.5.3 Label in Name, for voice-control users), and "Edit …" is wrong while it is open. `aria-expanded` and `aria-controls` are right.
- Suggestion: `Set semester N feed` / `Close semester N feed`, derived from the same text.
- Other things I saw in the source, not verified in a browser (guesses): the semester number is a `<td>`, not a `<th scope=row>` (1.3.1); I can't tell whether focus moves to the first field when the edit row opens; the form uses `Field` and `fieldAria` (`aria-invalid` and `aria-describedby`), which behaves well in the event form; the inputs are `type=url` with visible labels, and the hint "Leave empty to keep the current link" is only a placeholder (placeholders disappear when typing, 3.3.2).

### F6 [low] The file preview panel does not close on Escape
- Where: `/s/subjects/ASD?file=7`.
- Actual: Escape does nothing. It is not a modal, so this is not required. Opening moves focus to the "File preview" H2. "Close preview" returns focus to the "Preview file …" link that opened it (observed, good).
- Suggestion: Escape closes the panel (idea).

### F7 [low] Redundant tab stops in file rows, and one inconsistent name
- Where: file lists (`/s`, subject page). The file-name link and "Preview file …" go to the same URL, so each row has three stops (name, Preview, Download). The "Entry quiz" badge button on the plan is named "Entry quiz" but its visible text is "Quiz" (2.5.3 is satisfied, since the name contains the text).
- Suggestion: make the file name link the Preview link, or give the name link `tabindex=-1`.

### F8 [idea] Timetable day columns are not headings, and today has no programmatic marker
- Where: `/s/plan` and `/plan` week grid.
- Actual: each day is a `group "Mon 26 Oct"` containing buttons with full names ("Mon 26 Oct, 08:00–09:30 ASD Wykład A-1 101 Jan Kowalski"), so the grid can be understood without sight (good). The column headers are plain divs and there is no `aria-current="date"` anywhere in the grid. Today (Sat 31 Oct) was not rendered in the week at all because the day is empty, so I could not check how "today" is shown. The event type is shown as an icon plus text ("Extra class:", "Test:"), not colour alone (good).
- Suggestion: mark today with `aria-current="date"` and visible text such as "Today".

### F9 [idea] Delete on the event page uses a native confirmation (not verified)
- Where: `/s/wydarzenia/33`. Pressing Enter on "Delete" produced no in-page dialog (the event stayed). I assume a native `confirm()` that the test browser auto-dismissed, so I did not exercise that path. A native confirm is accessible, but it could not be verified here.

## What worked well
- Skip link: first Tab stop, visible on focus, focuses `main#content`.
- Landmarks: `aside "Navigation panel"`, `nav "Menu"/"Subjects"/"Breadcrumb"/"Semester"/"View mode"`, `header`, `main`. One H1 per page, then H2 sections. No unnamed controls, no positive tabindex.
- Focus outline: 2px solid `rgb(35,90,129)` with a 2px offset on links and buttons.
- Colour contrast: no text under 4.5:1 in light or dark (a script checked all text nodes; its only hit was the aria-hidden "|" separator at 2.46 light, 3.90 dark, and a parser false positive on an `oklab` colour). Screens: `.qa/screens/2026-10-31/a11y-1.png` (light), `a11y-2.png` (dark).
- The filter chips use `aria-current` (not colour alone). The event form marks required fields with native `required` plus a visible asterisk. An empty submit focuses the first invalid field. A server error (end before start) focuses the field with `aria-invalid=true` and `aria-describedby` pointing at "The end must be after the start."
- "Event saved." appears in a `status` region. The entry-quiz and link-post areas have empty `status` regions (live announcements are ready). The PDF preview exposes its text layer and named buttons ("Previous page", "Zoom in").
- Mobile controls exist in the DOM but are hidden with `display:none` at desktop width, so they are not focusable (the "Open navigation panel" button has `aria-expanded`/`aria-controls`).

## Not tested / blocked
- `/admin/sync` Timetable feeds card: 404 for a non-admin (correct). Labels and field errors were reviewed from source only (see F5); nothing there is observed in a browser.
- The phone semester select (`<sm`): I can't resize the viewport with my tools, so I checked the DOM and source only.
- A full keyboard walk of the advanced Plan grid (opening an event block, Moje grupy tab) and the advanced mode beyond landmarks and names: the dev server reloaded the page repeatedly during long Tab chains. The block buttons have no `aria-haspopup`/`aria-expanded` (in the DOM), and I did not see what they open.
- Dark-mode contrast on pages other than `/s`; upload status live regions (no upload done); the event delete confirmation.
- I created one event ("A11y test", id 33, 5 Nov) through the form. It is normal sandbox data.
