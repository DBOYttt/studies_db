# qa-a11y — Klawiaturowy Kuba — 2026-10-16

Summary: Landmarks, headings, aria-current, Polish accessible names and the plan blocks are good. The main gaps are structural: no skip link, no focus management when the file preview opens, no live regions, no visible required marker, and a plan grid whose events are not tied to their day. Coverage is partial: the dev server reloaded the page repeatedly during long Tab sequences, so I could not finish the event-form error test, the event page or the upload status.

## Findings
### F1 [medium] No "skip to content" link; 15 Tab stops before main content
- Where: every page in the shell, e.g. /s, /s/subjects/BD
- Steps: 1. Log in. 2. Press Tab from the top. 3. Count the stops before `main`.
- Expected: A skip link as the first Tab stop (WCAG 2.4.1 Bypass Blocks).
- Actual: The first stop is the logo, then search and menu links. `main` has id="content" but nothing links to it (no `a[href^="#"]`). The first focusable control in main is stop 16 on /s. The event form's Tytuł field is stop 19, and the first "Podgląd" link on a subject page is stop 27.
- Suggestion: Add a visually-hidden-until-focus "Przejdź do treści" link to #content as the first element. Give main tabindex=-1.

### F2 [medium] File preview panel opens without moving focus or announcing; no Escape
- Where: /s/subjects/BD?file=14, via keyboard Tab 27 + Enter on "Podgląd pliku ..."
- Steps: 1. Tab to a Podgląd link. 2. Press Enter. 3. Read document.activeElement. 4. Press Escape.
- Expected: Focus moves to the panel or its close link. Escape closes it and focus returns to the trigger (2.4.3, 3.2.x). The panel is announced.
- Actual: The panel is an `aside` ("Podgląd pliku"), not a dialog. Focus stays on the Podgląd link, which is a full page navigation to ?file=N. A screen-reader user gets no cue that anything opened. The panel is after the whole list in DOM order. Below `lg` it is `fixed inset-0`, so it covers the page but is not modal and focus can still go to the hidden list behind it. Its loading text "Wczytywanie podglądu…" is not in a live region. The close control is a link, "Zamknij podgląd".
- Suggestion: On open, focus the panel heading (tabindex=-1) or the close link. Support Escape. On narrow screens use role=dialog with aria-modal and inert on the background. Add role=status to the loading and error text.

### F3 [medium] Required fields are not marked visibly or in the label
- Where: /s/wydarzenia/nowe
- Actual: `title` and `date` have the native `required` attribute, so the accessible tree reports them as required. The labels "Tytuł" and "Data" have no asterisk or "(wymagane)" text, and no aria-describedby exists on any field. Sighted keyboard users cannot tell which fields are required (3.3.2).
- Not verified: how a server-side validation error is announced or tied to its field. The dev server reloaded my page during the Tab sequence.
- Suggestion: Add a "(wymagane)" suffix or an asterisk with an explanation. Render errors with role=alert and link them to the field via aria-describedby and aria-invalid.

### F4 [medium] Plan grid: events are not associated with their day
- Where: /plan (advanced, week view)
- Actual: Day headers ("Poniedziałek 12.10") are plain generic elements, not headings or column headers. The event buttons come after them in one flat list, named e.g. "08:00–09:30 ASD Wykład A-1 101 Jan Kowalski", with no day in the name. A screen-reader user cannot tell which day a block falls on. The hour ruler is aria-hidden, which is fine. The "dziś" marker is text ("(dziś)"), so it does not rely on colour alone. The legend ("Rodzaje zajęć") is a list, good.
- Expected: A per-day grouping (list or region per day with the heading), or the day in each block's name (1.3.1).
- Suggestion: Wrap each day column in `role=group` / `<section aria-labelledby>`, or use a list per day. Make day headers h3.

### F5 [low] No live regions found on the pages visited
- Where: /s, subject page, event form
- Actual: No `[aria-live]`, `[role=status]` or `[role=alert]` elements in the DOM (only Next's route announcer). I did not get to trigger "Zapisano" or upload status, so those are unverified (4.1.3).
- Suggestion: Check that save and upload results are rendered in role=status regions.

### F6 [low] Breadcrumb "Start" is plain text; tab links lack explicit current state in the tree dump
- Where: /s breadcrumb. aria-current="page" is set on nav items, mode toggle and filters (verified by evaluate), which is good. The breadcrumb's last item is not a link, which is acceptable.
- Suggestion: none required. Only add aria-current="page" to the last breadcrumb item if absent.

### F7 [low] Dev-server page reloads reset keyboard focus
- Where: /s/subjects/BD and /s/wydarzenia/nowe during a long Tab sequence (dev server, shared by all personas)
- Actual: Several times the document reloaded ("Loading ..."), and activeElement went back to BODY. This is probably a Fast Refresh artefact of the shared dev server and not a production bug (guess).
- Evidence: observed three times.

### F8 [idea] The decorative "|" separator in the top bar is low-contrast (3.9:1 in dark) text
- It is aria-hidden (`|` next to Wyloguj), so it is decorative and exempt. Mentioned for completeness.

## What worked well
- `lang="pl"`, a single h1 per page, h2 for sections, and landmarks: complementary "Panel nawigacji", navigation "Menu", "Przedmioty", "Ścieżka", "Tryb widoku", search, banner, main.
- Focus is always visible: a 2px solid rgb(35,90,129) outline on the logo link (checked by computed style).
- Icon-like controls have Polish names: "Podgląd pliku <nazwa>", "Pobierz plik <nazwa>", "Zamknij podgląd", and the "Rozwiń: / Zwiń:" tree buttons with `expanded`.
- Event kind and "dziś" use text and emoji in addition to colour. Class kinds are labelled in the legend.
- Contrast scan (every text node, computed colour vs. nearest opaque background): no failures below 4.5:1 on /s and /s/wydarzenia/nowe in light mode, and none on /s in dark mode. The only low-contrast hit is the aria-hidden "|" separator. The oklab-coloured file titles in dark mode were a parser limitation of my script, not a finding.
- The event form has proper labels, and Polish option names for Rodzaj, Powtarzaj and Przedmiot.
- Moje grupy and the simple Plan page loaded fine on the second try (the very first load showed a transient "Nie udało się połączyć z bazą danych" alert, role=alert, probably due to the sandbox restart).
- Login was done by keyboard only (Tab, Enter).

## Not tested / blocked
- Moje grupy interaction (checkboxes and reminders) by keyboard, only loaded.
- Event page, edit/delete, upload status and retry, server-side form errors (F3, F5).
- Escape/focus return in modals (the SQL console and block details in advanced mode), plan block activation.
- Dark-mode contrast on the plan and the form, and the advanced mode beyond /plan.
- Screenshot: /Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-16/qa-a11y-1.png (start page, dark).
