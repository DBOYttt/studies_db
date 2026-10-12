# Tryb prosty (simplified view)

Date: 2026-10-12. Status: design approved in chat (default Prosty, include
Plan zajęć), pending spec review.

## Intent

The user imported the Claude Design project "Studies DB"
(`claude.ai/design/p/b4d080f6-…`, file `Studies DB.dc.html`) and asked to
"add from this design, simplified view". The design adds a **Prosty /
Zaawansowany** switch: Zaawansowany is today's phpMyAdmin-style site;
Prosty is a calmer, student-facing view for finding and opening
materials without knowing SQL or views.

Decisions (user): Prosty is the default for everyone who has not chosen;
the simple view also gets **Plan zajęć**.

Success: a student who opens the site lands on the simple Start page, sees
every subject as a card, opens a subject, narrows by class type / group /
tag with chips, previews and downloads a file, finds files by search,
checks the ready-made reports and their week plan — all without seeing
SQL; one click on "Zaawansowany" takes them to the equivalent
phpMyAdmin screen, and the choice is remembered.

## Source design (what is taken over)

Design file lines 22–250 (`isSimple` branch) and `simpleVals()`.
Visual language is the existing one (Geist, accent `#235a81`, zinc
greys); the design is desktop-only and light-only — this spec adds the
phone layout and dark theme using the app's existing tokens.

- **Shell**: 248px left sidebar (`#f4f4f5`): logo "StudiesDB TP 4.0"
  (→ Start), search input "Szukaj plików i tematów" (Enter runs search),
  nav items Start (`ph-house`), Ostatnio dodane
  (`ph-clock-counter-clockwise`), Gotowe zestawienia (`ph-chart-bar`) —
  plus **Plan zajęć** (`ph-calendar-blank`, our addition, after Start) —
  then heading "PRZEDMIOTY" and one row per subject (`ph-book-open-text`,
  name, file count). Top bar (48px): breadcrumbs (`Start › <subject> ›
  <class> › <group>`), the segmented switch **Prosty** (filled, `ph-sparkle`)
  / **Zaawansowany** (`ph-terminal-window`, title "Pokaż SQL, widoki i
  strukturę bazy"), avatar + name + Wyloguj. No SQL console footer.
- **Start**: h1 "Przedmioty", sub "Wybierz przedmiot, aby zobaczyć
  materiały z zajęć."; grid of subject cards (auto-fill, min 240px): code
  badge, "Semestr N · E ECTS", name, class-kind pills, footer
  "`n` plików" + "ostatnio <date>" / "brak plików". Then h2 "Ostatnio
  dodane" with the 5 newest files (with subject name).
- **Ostatnio dodane**: h1 + sub "Wszystkie pliki, od najnowszych.", all
  files newest first (server paging, 50 per page, "Pokaż więcej").
- **Wyszukiwanie** (`?q=`): h1 `Wyniki dla „q”`, sub "`n` plików";
  matches highlighted with `<mark>` in filename and topic; empty
  "Nic nie znaleziono. Spróbuj innego słowa."; without q: "Wpisz słowo w
  polu wyszukiwania i naciśnij Enter."
- **Przedmiot**: code badge, h1 name, "Semestr N · E ECTS", description;
  chip panel with rows **Zajęcia** (Wszystkie + each class kind),
  **Grupa** (only when a kind with groups is chosen: "Wszystkie grupy" +
  groups), **Rodzaj** (Wszystko + the subject's forum tags); h2
  "Pliki (n)" with the filtered file list, empty state "Brak plików dla
  wybranych filtrów." + "Wyczyść filtry"; h2 "Prowadzący" with lecturer
  cards (name with title, "<class> · <group or 'wszystkie grupy'>",
  e-mail or "brak e-maila", **plus konsultacje and pokój when set**);
  footer hint "Potrzebujesz własnego zapytania? Otwórz ten przedmiot w
  trybie zaawansowanym". Also (our addition) a "Najbliższe zajęcia" strip:
  the next 3 sessions of the subject from the timetable, with a link to
  the plan.
- **File row** (all lists): file-type icon tile (pdf red, image green,
  text accent, other grey), filename (opens preview), status badge
  ("Przetwarzanie…" amber / "Podgląd niedostępny" red), topic title,
  meta "subject · class, group · dodał(a) X · date · size", buttons
  **Podgląd** and **Pobierz**. Selected row tinted.
- **Preview panel** (right, 360px; full screen on phones): "Podgląd
  pliku", close (Esc), filename + topic, **Pobierz**, **Pełny ekran**
  (opens `/files/<id>/preview` in a new tab), status badge, the real
  preview (reuse `FilePreview` / PdfViewer from the advanced view instead
  of the design's placeholder), meta table Przedmiot / Zajęcia / Rozmiar /
  Dodał(a) / Dodano.
- **Gotowe zestawienia**: h1 + sub "Odpowiedzi na częste pytania o bazę.
  Wybierz jedno, aby zobaczyć wynik."; three report cards from
  `EXAMPLE_QUERIES` with icons/descriptions (`ph-books` "Ile materiałów
  ma każdy przedmiot.", `ph-medal` "Kto dodał najwięcej plików.",
  `ph-exam` "Tematy z tagiem Kolokwium z ostatnich 30 dni."); selected
  report table with Polish column labels (code→Kod, name→Przedmiot,
  materialy→Materiały, display_name→Autor, liczba_plikow→Pliki, id→Nr,
  title→Temat, created_at→Dodano), row count, "Pobierz CSV",
  "Zobacz zapytanie SQL" (→ advanced SQL console with that query),
  empty "Brak wyników w tym zestawieniu."
- **Plan zajęć** (our addition): the existing `PlanWeekTab`/`WeekView`
  (week grid, Moje grupy filter, session panel) inside the simple shell;
  tabs Tydzień / Moje grupy only (no Lista/SQL); session-panel links go to
  simple subject pages.

## Routes and mode

- Simple pages live in a new route group with its own layout:
  `/s` (Start), `/s/recent`, `/s/search?q=`, `/s/reports?r=0|1|2`,
  `/s/plan?week=&tab=`, `/s/subjects/[code]?class=&group=&tag=&file=`;
  `?file=<material id>` opens the preview panel on any list page.
  Existing advanced URLs are unchanged.
- Mode cookie `studiesdb.mode` = `simple` | `advanced` (path `/`, 1 year,
  SameSite=Lax, not HttpOnly-sensitive). Missing cookie = **simple**.
- `/` (advanced Przedmioty) redirects to `/s` when the mode is simple.
  Login (`/auth/callback`) keeps redirecting to `/`, which then routes by
  mode. Every other advanced URL renders as requested (deep links and the
  e2e suite keep working).
- The switch is a link to `/mode?to=<simple|advanced>&next=<path>` (route
  handler: validates `next` is a same-origin relative path, sets the
  cookie, 303-redirects). Equivalent targets:
  - simple subject (+class/group) ↔ advanced `/subjects/<code>?class&group`
  - simple report `r` → advanced `/sql?q=<that report's SQL>`
  - simple plan ↔ advanced `/plan` (week kept)
  - simple search ↔ advanced `/search?q=`
  - anything else → the other mode's home (`/s` or `/`).
  The advanced top bar gets the same segmented switch (Zaawansowany
  filled).

## Data

All reads go through existing code where it exists; new queries live in
`apps/web/lib/simple-queries.ts` (app pool via Drizzle, like the subject
screen; no new DB views or migrations):

- subject cards: subject + class kinds + live file count + last upload
  (one grouped query);
- file lists: `v_files`-equivalent rows with subject/class/group/topic,
  uploader, size, status, preview kind; filters subject, class kind,
  group number, tag id; newest first; limit/offset;
- search: case/accent-insensitive substring match on filename, topic
  title and subject name (LIKE with escaped wildcards; the column
  collation is already accent-insensitive), merged with existing
  full-text `searchAll` content hits (dedup by material id, substring
  hits first), cap 100;
- reports: run `EXAMPLE_QUERIES[r].sql` on the RO pool (same path as the
  SQL console, incl. its timeout/limits);
- lecturers: existing `listSubjectLecturers` (has office hours/room);
- next sessions: existing plan queries (`v_class_sessions`, starts_at ≥
  now in wall time, limit 3).

## Error handling

- Unknown subject code / material id → 404 / preview panel closed.
- RO report error → error box with `roErrorMessage`, table hidden.
- Search with an empty or whitespace query → the "Wpisz słowo…" state; a
  query longer than 200 chars is truncated.
- Invalid `next` on `/mode` → redirect to the target mode's home.
- Invalid chip params (unknown kind/group/tag) are ignored (treated as
  "Wszystkie").

## Testing

- Unit: mode cookie parsing and `/mode` target mapping incl. open-redirect
  rejection (`//evil`, `https://x`, `\\x`); search highlight splitting
  (case/accents, multiple hits, regex characters in the query); report
  column labels; simple-queries against the test DB (cards counts, filters
  by kind/group/tag, newest-first, search merge/dedup, LIKE escaping of
  `%`/`_`).
- e2e: fresh login lands on `/s`; Start shows cards; open subject →
  chips filter the file list and update the URL; Podgląd opens the panel,
  Pobierz has the download href; search highlights; reports switch and
  CSV link; Plan zajęć shows the week; switch to Zaawansowany goes to the
  matching advanced page and persists across reload; switch back. Existing
  e2e specs set `studiesdb.mode=advanced` in their session cookies.

## Out of scope

Editing anything; per-user server-side mode preference (cookie only);
new reports; changing the advanced view beyond adding the switch.
