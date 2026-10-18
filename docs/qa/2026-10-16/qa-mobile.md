# qa-mobile — Mobilna Marta — 2026-10-16

Summary: On 375x812 the simple mode is mostly usable. There is no horizontal page scroll, the drawer works, and the cards and the week grid are readable. The top bar and the tap targets are too small. Two flows could not be verified: the inline PDF preview never finished loading, and the event form submit never showed a result. The dev server kept rebuilding and reloading pages during the run, so the form and preview results are unreliable (see "Not tested / blocked"). Screenshots are in `.qa/screens/2026-10-16/` (`mobile-N.png`, referred to below by N). The screenshot called mobile-23 is only a screenshot of the unchanged reset form, so it is not cited as evidence for any finding below.

## Findings
### F1 [medium] Inline PDF preview stays on "Wczytywanie podglądu…"
- Where: `/s/subjects/SK?file=21` (sprawozdanie-wireshark.pdf)
- Steps: 1. Open the subject page. 2. Tap "Podgląd" on the PDF. 3. Wait 20 s or more.
- Expected: the PDF renders, with zoom available.
- Actual: the panel shows the title, "Pobierz", "Pełny ekran" and the metadata, but the text "Wczytywanie podglądu…" never goes away. I tried 3 times. At the same time the page reloaded repeatedly (Fast Refresh and compiling), which closed the panel. I can't tell whether pdf.js is broken or this is an effect of the dev server.
- Evidence: mobile-8, mobile-11, mobile-14.
- Suggestion: add a timeout with an error state and a retry or download link. Re-test on a stable build.

### F2 [medium] The event form submit gave no visible result
- Where: `/s/wydarzenia/nowe`
- Steps: 1. Fill in title, date 2026-10-20, from 15:00, to 14:00 (reversed times). 2. Tap "Dodaj wydarzenie". 3. Repeat with valid times 14:00 to 15:00 on 2026-10-21.
- Expected: either the event page after a save, or an error shown next to the button or at the top of the form.
- Actual: the button turns grey and pending. After a few seconds the form is back, empty, on the same URL, with no message in the accessibility tree (no alert). In both cases a reload also happened in between, so a hard dev-server reload is a possible cause. I could not tell whether the events were saved.
- Evidence: mobile-22, mobile-24.
- Suggestion: show errors inline and keep the entered values. Re-test on a stable server.

### F3 [medium] The mode toggle (Prosty/Zaawansowany) is tiny and sometimes did not show in the top bar
- Where: top bar on every simple page
- Actual: the toggle is 28x16 px per option, packed into 64x22 px. The "Wyloguj" icon is 19x15 px. On `/s` (mobile-1) and the subject page (mobile-10) the screenshot showed no toggle at all, while mobile-7, mobile-17 and mobile-18 show it. I can't explain why. I reached advanced mode through `/mode?...`.
- Evidence: mobile-1, mobile-3, mobile-10 (toggle missing) versus mobile-17 (present).
- Suggestion: put "Tryb zaawansowany" in the drawer or in a larger control. Make the logout target at least 44 px.

### F4 [medium] Many tap targets are smaller than 44 px
- Hamburger 32x32, "Podgląd" and "Pobierz" buttons 96x32 and 91x32, "Edytuj" and "Usuń" 32 px tall, the class and type filter chips 32 px tall, "Dziś" 50x33, the "Dodaj pliki" and "Szukaj" buttons 32 px and 28 px tall, form inputs and selects 32 px tall, selects in Moje grupy 28 px tall, reminder checkboxes 13x13, the "Anuluj" link on the form 40x21, the "+ Wydarzenie" link on the event page 20 px tall. The gap between "Podgląd" and "Pobierz" is only 6 px.
- Evidence: mobile-7, mobile-18, mobile-20, mobile-25.
- Suggestion: set a minimum of 44 px on touch screens (`min-h-11`), and enlarge the checkboxes through their labels.

### F5 [low] The breadcrumb is truncated to about 45 px
- Where: the event page, the event form, and long subject names
- Actual: the last crumb shows "Konsultacje" as "Kons…" and "Dodaj wydarzenie" as "Doda…". Both are squeezed next to the mode toggle.
- Evidence: mobile-18, mobile-20.
- Suggestion: drop the middle crumbs on small screens, or let the last crumb take the full width.

### F6 [low] The week navigation overflows its container
- Where: `/s/plan` week view
- Actual: the row of "Poprzedni", "Dziś", "Następny" and "+ Wydarzenie" is 357 px wide inside a 343 px column. The "+ Wydarzenie" button ends at x=373, which is 2 px from the screen edge and past the grid's right edge. "Poprzedni" and "Następny" wrap into 2 lines and are 54 px tall. The button is reachable but not aligned.
- Evidence: mobile-17.
- Suggestion: wrap the row (`flex-wrap`), or put the arrows on their own line.

### F7 [low] The English native validation tooltip and the native file input text
- Where: the event form (empty title) and "Dodaj pliki" on the event page
- Actual: "Please fill in this field." and "Choose files No file chosen" appear in English in the Polish UI. The error bubble also covers the "Data" label.
- Evidence: mobile-21, mobile-18.
- Suggestion: use Polish messages (custom validity or `noValidate` with inline errors), and a styled file button.

### F8 [low] Delete confirmation shifts the layout
- Where: the event page (a series event)
- Actual: tapping "Usuń" adds a row ("Usunąć to wydarzenie? Tylko to / To i następne / Anuluj") that pushes the content down by about 40 px. The buttons are close together. It does work and is clear.
- Evidence: mobile-19.
- Suggestion: show the confirmation in a bottom sheet.

### F9 [low] Full-screen PDF has no way back inside the app
- Where: `/files/21/preview` (the "Pełny ekran" link)
- Actual: it opens the bare browser PDF viewer with no link back. The browser Back button works.
- Evidence: mobile-13.
- Suggestion: open it in the same panel, or in a new tab.

### F10 [low] Advanced mode: SQL results are not shown after "Wykonaj"
- Where: `/sql` at 375 px (advanced mode)
- Actual: after "Wykonaj" the only visible change is that "Historia (1)" appears, and the "Historia" select wraps to a new line (layout shift). The result table is not in view. It is probably in the collapsed "Konsola" bar at the bottom, which is fixed at 28 px and covers the page end. The tab strip (Plan, Przedmioty, Struktura, SQL, Szukaj, Projektant) scrolls sideways, and "SQL" is half cut off. This is acceptable but worth noting.
- Evidence: mobile-26, mobile-27, mobile-28.
- Suggestion: scroll to the result or open the result panel automatically.

### F11 [idea] The "Plan zajęć" page failed to load once
- Where: `/s/plan`
- Actual: the first load showed "Nie udało się wczytać planu: Nie udało się połączyć z bazą danych." (mobile-4). Right after that, `/s/subjects/SK` returned `ERR_EMPTY_RESPONSE`. Later the plan loaded fine (mobile-17). This was probably a sandbox or database glitch while the other personas were running.
- Suggestion: add a "Spróbuj ponownie" button to the error box.

## What worked well
- No horizontal scroll of the whole page on any screen.
- The drawer opens, closes with Escape and has a working search field and links (mobile-2).
- Start, subject and file lists use full-width cards with readable text.
- The week view scrolls sideways inside its own container. The blocks (120 px columns) are readable, and the Moje grupy tab and the reminder checkboxes fit.
- Native date and time pickers (`dd/mm/yyyy`, `--:--`) are used for the date and time fields.
- The event page has "Materiały", "Dodaj pliki", "Edytuj" and "Usuń", all reachable without sideways scrolling.

## Not tested / blocked
- Pinch zoom and the download button in the inline PDF preview (the preview never loaded).
- The successful event creation, the editing, and the new-event path from the plan.
- The all-day strip: no all-day events showed in the week I viewed. The "Dziś" week had a 16:00 "Konsultacje" series.
- Uploading files with "Dodaj pliki" (the real submit was not attempted).
- The keyboard area: the headless browser has no on-screen keyboard.
- The dev server rebuilt constantly during the run, which caused reloads that reset forms and closed the preview panel. Findings F1 and F2 may be partly caused by this.
- The Przypomnienia checkboxes: I only looked at them, and did not change them.
