# Plan 6: phpMyAdmin-style redesign of the web app

**Spec (binding):** the Claude Design file `docs/design/studies-db-phpmyadmin.dc.html`
(imported from claude.ai/design project edbff7d8, file "Studies DB - phpMyAdmin.dc.html").
It is an HTML mock with inline styles and a `<script type="text/x-dc">` block holding
fake data and the screen logic (`renderVals()`). Implement its look, layout, copy and
behaviour against the real app: real data, real routes, real SQL console. The mock's
fake data (`SUBJ`, `FILES`, `runSql` regex matching, fake timings) is NOT to be copied.
Earlier specs (`docs/superpowers/specs/2026-10-10-*.md`) still bind for security and data
behaviour (read-only SQL, requireUser on every page, file streaming, preview rules).

**Where:** `apps/web` only (plus at most read-only query helpers). Work directly on `main`
(user chose this for earlier plans). Commit after each task. `pnpm lint`, the web vitest
suite and `pnpm --filter @studies/web typecheck` must pass at the end of every task.
Dev env: `export PATH=$HOME/.local/bin:$PATH`; dev DB is podman `studies-mariadb`
(`pnpm db:up`); tests use the `_test` DB as before.

## Global Constraints

- **Palette (from the design, light mode):** text `#18181b`, muted `#52525b`, faint
  `#71717a`/`#a1a1aa`, borders `#d4d4d8` (strong) / `#e4e4e7` (light), panel bg `#f4f4f5`,
  bar bg `#fafafa`, page bg `#fff`. Accent (phpMyAdmin blue) `#235a81`, accent hover
  `#1b4565`, selected row/tree `#dbe7f3`, row hover `#e8f0fa` (grid) / `#eef4fa` (lists),
  table-box header `#e8eef5`, checked row `#fef3c7`, key icon `#b45309`, SQL keyword
  `#7a1fa2`, string `#047857`, number `#b45309`, Discord avatar `#5865f2`.
  Success box `#a7f3d0`/`#ecfdf5`/`#065f46`; warning `#fcd34d`/`#fffbeb`/`#92400e`;
  error `#fca5a5`/`#fef2f2`/`#991b1b`. Replace the emerald accent tokens in
  `app/globals.css` with these (as CSS variables + Tailwind theme tokens). Keep a dark
  scheme under `prefers-color-scheme: dark` with equivalent tokens (accent text must keep
  ≥4.5:1 on its background in both modes).
- **Type:** Geist 13px base, Geist Mono for identifiers/numbers/SQL; radii 4px controls,
  6px panels, tabs `6px 6px 0 0`, chips 999px.
- **Icons:** `@phosphor-icons/react` only (same names as the design's `ph-*` classes).
  No icon CDN script, no Google Fonts link (keep the `geist` package).
- **Copy:** Polish, exactly as in the design where the design has copy.
- **Density:** compact cells `4px 10px`; zebra rows `#fafafa` on odd rows.
- **Security unchanged:** every page calls `requireUser()`; SQL only via the existing
  read-only console API; nothing new reads base tables through the RO pool.
- **No regressions:** the existing features stay reachable: file preview (pdf/image/text)
  with Pobierz / Pełny ekran / Otwórz w Discordzie, subject Mapa danych (React Flow
  data map), schema highlight of the current selection, CSV exports, `/sql?q=` prefill
  (does not auto-run), `/topics/[id]` redirect, mobile usability (< 768px).

## Screen map (design → routes)

| Design screen | Route |
|---|---|
| db / Przedmioty | `/` |
| db / Struktura | `/structure` (new) |
| db / SQL | `/sql` |
| db / Szukaj | `/search` |
| db / Projektant | `/schema` |
| view / Przeglądaj | `/tables/[view]` |
| view / Struktura, SQL, Szukaj | `/tables/[view]?tab=structure|sql|search` |
| view / Eksport | link to existing `/tables/[view]/csv` |
| subject / Pliki | `/subjects/[code]` (+ existing `class`,`group`,`topic`,`file`,`tag`,`q`,`sort`,`dir` params) |
| subject / Prowadzący, SQL | `/subjects/[code]?tab=lecturers|sql` |
| subject / Mapa danych, Schemat (kept from Plan 5, not in the mock) | `/subjects/[code]?tab=map|schema` |

## Task 1: Tokens and app shell

Files: `app/globals.css`, `app/(app)/layout.tsx`, new `components/shell/*`, new query
helpers in `lib/queries.ts` / `lib/tables.ts`, tests.

1. Tokens per Global Constraints (light + dark).
2. Layout = design's outer grid: left **navigation panel** 264px (design lines 24-54) and
   main column. Panel: logo "Studies**DB** TP 4.0" (link `/`), icon toolbar
   (Strona główna `/`, Konsola SQL `/sql`, Szukaj `/search`, Projektant `/schema`,
   Wyloguj = POST form to `/auth/logout`, right-aligned), "Filtruj według nazwy" input
   (client-side filter of subject names/codes and view names), tree:
   - server node "MariaDB" (link `/`), database node `studies_db` (link `/structure`),
   - folder "Przedmioty" (count) → each subject (count = files) → its classes (count) →
     groups (count), each linking to `/subjects/CODE?class=kind&group=n`,
   - folder "Widoki" (count) → every `PUBLIC_VIEWS` entry (mono, count = row count)
     linking to `/tables/view`.
   Carets toggle open state (client state, persisted in localStorage is optional); the
   node matching the current URL is highlighted `#dbe7f3` and its ancestors open.
   Data: one server query for subjects→classes→groups with non-deleted file counts and
   one RO-pool query for view row counts (single `UNION ALL` statement over
   `PUBLIC_VIEWS`; on RO error show counts empty, never fail the layout).
3. **Top bar** (design 58-75): breadcrumbs + user (avatar image if `avatarUrl`, else an
   initial in a `#5865f2` circle), display name, `|`, "Wyloguj" (POST form).
   Breadcrumbs come from the page: export a `ScreenHeader` component
   (`crumbs`, `tabs`) that pages render at their top; it renders the top bar crumbs
   area and the **tab strip** (design 77-83, tabs are links with `aria-current`).
   Server crumb "Serwer: MariaDB" and "Baza danych: studies_db" are always first.
   Layout renders user/Wyloguj; ScreenHeader renders crumbs + tabs (structure the DOM
   so it matches the design visually).
4. **Console footer** (design 475-494): collapsible bar "Konsola · Historia zapytań (N)";
   expanded list of the SQL history; clicking an entry opens `/sql?q=<entry>`.
   History = localStorage key `studiesdb.sqlHistory` (array of strings, newest first,
   max 50); export small helpers `readSqlHistory()/pushSqlHistory(q)` in
   `lib/sql-history.ts` used by Task 3.
5. **Mobile (<768px):** nav panel becomes an off-canvas drawer opened by a menu button
   in the top bar (focus moves into it, Escape and backdrop close it); tabs scroll
   horizontally.
6. Remove the old header/NAV. Existing pages keep working inside the new shell (they
   can still use their old inner layout until their task restyles them).

## Task 2: ResultGrid (phpMyAdmin result grid)

New client component `components/ResultGrid.tsx` reproducing design lines 354-442, used
by Tasks 3-6. Props (indicative): `columns`, `rows` (cells already typed as in
`components/DataGrid.tsx` `Cell`, incl. file-preview cells), `sql` (text shown
highlighted), `total`, `elapsedMs?`, paging (server: `page`, `pageCount`, `perPage`,
hrefs builder; or client: all rows given), sort (server hrefs or client), `fileColumn`
(index of material id → enables the actions column "Podgląd" (opens preview via
`?preview=`/`?file=` href builder prop) and "Pobierz" (`/files/<id>/original`)),
`linkColumn`, `badge` per row (pending → "Przetwarzanie…" `#b45309`, failed → "Podgląd
niedostępny" `#b91c1c`), `editSqlHref`, `csvHref`, `name` for client CSV download.
Features:
- success message "Pokazano wiersze 0 – N (T łącznie, zapytanie trwało X s.)" or
  "MariaDB zwrócił pusty wynik (zero wierszy)." (omit timing when unknown);
- SQL box with keyword highlighting (port the design `tokenize` into `lib/sql-highlight.ts`
  with unit tests) and links "Edytuj w konsoli SQL", "Eksport CSV", "Odśwież";
- pager (first/prev/page select/next/last), "Liczba wierszy" 25/50/100, "Filtruj
  wiersze" (filters the rows shown), "Pełne teksty" checkbox (wrap vs ellipsis 22rem);
- sortable headers with caret, sticky header, zebra, hover, checked rows `#fef3c7`,
  selected (previewed) row `#dbe7f3`, NULL in italic grey;
- footer "Zaznacz wszystko", "Z zaznaczonymi (n): Eksport CSV" (client CSV of the checked
  rows, use `lib/csv.ts` incl. its formula guard), "N wierszy · strona p / P"
  (Polish plural via `pluralPl`);
- fieldset "Operacje na wynikach zapytania": Drukuj, Eksport CSV, Otwórz w SQL.
Unit-test the pure helpers (highlight, message text, plural footer).

## Task 3: SQL console screen

Restyle `components/SqlConsole.tsx` + `app/(app)/sql/page.tsx` to design lines 106-152:
fieldset "Uruchom zapytanie SQL na bazie danych studies_db:", editor with line numbers
(keep CodeMirror with SQL mode, styled to the design; Ctrl/Cmd+Enter runs), right
column "Kolumny" multi-select listing `view.column` (or only the view's columns when
embedded for a view) — double-click inserts at the cursor; bar with "Przykłady…"
select (`EXAMPLE_QUERIES`), "Historia (N)…" select (Task 1 helpers; every executed
query is pushed), "Wyczyść", the limits note, "Ctrl+Enter", primary "Wykonaj".
Errors: the red box with "Błąd", "Zapytanie SQL:" (highlighted), "MariaDB zwrócił
komunikat:" + message. Results render in ResultGrid (client paging/sort/filter over the
≤1000 rows returned; file previews when the first column is `material_id` or the
result has `id` + `original_filename`, opening the shared PreviewPanel via `/api/material/[id]`).
Keep the existing watchdog/kill, CSV export, `?q=` prefill without auto-run, and
the "Kolumny"/editor accept an `embedded` mode for Tasks 5 and 6 (`initialQuery`,
`columns` scoped). Page gets ScreenHeader with the db tabs:
Przedmioty `/`, Struktura `/structure`, SQL `/sql`, Szukaj `/search`, Projektant `/schema`.

## Task 4: Database screens — Przedmioty, Struktura, Szukaj, Projektant

- `/` (Przedmioty tab): ResultGrid of subjects with columns
  `code, name, semester, ects, zajecia, pliki, ostatnio` (name links to the subject,
  date formatted), the SQL text from the design's `sqlBase` for that tab, client sort.
- `/structure` (new): table of design lines 155-197 — every public view with
  Przeglądaj / Struktura / Szukaj / Eksport links, row count, "Widok", column count, "—",
  summary row "N widoków / Suma / total rows"; "Z zaznaczonymi: Eksport CSV" may be
  omitted if it would need a new endpoint (rule it).
- `/search`: design lines 262-308 — fieldset "Szukaj w materiałach i tematach" with
  "Słowa do wyszukania", "Przedmiot", "Tag" and "Wykonaj" (GET form, existing full-text
  search), success box "Wyniki wyszukiwania „q”: N trafień", results table
  Wynik/Przedmiot/Fragment with `<mark>` highlights (existing Highlight), warning box
  "Brak wyników dla „q”.". Result links open the subject explorer at the file.
- `/schema` (Projektant): replace the React Flow `SchemaDiagram` with a
  `DesignerDiagram` component per design lines 310-328 and the `BOX`/edge maths in the
  script (fixed box positions from the design's `BOX` map, boxes 190px, header 28px, rows
  18px, cubic bezier edges between the related column rows, dotted-grid background,
  hover highlights a box and its edges `#235a81`, click → `/tables/view`). Columns come
  live from `listViewColumns`; relations from `lib/schema-relations.ts` (add
  `v_topics.created_by → v_users.id` if the column exists); a view missing from `BOX`
  gets an automatic position below. It must accept a `highlight` (views + relations +
  caption from `selectionPath`) so Task 6 can reuse it for the subject Schemat tab
  (highlighted boxes/edges in accent, caption shown above). Key icon on `id` and on
  related columns. Horizontal scroll on small screens. Delete `SchemaDiagram` once
  nothing uses it.

## Task 5: View screen — `/tables/[view]`

Tabs (design 747): Przeglądaj, Struktura, SQL, Szukaj, Eksport (link to CSV).
Crumb "Widok: v_x". Browse = ResultGrid with server paging/sort (existing
`browseView`, honour `perPage` 25/50/100 via URL), SQL text shown is the real query
shape (`SELECT * FROM \`v_x\` [WHERE …] ORDER BY … LIMIT off, n`), file rows of `v_files`
/ `v_materials` get Podgląd/Pobierz and open the restyled PreviewPanel (`?preview=`).
Struktura = design 199-231 with real `information_schema.COLUMNS` data (type,
collation, nullable, default) via the RO pool; "Przeglądaj dane" and "Zapytanie do
tego widoku" links. Szukaj = design 233-260: per-column "LIKE %…%" inputs, Wykonaj
applies them as the existing browse `filters` (GET to the browse tab), Wyczyść resets.
SQL tab = embedded console prefilled `SELECT * FROM \`v_x\` WHERE 1`, columns scoped to
the view.

## Task 6: Subject screen and preview panel

`/subjects/[code]`: ScreenHeader crumbs "Przedmiot: name » Class » Gr. N"; tabs Pliki,
Prowadzący, SQL, Mapa danych, Schemat (the last two keep Plan 5 behaviour; Schemat uses
DesignerDiagram with highlight). Subject header (design 88-104): name, mono meta
"CODE, semestr S, E ECTS", description, "Tag:" select (Wszystkie + subject tags)
updating `tag`. Pliki = ResultGrid with columns
`material_id, topic_title, filename, preview_kind, uploader, created_at`, filename is the
link that opens the preview (`file=`), status badges, the SQL text = existing
`buildExplorerSql` output, "Edytuj w konsoli SQL" → subject SQL tab prefilled, CSV via
existing `/subjects/[code]/csv`. The class/group selection now comes from the left nav
tree (Task 1) and crumbs; remove the in-page ExplorerTree/TreeSelect when unused
(topics are still filterable via `topic=` param and the table's topic column).
Prowadzący = design 330-352 table (Zajęcia, Grupa — "wszystkie" when NULL —, Prowadzący
with title, E-mail or "—") from `v_class_lecturers`-equivalent query on the main DB.
SQL tab = embedded console prefilled `SELECT * FROM v_files WHERE subject_code = 'CODE'`.
PreviewPanel restyle (design 445-472): 360px right aside, header bar "Podgląd pliku" with
type icon and close (×, Escape outside form fields), filename, topic, meta table
(Przedmiot, Zajęcia, Rozmiar, Autor, Dodano, MIME truncated 30), buttons Pobierz /
Pełny ekran / Otwórz w Discordzie, status badge, then the real FilePreview. Below
1024px it stays the full-screen sheet from Plan 5. `/topics/[id]` redirect still works.

## Task 7: Tests, e2e and cleanup

Update `e2e/*.spec.ts` selectors to the new UI and keep their coverage (login, drill
subject › Laboratorium › Gr. 3 via the nav tree, open preview, Mapa danych, Schemat
highlight, `/schema` designer, table browser preview incl. mobile sheet, SQL prefill
not auto-running, SQL run shows ResultGrid + history entry, search hit). Remove dead
components/CSS (old DataGrid, ExplorerShell/Tree/Table, TreeSelect, SchemaDiagram, emerald
tokens) only where nothing imports them. Run lint, typecheck, vitest (all packages) and
e2e; fix failures.
