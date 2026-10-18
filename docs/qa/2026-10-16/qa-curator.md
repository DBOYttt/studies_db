# qa-curator — Ula Kuratorka — 2026-10-16

Summary: The interface is visually coherent and close to its reference, `docs/design/studies-db-phpmyadmin.dc.html` (Geist, 13 px, blue `#235a81` links, dense phpMyAdmin tree). Light and dark themes are both clean, with no broken contrast on any screen I captured. The weak points are on mobile and in the gaps between simple and advanced mode: plan, search and naming differ between the two. Several flows also take more steps than they should: no events list, no event deep-link from the plan, and a bare English 404.

Method: every screen was captured at 1440 and 375 px, light and dark, via `browser_emulate_media`. Screenshots are in `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-16/curator-<nn>-<screen>-<width>-<scheme>.png`. Screens and numbers:

| nn | Screen |
|---|---|
| 01 | start |
| 02 | simple plan (the `-retry` files are the good run) |
| 03 | Moje grupy |
| 04 | subject |
| 05 | file preview |
| 06 | recent |
| 07 | reports |
| 08 | search |
| 09 | `/s/wydarzenia` 404 |
| 10 | event form |
| 11 | event page |
| 12 | advanced home |
| 13 | advanced plan |
| 14 | SQL |
| 15 | structure |
| 16 | schema ("Projektant") |
| 17 | table browser |
| 18 | advanced search |
| 19 | admin Przegląd |
| 20 | admin SQL |
| 21 | audit log |
| 22 | mobile drawer |

Screenshot references below use these names. Design audit criteria applied: redesign-existing-projects (typography, states, spacing, iconography, omissions) and minimalist-ui (flat surfaces, restrained accent, tabular numbers, `kbd`).

## Findings: errors

### F1 [medium] Plan zajęć and Moje grupy failed with a raw DB error (transient), and the error is contradicted by a second line
- Where: `/s/plan`, `/s/plan?tab=groups`
- Steps: 1. Log in as curator. 2. Open Plan zajęć, then the Moje grupy tab, at about 20:44.
- Expected: the plan, or a friendly error with a retry.
- Actual: red banner "Nie udało się wczytać planu: Nie udało się połączyć z bazą danych." followed directly by grey text "Plan nie był jeszcze synchronizowany". The two lines contradict each other, and the second is wrong, since the plan has been synced. There is no retry button. The same page loaded fine on a later retry (`curator-02-plan-1440-light-retry.png`). The error coincided with my session being dropped (see F2), so it was probably a sandbox DB blip. I am reporting the copy and the missing recovery, not the outage.
- Evidence: `curator-02-plan-1440-light.png`, `curator-03-groups-375-light.png`
- Suggestion: on failure, hide the "nie był synchronizowany" footer and show a "Spróbuj ponownie" link. Do not append the internal cause ("Nie udało się połączyć z bazą danych") after a colon.

### F2 [low] Session lost twice within about 5 minutes (guess: sandbox reset by another persona)
- Where: any page
- Steps: log in, browse, and a few minutes later navigate to `/s/...`.
- Actual: redirect to `/login-info` with no message, as if I had never logged in.
- Expected (idea): a "Sesja wygasła, zaloguj się ponownie" notice. I cannot tell whether this is a bug or another persona resetting the sandbox, so treat it as a guess.
- Suggestion: show a short reason on `/login-info` when a `sid` cookie existed but the session is gone.

### F3 [medium] Unbranded English 404 with no navigation
- Where: `/s/wydarzenia` (and any unknown URL)
- Steps: open `http://localhost:3200/s/wydarzenia`.
- Actual: default Next page, "404 | This page could not be found." No sidebar, no Polish, and no link back. CLAUDE.md says `/s/wydarzenia` is the events entry point, so a user guessing that URL lands here.
- Evidence: `curator-09-eventlist-375-light.png`
- Suggestion: add `not-found.tsx` in Polish ("Nie znaleziono strony" with a "Wróć na start" link). Also add a `/s/wydarzenia` list page (see U3).

### F4 [low] Missing favicon (404)
- Where: every page; the console shows `GET /favicon.ico 404`.
- Suggestion: add `app/icon.svg` using the StudiesDB database glyph.

### F5 [medium] Simple and advanced search return different results for the same query
- Where: `/s/search?q=kolokwium` against `/search?q=kolokwium`
- Actual: simple shows "4 pliki" (files only). Advanced shows "5 trafień" mixing files and topics (`temat`), and the counts differ. Advanced also lists `kolokwium-sql-przyklad.txt` with a fragment that has no highlighted match (the match is only in the filename). The `rozwiazania.md` fragment shows raw markdown ("# Rozwiązania — … ## Zad. 1").
- Evidence: `curator-08-search-1440-light.png`, `curator-18-adv-search-1440-light.png`
- Suggestion: use the same noun and scope in both, for example "4 pliki, 3 tematy" in both modes. Strip markdown markers from fragments. Do not show a fragment when it does not contain the term; show "dopasowano nazwę pliku".

### F6 [medium] Simple plan has no "Lista" view; advanced has Tydzień / Lista / Moje grupy
- Where: `/s/plan` against `/plan`
- Actual: the simple plan has two tabs and the advanced plan has three. The simple week grid is a 7-column timetable that on a 375 px phone shows only about 2 days with horizontal scroll, and the toolbar buttons wrap ("‹ Poprzedni" splits onto two lines, "+ Wydarzenie" sits flush against the right edge).
- Evidence: `curator-02-plan-375-light-retry.png` against `curator-13-adv-plan-1440-light.png`
- Suggestion: give simple mode the Lista tab and make it the default under 640 px. This is the phone view students actually need.

### F7 [low] Naming differs between modes and inside advanced mode
- "Panel admina" (simple sidebar) against "Admin" (advanced rail) against "Panel: Admin" (breadcrumb).
- "Plan zajęć" (simple, tree) against "Plan" (advanced tab).
- "Prosty / Zaawansowany" toggle against the CLAUDE.md term "advanced"; fine, but the advanced tab "Projektant" is the `/schema` page; "Schema" appears in neither the UI nor the URL.
- The advanced tab "Struktura" is a list of views, while the per-row action "Struktura" shows one view's columns. The tab "Szukaj" (full-text) and the per-row "Szukaj" (column filter) are also two different things. This is phpMyAdmin heritage, but the tab and the row action should not share a label.
- The simple reports page says "uploaderzy" ("Najaktywniejsi uploaderzy") — an anglicism; compare the rest of the UI, "dodał(a)". Suggest "Kto dodał najwięcej plików" as the title.
- Evidence: `curator-12-adv-home-1440-light.png`, `curator-15-adv-structure-1440-light.png`

### F8 [low] The advanced rail has a duplicate logout and icon-only entries
- Where: advanced left rail, top
- Actual: the rail (home, SQL, search, designer, admin shield) is icon-only. There is also a "Wyloguj" icon button in the rail, plus the "Wyloguj" link in the top bar, so there are two logouts.
- Suggestion: remove the rail logout, and add visible tooltips (`title`) on the rail icons. Replace the Lucide-style generic icons with a single stroke weight.

### F9 [medium] Subject page: "Projekt" appears in two different filter rows
- Where: `/s/subjects/BD`
- Actual: row "Zajęcia" has Wszystkie / Wykład / Laboratorium / Projekt, and row "Rodzaj" has Wszystko / Kolokwium / Notatki / Projekt. The two "Projekt" pills filter different things (the class, and the tag).
- Evidence: `curator-04-subject-1440-light.png`
- Suggestion: rename the "Rodzaj" row to "Typ materiału" (Kolokwium, Notatki, Projekt) and visually separate the two rows. Also "Wszystkie"/"Wszystko" are grammatically correct but visually read as inconsistent; use "Wszystko" in both.

### F10 [low] Search highlight adds padding that splits words
- Where: `/s/search?q=kolokwium`
- Actual: the `<mark>` has horizontal padding and a gap, so "kolokwium1-2025.pdf" reads "kolokwium 1-2025.pdf" and "Kolokwium 1" is separated.
- Evidence: `curator-08-search-1440-light.png`
- Suggestion: set `mark { padding: 0 }` (the design reference uses `padding:0 2px`, but not within a filename).

### F11 [low] Event page: native English file input and odd "+ Wydarzenie" link
- Where: `/s/wydarzenia/21`
- Actual: "Choose files No file chosen" (browser-native, English) beside a "Dodaj pliki" button. The same words, "Dodaj pliki", are the section heading and the button label. A "+ Wydarzenie" link at the top of the page, above the event's title, reads as a heading or a back link, but it creates a new event. The type tag uses a pencil emoji ("Kolokwium"), which clashes with the no-emoji iconography elsewhere.
- Evidence: `curator-11-event-1440-light.png`, `curator-11-event-375-dark.png`
- Suggestion: replace the native input with a styled "Wybierz pliki" button plus a file-name list; drop the top "+ Wydarzenie" and rely on the breadcrumb; use the SVG icon set for the kind tag.

### F12 [low] Event form: no required markers, inconsistent control widths
- Where: `/s/wydarzenia/nowe`
- Actual: no asterisk or "(opcjonalne)" on any field; the page title and the submit button share the text "Dodaj wydarzenie"; the "Powtarzaj" select is narrower than the "Przedmiot" select; the "Do (godz.)" hint "Bez godziny wydarzenie trwa cały dzień." sits only under the time row on desktop, but under the "Do" field alone on mobile. Native selects use bold text while inputs use regular weight.
- Evidence: `curator-10-eventform-1440-light.png`, `curator-10-eventform-375-light.png`
- Suggestion: mark Tytuł and Data as required; use the same width for all selects; make selects regular weight.

### F13 [low] Mobile breadcrumbs truncate the current page
- Where: 375 px: "Gotowe zestawie…" (reports), "Dod…" (event form), "Kolo…" (event page), "A… » Dzi…" (audit)
- Suggestion: on mobile show only the parent as a back link ("‹ Plan zajęć") and let the title carry the page name.

### F14 [low] Mobile top bar: icon-only mode toggle and logout, small hit targets
- Where: 375 px header, simple and advanced
- Actual: the "Prosty / Zaawansowany" toggle collapses to two unlabelled glyphs (a wand and a terminal). The active one is only a colour change. The hamburger is `size-8` (32 px) and the logout glyph is similar; both are under 44 px.
- Evidence: `curator-01-start-375-light.png`
- Suggestion: give the toggle a one-word label (Prosty / Zaaw.) or a visible tooltip; raise tap targets to 44 px.

### F15 [low] Advanced mobile: tab bar and first screen
- Where: `/` at 375 px
- Actual: the tab bar scrolls horizontally with no scroll affordance, so "SQL", "Szukaj" and "Projektant" are cut off. The home page opens with a very long generated SQL block that takes more than half the screen before any data.
- Evidence: `curator-12-adv-home-375-light.png`
- Suggestion: collapse the generated SQL behind a "Pokaż zapytanie" toggle at under 640 px; add a fade at the right edge of the tab bar.

### F16 [low] Advanced "Struktura": columns with no information and mixed alignment
- Where: `/structure`
- Actual: the "Typ" column is "Widok" in all 13 rows and "Rozmiar" is "—" in all 13. "Kolumny" is monospace and left-aligned while "Wiersze" is sans and right-aligned.
- Evidence: `curator-15-adv-structure-1440-light.png`
- Suggestion: remove "Typ" and "Rozmiar" (they come from phpMyAdmin, where they carry meaning); align all numerics right with `tabular-nums` in one font.

### F17 [low] Schema designer ("Projektant"): connector lines run through and under the tables
- Where: `/schema`
- Actual: the join lines cross table bodies (for example through `v_class_lecturers` and `v_topics`), and several end at the edge of the canvas with no table. Initial zoom is 98 % on desktop and 60 % on mobile, where text becomes unreadable.
- Evidence: `curator-16-adv-schema-1440-light.png`, `curator-16-adv-schema-375-dark.png`
- Suggestion: route lines around the boxes, and set the minimum mobile zoom to 80 % with pan.

### F18 [medium] Audit log: the "Tabela" and "Admin" headers mislead, and the "Instrukcja" column is empty
- Where: `/admin` (Przegląd), `/admin/audit`
- Actual: the "Tabela" column shows only numbers (15, 24, 6…), which are row ids rather than table names. The "Admin" column lists students ("Mallory", "Pan Zenon", "Ola Studentka") because event actions by any user are logged. "Instrukcja" is empty for every `event.*` row. The entry ids skip a value (24 then 26 is shown, 25 missing; guess: filtered). On mobile the "Akcja" column is off screen, so a row cannot be read without scrolling.
- Evidence: `curator-19-admin-1440-light.png`, `curator-21-audit-1440-light.png`, `curator-21-audit-375-light.png`
- Suggestion: rename the headers to "Użytkownik" and "Obiekt" (for example "wydarzenie #15"); link the object; show the event title in "Instrukcja" or rename it to "Szczegóły". On mobile switch the table to stacked cards.

### F19 [low] Plan calendar: "Konsultacje" block uses a "+" glyph
- Where: `/s/plan` and `/plan`, Saturday 16:00
- Actual: the block shows a "+" before "Konsultacje", which looks like an "add" control. Every other block has no leading icon, and the white background breaks the colour system.
- Evidence: `curator-02-plan-1440-light-retry.png`
- Suggestion: use a clock or person glyph (or no glyph), and tint it like the other kinds.

### F20 [low] Admin SQL: disabled buttons are too faint, and two histories coexist
- Where: `/admin/sql`, `/sql`
- Actual: both "Podgląd" and "Wykonaj" are rendered as pale blue blocks (disabled state) with low contrast in light mode. The public SQL console has a "Historia (0)…" dropdown and a separate "Historia zapytań (0)" bar at the bottom. The `kbd` hint "Ctrl+Enter" is plain mono text and is not rendered as a key.
- Evidence: `curator-20-adminsql-1440-light.png`, `curator-14-adv-sql-1440-light.png`
- Suggestion: keep one history; render the shortcut as `<kbd>`; keep disabled buttons at 3:1 minimum.

## Findings: usefulness

### U1 [idea] Start (simple): the first screen is a list of subject cards that duplicates the sidebar
- What a student comes to do: open a file for a subject, see the next class, see a deadline. Steps now: 2 clicks to open a file (card, then "Podgląd") or search.
- Evidence: `curator-01-start-1440-light.png`. The six subjects are shown twice (cards and "PRZEDMIOTY" in the sidebar), and "Nadchodzące wydarzenia" ("Brak nadchodzących wydarzeń.") and "Ostatnio dodane" are pushed below the fold. On mobile they are about four screens down (`curator-01-start-375-dark.png`).
- Change: put "Dziś / najbliższe zajęcia + wydarzenia" at the top (1 line each), then "Ostatnio dodane" (5 files), then the subject cards. On desktop hide the cards' tag chips (Wykład, Laboratorium) or turn the grid into a compact list. The empty state "Brak nadchodzących wydarzeń." should include the action ("Dodaj kolokwium").

### U2 [idea] Plan zajęć: no way to jump from a block to its subject or its files
- Steps now: plan block → nothing; the student goes to the sidebar → subject (2 steps and a context switch).
- Change: make each timetable block a link to `/s/subjects/<kod>?class=<rodzaj>`; clicking an empty slot opens the event form pre-filled with the date and time. Show a "dziś" marker line.

### U3 [idea] No events list; events are reachable only from the plan or the start widget
- A student looking for "kiedy jest kolokwium z SQL" has no index. `/s/wydarzenia` is a 404 (F3).
- Change: add a list page ("Nadchodzące", filter by kind and subject, with "+ Dodaj") and a sidebar item "Wydarzenia" under "Plan zajęć". Also surface events in search results.

### U4 [idea] Event form: better defaults cut 4 steps to 2
- Steps now: choose kind, type title, pick date, optionally time, optionally pick subject, submit = about 5 interactions with an empty form.
- Change: default Data to the date of the slot or "dziś"; auto-fill the title from kind + subject ("Kolokwium — Bazy danych"); when opened from a subject page, preselect the subject; for "Kolokwium/Egzamin" make Przedmiot required. Show the "Powtarzaj" end date only when repeating.

### U5 [idea] Event page: the upload empty state sends users away from the action
- "Brak materiałów. Pojawią się po powiązaniu postów z plikami." is shown directly above a separate "Dodaj pliki" section and a "Powiąż posty" section.
- Change: put the upload drop zone inside the empty "Materiały" box ("Przeciągnij pliki lub wybierz"), with "Powiąż post" as a secondary link. Show the upload progress and the "Post na Discordzie: w przygotowaniu" state as a status chip rather than body text.

### U6 [idea] Subject page: one-step access to the file the student wants
- Steps now: choose subject, choose class pill, choose type pill, click Podgląd = 4. The preview panel opens beside the list on desktop but covers the page on mobile with no list context (`curator-05-preview-375-dark.png`).
- Change: show a count on each filter pill ("Laboratorium · 3"), remember the last class filter per subject, and add "‹ Następny / Poprzedni plik" in the preview panel. Show "Najbliższe zajęcia" and "Prowadzący" above the file list for a student who came for a room or e-mail (they are now at the bottom of a long page).

### U7 [idea] Recent: no grouping or filtering
- 21 files in one flat list with no date headers (`curator-06-recent-1440-light.png`). A student coming for "what was added since I last looked" has to compare dates.
- Change: group by day ("Dzisiaj", "Wczoraj", "Ten tydzień"), add a subject select, and mark files added since the last visit with a dot.

### U8 [idea] Reports: the result should open without a click, and the other two reports deserve better names
- Steps now: open Reports, the first report is preselected (good), so 1 step to a result. Titles read as questions only for the first. "Kolokwia z ostatnich 30 dni" is the report students want most.
- Change: make that the default selected report, show it first, and add a "Przejdź do tematu" link on each row. Drop "Zobacz zapytanie SQL" from the simple UI or label it "Pokaż w trybie zaawansowanym".

### U9 [idea] Search: add scope and recovery
- The sidebar search box has no suggestions; the empty result says "Nic nie znaleziono. Spróbuj innego słowa." with no action (`curator-08b-search-empty-375-light.png`).
- Change: after the results, show filters by subject; for an empty result offer "Szukaj w trybie zaawansowanym" (the advanced search has tag and subject filters) and the five most recent files.

### U10 [idea] Advanced start: land on something useful
- The advanced home opens on "Przedmioty" with the generated SQL, the CSV export links and "Operacje na wynikach zapytania" (`curator-12-adv-home-1440-light.png`). For a power user that is correct, but the tree already lists the same subjects. Make the first tab "Struktura" or the "Plan", and add "Ostatnie zapytania" to the SQL tab's empty state (it is a blank page below the editor, `curator-14-adv-sql-1440-light.png`).
- Add a result placeholder such as "Wynik pojawi się tutaj" and example queries as clickable chips next to "Przykłady…".

### U11 [idea] Admin Przegląd: make the numbers actionable
- Steps now: Przegląd shows five counters and the last 10 audit rows. "Zadania nieudane 0" is not a link.
- Change: make each counter a link (failed jobs to a list with "Ponów"); add a "Wydarzenia dodane dziś" counter, because that is most of the traffic; show the event title in the audit rows (F18).

### U12 [idea] Admin SQL (zapis): safer default
- A student-facing admin has to type UPDATE by hand. Offer templates ("Przywróć wydarzenie", "Zmień tytuł tematu") next to "Wyczyść", and make "Podgląd" the default primary action so "Wykonaj" is enabled only after a preview.

## What worked well
- Dark mode is complete on all 22 screens, with no white flashes or unreadable text. Tags, alerts and the timetable colours were re-tuned rather than inverted.
- The simple UI is consistent: one card style, one list-row style (icon, title, description, meta, two actions) on start, subject, recent and search.
- The advanced UI is true to the reference: tree with row counts, tabs, green "Pokazano wiersze…" banner, mono column headers, italic NULL.
- Polish plurals are correct on the screens I checked ("1 plik" style: "2 pliki", "5 plików", "3 pliki", "brak plików", "4 pliki", "13 widoków", "39 wpisów").
- Empty states on the event page, search and "Brak nadchodzących wydarzeń" are present and friendly.
- The search results highlight the match, and file-type icons (PDF, image, code, text) are distinct.
- Mobile drawer and the file-preview panel open and close correctly (`curator-22-drawer-375-light.png`, `curator-05-preview-375-dark.png`).

## Not tested / blocked
- Event edit, delete and restore flows, upload and retry, and reminders (only add and view).
- Long titles and very long subject names (the sidebar name "Algorytmy i struktury danych" wraps on two lines, which looks fine).
- Keyboard focus rings and screen-reader order (left to the a11y persona).
- PDF and image previews: I only opened the `.txt` preview.
- Whether the earlier DB error and the two lost sessions came from a sandbox reset: unknown.

## Top 5 changes by expected impact
1. Mobile plan (F6 plus U2): a "Lista" view as the default under 640 px in simple mode, with timetable blocks linking to the subject. The plan is the most-visited screen, and today the phone shows two days.
2. Rework the simple Start (U1): next classes and events first, then recent files, then subjects, with an action in the empty state. This saves scrolling on every visit, especially on mobile.
3. Add an events list and a Polish 404 (F3 plus U3): `/s/wydarzenia` currently dead-ends in an English 404, and there is no place to see all deadlines.
4. Cut steps in the event form (U4 plus F12): defaults for date, title and subject from the origin screen, required markers, and a single upload step on the event page (U5 plus F11).
5. Align simple and advanced vocabulary and results (F5, F7, F9, F18): the same search scope and noun in both modes, and audit headers that say what they show ("Użytkownik", "Obiekt").
