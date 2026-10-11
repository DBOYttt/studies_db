# Linked Widoki, entity pages and a readable, draggable Schemat

Date: 2026-10-11. Status: approved in chat ("yes"), pending spec review.

## Intent

The user asked for (their words, condensed):

- "give Widoki actual usefulness": in the view tables, clicking a subject
  goes to that subject; the same for tags etc.
- Clicking a lecturer shows everything associated with them: classes,
  groups, materials. A lecturer teaching groups 2 and 3 links to those
  groups only; groups taught by someone else are not reachable from that
  lecturer.
- Clicking a user shows what the user uploaded.
- Fix the database "Schemat" so it is understandable, and let the user drag
  the tables to reposition them.

Assumptions confirmed by the approval:

- A lecturer assigned to a whole class (`class_lecturers.group_id IS NULL`)
  is associated with every group of that class.
- Dragged positions are stored per browser (localStorage), not shared;
  "Resetuj układ" restores the default.

Success: from any Widoki browse grid a user can reach the subject, class,
group, topic, lecturer, user or tag a cell refers to in one click; the
lecturer / user / tag pages show only associated data; the Schemat is
readable at a glance on a 1440px screen without horizontal clipping and
boxes can be dragged with mouse or touch.

## 1. Links in Widoki

Scope: the Przeglądaj tab of `/tables/[view]` (server-mode ResultGrid). The
SQL console and search results are unchanged (arbitrary result sets carry no
reliable column provenance).

A new pure module `apps/web/lib/view-links.ts` maps `(view, column, row)` to
an href. It needs a small lookup loaded once per request,
`loadLinkContext(db)` in `lib/queries.ts`:

- `subjects`: id -> code
- `classes`: id -> { code, kind }
- `groups`: id -> { code, kind, number }

(All three tables are tiny: tens of rows.)

Link rules (`subjectHref = explorerHref(code, …)` from `lib/explorer.ts`):

| View | Columns | Target |
|---|---|---|
| v_subjects | id, code, name | `/subjects/{code}` |
| v_classes | id, name | subject screen `?class={kind}` |
| v_class_groups | id, name | subject screen `?class={kind}&group={number}` |
| v_lecturers | id, name | `/lecturers/{id}` |
| v_users | id, display_name | `/users/{id}` |
| v_tags | id, name | `/tags/{id}` |
| v_topics | id, title | `/topics/{id}` (existing redirect) |
| any view | `subject_id` | subject screen |
| any view | `class_id` | class link (as v_classes) |
| any view | `group_id` | group link (as v_class_groups) |
| any view | `lecturer_id` | `/lecturers/{id}` |
| any view | `created_by`, `uploader_id` | `/users/{id}` |
| any view | `tag_id` | `/tags/{id}` |
| any view | `topic_id` | `/topics/{id}` |
| v_files | subject_code, subject_name | subject screen |
| v_files | class_name / group_name | class / group link (via the new id columns) |
| v_files | topic_title | `/topics/{id}` |
| v_files | uploader | `/users/{uploader_id}` |

Existing preview cells (v_materials `id`/`original_filename`, v_files
`material_id`/`filename`) keep opening the preview; preview wins over the
table above. NULL cells and ids missing from the lookup stay plain text.
Cells become `{ text, href }` (already supported by `Cell`/ResultGrid). CSV
export is unaffected (text only).

The subject screen's Prowadzący tab links each lecturer name to
`/lecturers/{id}` (`SubjectLecturer` gains `id`).

### Migration 0005: v_files ids

`CREATE OR REPLACE VIEW v_files` appends `subject_id`, `class_id`,
`group_id`, `uploader_id` at the END of the column list (existing column
order and saved queries unchanged). No table or data changes. The Drizzle
journal and the read-only grants are updated as for 0004.

## 2. Entity pages

All three follow the subject screen pattern: `requireUser()`, numeric id
validated (`/^[1-9]\d{0,8}$/`, else 404), unknown id -> `notFound()`,
`ScreenHeader` with crumbs `Serwer › Baza danych › <Kind>: <name>` and
tabs (`?tab=`), file grids are server-mode ResultGrids showing the SQL they
ran on the RO pool against `v_*` views (so "Edytuj w konsoli SQL" works),
with Podgląd opening the existing PreviewPanel (`?preview=`) and Pobierz.

### `/lecturers/[id]`

Header: title + name, email (mailto) when present.

- **Zajęcia** (default tab): one row per assignment, ordered by subject,
  class kind order, group number. Columns: Przedmiot (links to subject),
  Zajęcia (links to class), Grupa (links to group; for whole-class
  assignments the text is "Wszystkie grupy" linking to the class, followed
  by one row per existing group of that class linking to that group),
  Pliki (live file count of that class/group).
- **Materiały**: `v_files` rows of topics the lecturer is associated with:

  ```sql
  SELECT … FROM v_files f
  WHERE EXISTS (SELECT 1 FROM v_class_lecturers cl
                WHERE cl.lecturer_id = ?
                  AND cl.class_id = f.class_id
                  AND (cl.group_id IS NULL OR f.group_id IS NULL
                       OR cl.group_id = f.group_id))
  ```

  Rule: a file is associated when its topic's class is taught by the
  lecturer and either the lecturer teaches the whole class, the topic has
  no group (class-wide material), or the groups match. Files of other
  groups and files without a class never appear. Server paging, sort,
  per-page as on the subject Pliki grid.

### `/users/[id]`

Header: display_name, "Dołączył(a) <created_at>" from `v_users`.

- **Przesłane pliki** (default): `v_files WHERE uploader_id = ?`.
- **Tematy**: `v_topics WHERE created_by = ?` joined to subject name;
  title links to `/topics/{id}`, subject to the subject screen.

### `/tags/[id]`

Header: tag name as a TagBadge, subject link.

- **Tematy** (default): topics with the tag (`v_topic_tags` ⋈ `v_topics`),
  title links to the topic, class/group links as in section 1.
- **Pliki**: `v_files` whose `topic_id` has the tag.

Queries live in a new `lib/entity-queries.ts` (lecturer, user, tag loaders
and SQL builders), separate from the already large `lib/queries.ts`.

## 3. Schemat (DesignerDiagram) redesign

Used by `/schema` (Projektant) and the subject screen's Schemat tab. Mapa
danych (React Flow DataMap) is unchanged.

**Layout.** Hand-placed default positions in `lib/designer-layout.ts`,
arranged left to right along the data flow, parents left of children:

- column 1: `v_subjects`
- column 2: `v_classes`, `v_tags`
- column 3: `v_class_groups`, `v_topic_tags`, `v_lecturers`
- column 4: `v_class_lecturers`, `v_topics`, `v_users`
- column 5: `v_materials`, `v_files`

Exact coordinates are tuned by screenshot in the plan; tests assert no
two boxes overlap and the default layout fits in 1160px width.

**Compact columns.** By default each box shows key columns (`id`,
`*_id`, `created_by`, `material_id`) plus one label column (`name`,
`code`, `title`, `display_name`, `original_filename`, `filename`).
`discord_*` and other columns are hidden. A "Pokaż wszystkie kolumny"
toggle shows every column; boxes grow and edges re-anchor. Key columns
keep the key icon; the label column is shown in normal weight.

**Edges.** Each relation in `SCHEMA_RELATIONS` is drawn from the FK
column row to the referenced PK row as an orthogonal path
(horizontal–vertical–horizontal, rounded corners), leaving/entering the
box side facing the other box. Ends: a crow's foot ("many") at the FK end,
a single bar ("one") at the PK end. Hovering or focusing a box highlights
its edges and the connected column rows and dims all other edges and boxes;
hovering a column row highlights just its relation. `highlight` (subject
screen selection) keeps its accent style.

**Fit and zoom.** The canvas scales to the container width (SVG
`viewBox`), with zoom buttons `−`, `+`, "Dopasuj" (fit) in a small toolbar
next to "Resetuj układ" and the column toggle. Below 0.6 scale the canvas
scrolls instead of shrinking further.

**Drag.** Pointer events on the box header (mouse, pen, touch;
`touch-action: none` on headers only so the page still scrolls elsewhere).
Movement under 4px counts as a click and opens `/tables/<view>` as today;
more is a drag and suppresses the click. Boxes are clamped to the canvas'
positive quadrant; the canvas grows to contain them. Arrow keys move a
focused box by 16px (Shift: 64px). Positions persist in localStorage key
`studiesdb.schemaLayout.v1` as `{ [view]: [x, y] }`, shared by both
screens; unknown views or malformed JSON are ignored. "Resetuj układ"
clears the key.

The component stays a client component; layout maths (positions, compact
column selection, edge paths, bounds) stays pure in `designer-layout.ts`
so it is unit-testable.

## Error handling

- Entity pages: invalid/unknown id -> 404; RO query errors render the
  existing `roErrorMessage` box instead of the grid (as on the subject
  screen).
- Link lookup failure (DB error) -> grid renders without links rather than
  failing the page.
- localStorage unavailable or corrupt -> default layout, no error shown.

## Testing

- Unit (vitest): `view-links` mapping for every rule above incl. NULLs,
  unknown ids and preview precedence; lecturer association SQL against the
  test DB (whole-class, group-specific, class-wide topic, other group
  excluded, no-class topic excluded); user and tag loaders; designer
  layout (no overlaps, fits width, compact columns, edge endpoints on the
  right rows, stored-position merge/clamp/ignore-invalid).
- Migration test: `v_files` exposes the four new columns last.
- e2e (Playwright): Widoki `v_class_lecturers` -> click `lecturer_id` ->
  lecturer page shows only their groups -> click a group -> subject screen
  filtered to it; `v_users` -> user page lists uploads; `v_tags` -> tag
  page; Projektant drag of a box changes its position and survives reload,
  Resetuj układ restores it; a click without movement still navigates.

## Out of scope

- Links in SQL console / search results.
- Nav tree entries for lecturers, users or tags.
- Server-side (shared) diagram layouts.
- Editing any data.
