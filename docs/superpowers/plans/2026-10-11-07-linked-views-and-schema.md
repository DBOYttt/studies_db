# Linked Widoki, Entity Pages and Draggable Schemat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every reference in the Widoki browse grids clickable, add lecturer / user / tag pages that show only associated data, and rebuild the Schemat diagram so it is readable and its boxes can be dragged.

**Architecture:** A pure link mapper (`lib/view-links.ts`) turns view cells into `{ text, href }` cells using a tiny id lookup loaded per request. Entity pages are server components in `app/(app)/{lecturers,users,tags}/[id]` that run parametrised SQL against `v_*` views on the RO pool through one shared paging helper and render it in the existing `ResultGrid` + `PreviewPanel`. The diagram keeps all geometry pure in `lib/designer-layout.ts`; `DesignerDiagram.tsx` adds pointer dragging, zoom/fit, a compact-columns toggle and localStorage persistence.

**Tech Stack:** Next 16 (webpack, app router, server components), React 19, TypeScript, Tailwind tokens from `globals.css`, mysql2 RO pool, Drizzle (MariaDB 11), vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-10-11-linked-views-and-schema-design.md`

## Global Constraints

- All UI copy in Polish, matching existing screens (tab labels exactly: `Zajęcia`, `Materiały`, `Przesłane pliki`, `Tematy`, `Pliki`; buttons `Resetuj układ`, `Dopasuj`, `Pokaż wszystkie kolumny`; whole-class group text `Wszystkie grupy`).
- Every page calls `requireUser()`; ids match `/^[1-9]\d{0,8}$/` else `notFound()`; unknown id -> `notFound()`.
- Entity-page grids run on `getRoPool()` against `v_*` views only; values are `?` params; the grid shows the same SQL with values inlined (display only).
- New `v_files` columns are appended LAST: `subject_id`, `class_id`, `group_id`, `uploader_id`.
- localStorage key `studiesdb.schemaLayout.v1`, shape `{ [view]: [x, y] }`.
- Drag threshold 4px; arrow keys move 16px, Shift+arrow 64px; min zoom before scrolling 0.6; default layout fits in 1160px width.
- Lint (`pnpm lint`), web typecheck and vitest must stay clean; run tests with the root `pnpm test` (concurrency 1). Never push.
- UI work follows the existing phpMyAdmin look (`docs/design/studies-db-phpmyadmin.dc.html`), light and dark tokens; use the taste skills for UI tasks.

## Review Focus

1. Lecturer with no `class_lecturers` rows -> page renders with an empty-state line ("Brak przypisanych zajęć.") on Zajęcia and an empty grid on Materiały, not an error. (Task 3 test + Task 4 page.)
2. User who uploaded nothing / tag on no topic -> empty grids with zero-row message, page still 200. (Task 3 test.)
3. Touch: dragging a header must not scroll the page, but scrolling over box bodies/canvas still scrolls; a tap (<4px) still navigates. (Task 6 e2e with `hasTouch`.)
4. Corrupt or stale localStorage (bad JSON, unknown view, negative/NaN coords) -> default positions for affected boxes, no crash. (Task 5 unit test.)
5. Toggling "Pokaż wszystkie kolumny" after dragging: boxes keep their dragged x/y, edges re-anchor to the right rows, canvas grows to contain the taller boxes. (Task 5 unit test.)

---

### Task 1: v_files exposes subject/class/group/uploader ids

**Files:**
- Create: `packages/db/migrations/0005_files_ids.sql` (+ journal entry and `meta/0005_snapshot.json` produced by drizzle-kit)
- Test: `packages/db/test/hierarchy-schema.test.ts`

**Interfaces:**
- Produces: `v_files` columns, in order: `material_id, subject_code, subject_name, class_name, group_name, topic_id, topic_title, filename, mime_type, size_bytes, preview_kind, status, uploader, created_at, subject_id, class_id, group_id, uploader_id`.

- [ ] **Step 1: Failing test** in `hierarchy-schema.test.ts`: `it('v_files ends with subject_id, class_id, group_id, uploader_id')` — query `information_schema.COLUMNS` for `v_files` ordered by `ORDINAL_POSITION`; assert the last four names equal `['subject_id','class_id','group_id','uploader_id']` and the first 14 are unchanged; insert a material in a topic with class+group and assert the row's four ids equal the inserted ids (group_id NULL for a class-wide topic).
- [ ] **Step 2:** `pnpm --filter @studies/db test -- hierarchy-schema` → FAIL.
- [ ] **Step 3:** From `packages/db`: `pnpm drizzle-kit generate --custom --name files_ids`, then write the migration: `CREATE OR REPLACE VIEW v_files AS` the 0004 definition with `, s.id AS subject_id, t.class_id AS class_id, t.group_id AS group_id, m.uploader_id AS uploader_id` appended to the select list.
- [ ] **Step 4:** `pnpm db:migrate` (dev DB) and the test → PASS; `pnpm --filter @studies/db test` all green.
- [ ] **Step 5:** Commit `feat(db): v_files exposes subject, class, group and uploader ids`.

### Task 2: Clickable cells in Widoki + lecturer links on Prowadzący

**Files:**
- Create: `apps/web/lib/view-links.ts`, `apps/web/test/view-links.test.ts`
- Modify: `apps/web/lib/queries.ts` (add `loadLinkContext`; `SubjectLecturer` gains `id: number`), `apps/web/lib/cells.ts` (`toCells` accepts `links`), `apps/web/app/(app)/tables/[view]/page.tsx` (BrowseTab), `apps/web/app/(app)/subjects/[code]/page.tsx` (Prowadzący name -> link), `apps/web/test/queries.test.ts`, `apps/web/test/cells.test.ts`

**Interfaces:**
- Produces:
  - `type LinkContext = { subjects: Map<number, string>; classes: Map<number, { code: string; kind: ClassKind }>; groups: Map<number, { code: string; kind: ClassKind; number: number }> }`
  - `loadLinkContext(db: Db): Promise<LinkContext>` (three small selects on base tables).
  - `cellHref(view: PublicView, columns: string[], row: unknown[], col: number, ctx: LinkContext): string | null`
  - `lecturerHref(id: number)`, `userHref(id: number)`, `tagHref(id: number)`, `topicHref(id: number)` -> `/lecturers/1`, `/users/1`, `/tags/1`, `/topics/1`; `classHref(ctx, classId)`, `groupHref(ctx, groupId)`, `subjectHref(ctx, subjectId)` -> string | null (built with `explorerHref`).
  - `toCells(rows, opts?: { view; columns; links?: LinkContext })`: preview cells first; otherwise a non-null cell with an href becomes `{ text: String(v), href }`.
- Rules: exactly the spec table (section 1). Same-row lookups: in `v_files`, `class_name` uses that row's `class_id`, `group_name` its `group_id`, `subject_code`/`subject_name` its `subject_id`, `topic_title` its `topic_id`, `uploader` its `uploader_id`; in `v_classes`/`v_class_groups`/`v_lecturers`/`v_users`/`v_tags`/`v_topics`/`v_subjects` the label column uses the row's `id`. Ids not in the context or NULL -> null.

- [ ] **Step 1: Failing tests** (`view-links.test.ts`), with a fixture ctx `{subjects:{2:'MECH'}, classes:{5:{code:'MECH',kind:'cwiczenia'}}, groups:{7:{code:'MECH',kind:'cwiczenia',number:3}}}`:
  - `v_subjects` row `[2,'Mechanika','MECH',…]` -> `id`, `name`, `code` all `'/subjects/MECH'`.
  - `v_class_lecturers` `[5, 1, 7]` -> `'/subjects/MECH?class=cwiczenia'`, `'/lecturers/1'`, `'/subjects/MECH?class=cwiczenia&group=3'`; with `group_id` NULL -> null.
  - `v_topics` `created_by` 4 -> `'/users/4'`; `id`/`title` -> `'/topics/<id>'`.
  - `v_files` `class_name` -> class href from same-row `class_id`; `uploader` -> `'/users/<uploader_id>'`; unknown `class_id` 99 -> null.
  - `v_tags` `name` -> `'/tags/<id>'`; `subject_id` -> subject href.
  - `cells.test.ts`: `v_files` `filename` stays `{ preview }` (no href) even with links; `v_users` `display_name` -> `{ text, href: '/users/…' }`.
- [ ] **Step 2:** `pnpm --filter @studies/web exec vitest run test/view-links.test.ts test/cells.test.ts` → FAIL.
- [ ] **Step 3:** Implement `view-links.ts` (a per-view column->resolver table plus the generic FK column table), extend `toCells`, add `loadLinkContext` (test in `queries.test.ts`: returns maps for seeded subject/class/group). In BrowseTab call `loadLinkContext(getDb())` inside a try/catch (failure -> no links) and pass `links` to `toCells`. `listSubjectLecturers` selects `lecturers.id`; Prowadzący renders the name as `<Link href={lecturerHref(id)}>`.
- [ ] **Step 4:** Tests PASS; `pnpm --filter @studies/web exec tsc --noEmit` clean.
- [ ] **Step 5:** Commit `feat(web): clickable references in Widoki grids and lecturer links`.

### Task 3: Entity queries (lecturer, user, tag)

**Files:**
- Create: `apps/web/lib/entity-queries.ts`, `apps/web/test/entity-queries.test.ts`

**Interfaces:**
- Consumes: Task 1 columns; `parsePerPage`, `toJsonValue` from `lib/tables.ts` / `lib/sql-console.ts`.
- Produces:
  - `type SqlPage = { columns: string[]; rows: unknown[][]; total: number; page: number; pageCount: number; perPage: number; sql: string }`
  - `pageSql(pool: mysql.Pool, q: { select: string; from: string; where: string; params: (string|number)[]; orderBy: string; page: number; perPage: number }): Promise<SqlPage>` — COUNT then page, `rowsAsArray`, page clamped like `browseView`, `sql` = `SELECT … FROM … WHERE …(values inlined) ORDER BY … LIMIT o, n` one clause per line.
  - `FILE_COLUMNS` — the `v_files` select list shown in entity grids: `material_id, filename, subject_name, class_name, group_name, topic_title, uploader, created_at, status, preview_kind, subject_id, class_id, group_id, topic_id, uploader_id` (ids last so links resolve; same-row rules from Task 2 apply since the view name passed to `toCells` is `v_files`).
  - `fileSort(sort?: string, dir?: string): string` — whitelist `filename|created_at|topic_title|uploader|subject_name`, default `created_at DESC, material_id DESC`.
  - `getLecturer(pool, id): Promise<{ id; name; title: string|null; email: string|null } | null>` (`v_lecturers`)
  - `listLecturerAssignments(pool, id): Promise<LecturerAssignment[]>` where `LecturerAssignment = { subjectCode; subjectName; classKind: ClassKind; className; groupNumber: number|null; groupName: string|null; wholeClass: boolean; fileCount: number }` — whole-class rows (`wholeClass: true`, group null) followed by one expanded row per `v_class_groups` row of that class; ordered subject name, class kind order (`KIND_ORDER`), group number; deduplicated when a lecturer has both a whole-class and a group row for the same group.
  - `lecturerFiles(pool, id, opts: { page; perPage; sort?; dir? }): Promise<SqlPage>` — WHERE from the spec (class taught; whole class OR topic without group OR same group).
  - `getUser(pool, id)` (`v_users`: id, display_name, created_at), `userFiles(pool, id, opts)` (`uploader_id = ?`), `userTopics(pool, id, opts)` (`v_topics t JOIN v_subjects s` columns `id, title, subject_name, class_id, group_id, created_at, subject_id`).
  - `getTag(pool, id)` (`v_tags` ⋈ `v_subjects`: id, name, subject_id, subject_code, subject_name), `tagTopics(pool, id, opts)`, `tagFiles(pool, id, opts)` (`topic_id IN (SELECT topic_id FROM v_topic_tags WHERE tag_id = ?)`).

- [ ] **Step 1: Failing tests** against the test DB (`resetTestDb`, `testRoUrl` pool) with seed: subject MECH; class ćwiczenia with groups 2, 3, 4; class wykład; lecturer A on ćwiczenia gr 2 and gr 3; lecturer B on ćwiczenia gr 4; lecturer C on wykład whole class; lecturer D with no rows; topics: ćw gr2, ćw gr4, ćw no group, wykład no group, no class; one file each, uploaded by user U1 except the ćw gr4 file (U2).
  - `lecturerFiles(A)` filenames = ćw-gr2 + ćw-no-group (not gr4, not wykład, not no-class).
  - `lecturerFiles(C)` = wykład file only; `lecturerFiles(D)` total 0.
  - `listLecturerAssignments(A)` = gr 2, gr 3 (no gr 4); `(C)` = `wholeClass` wykład row (no groups exist) ; `(D)` = `[]`.
  - `userFiles(U2)` = gr4 file only; `userFiles` of a user with nothing → total 0, page 1.
  - `tagFiles` / `tagTopics` return only tagged topics' rows; untagged tag → total 0.
  - `pageSql` `sql` contains the inlined id and `LIMIT 0, 25`; page 99 clamps to the last page.
  - `getLecturer(999)`, `getUser(999)`, `getTag(999)` → null.
- [ ] **Step 2:** Run `pnpm --filter @studies/web exec vitest run test/entity-queries.test.ts` → FAIL.
- [ ] **Step 3:** Implement `entity-queries.ts`. Identifiers are constants; only values are params.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `feat(web): lecturer, user and tag queries over v_* views`.

### Task 4: Entity pages

**Files:**
- Create: `apps/web/app/(app)/lecturers/[id]/page.tsx`, `apps/web/app/(app)/users/[id]/page.tsx`, `apps/web/app/(app)/tags/[id]/page.tsx`, `apps/web/components/EntityFilesGrid.tsx` (server component wrapping ResultGrid + PreviewPanel for a `SqlPage` of `FILE_COLUMNS`)
- Modify: `apps/web/e2e/global-setup.ts` (seed lecturers + class_lecturers on MECH: lecturer "dr Anna Nowak" on laboratorium gr 3; lecturer "prof. Jan Kowalski" on wykład whole class; add lab gr 2 with its own topic+file "lab-gr2.pdf" and lecturer "mgr Ewa Lis" on gr 2)
- Test: `apps/web/e2e/entities.spec.ts`

**Interfaces:**
- Consumes: Task 2 hrefs + `toCells(..., { view: 'v_files', columns, links })`; Task 3 loaders.
- Page contract (all three): `?tab=` selects a tab (default first), `?page`, `?per`, `?sort`, `?dir` drive the grid, `?preview=<material id>` opens `PreviewPanel` via `getMaterialFile`; crumbs `[{icon, kind: 'Prowadzący:'|'Użytkownik:'|'Tag:', label, href}]`; RO error -> the `errBox` alert like BrowseTab. Zajęcia is a plain table styled like `/structure` (Przedmiot, Zajęcia, Grupa, Pliki) with links; empty -> "Brak przypisanych zajęć.".

- [ ] **Step 1:** Load the taste skill for the UI; write `entities.spec.ts` (same single-login cookie pattern as `explorer.spec.ts`, new token `E2E_TOKEN_ENTITIES`):
  - `/tables/v_class_lecturers` → click the `lecturer_id` link of Nowak's row → URL `/lecturers/<id>`, heading contains "Anna Nowak", Zajęcia lists "Gr. 3" and not "Gr. 2"; Materiały tab lists `lab-sprawozdanie.pdf` and not `lab-gr2.pdf`; clicking "Gr. 3" lands on `/subjects/MECH?class=laboratorium&group=3`.
  - Kowalski's Zajęcia shows "Wszystkie grupy".
  - `/tables/v_users` → click `display_name` → user page Przesłane pliki lists the seeded files; Tematy tab lists "Sprawozdanie z ćwiczenia".
  - `/tables/v_tags` → click "Kolokwium" → tag page Tematy lists the tagged topic; Pliki lists its file.
  - `/lecturers/abc` and `/lecturers/999999` → 404 text.
- [ ] **Step 2:** `pnpm --filter @studies/web e2e -- entities` → FAIL.
- [ ] **Step 3:** Implement `EntityFilesGrid` and the three pages.
- [ ] **Step 4:** e2e PASS; full web e2e still green; screenshot each page at 1440 and 390 wide and compare to the subject screen look.
- [ ] **Step 5:** Commit `feat(web): lecturer, user and tag pages`.

### Task 5: Designer layout v2 (pure)

**Files:**
- Modify: `apps/web/lib/designer-layout.ts`, `apps/web/test/designer-layout.test.ts`

**Interfaces:**
- Produces:
  - `DESIGNER_DEFAULT_POS: Record<PublicView, [number, number]>` — five columns per spec (x ≈ 20, 260, 500, 740, 980; tune by screenshot in Task 6).
  - `compactColumns(view: PublicView, all: string[]): string[]` — keys (`id`, `*_id`, `created_by`, `material_id`) + first present label of `name|code|title|display_name|original_filename|filename` (v_subjects shows both `code` and `name`), in original order.
  - `buildDesignerLayout(columns, opts: { highlight?: DesignerHighlight; positions?: Partial<Record<PublicView,[number,number]>>; showAll?: boolean }): DesignerLayout` — boxes gain `columns: { name; key; label: boolean }[]`; edges gain `fromRow`/`toRow` names, `d` is an orthogonal path with 6px rounded corners, `markers: { many: [x,y,dir]; one: [x,y,dir] }` (dir `'left'|'right'`); `width`/`height` = max box extent + 40 margin (min 1160×560).
  - `parseStoredPositions(raw: string | null): Partial<Record<PublicView,[number,number]>>` — drops bad JSON, unknown views, non-finite or negative numbers; rounds.
  - `clampPosition([x,y]): [number,number]` — ≥ 0.
- Edge routing: leave from the side of the FK box facing the PK box centre (right if PK centre x > FK centre x, else left), go 16px out, vertical to the PK row's y, enter the facing side of the PK box; when boxes overlap horizontally use the right sides of both with a 24px detour. A relation whose column is hidden in compact mode anchors to the box header instead (never happens for keys; test it with `showAll:false` and a non-key relation-free column).

- [ ] **Step 1: Failing tests:** default layout has no overlapping boxes and `width <= 1160`; compact `v_topics` = `['id','subject_id','class_id','group_id','title','created_by']`; `showAll` restores `discord_thread_id`; edge `v_class_lecturers.lecturer_id>v_lecturers.id` path starts at the y of the `lecturer_id` row and ends at the `id` row of `v_lecturers`; `markers.many` sits at the FK end; positions `{v_files:[900,700]}` move only that box, grow height to ≥ 700 + box height + 40; `parseStoredPositions('{"v_files":[10,-5],"nope":[1,1],"v_tags":"x","v_users":[30.4,40]}')` → `{ v_users: [30, 40] }`; `parseStoredPositions('not json')` → `{}`; Review Focus 5: dragged positions survive `showAll` toggle and edges re-anchor to the new row y.
- [ ] **Step 2:** `pnpm --filter @studies/web exec vitest run test/designer-layout.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; existing callers updated to the new `opts` signature; typecheck clean.
- [ ] **Step 5:** Commit `feat(web): readable designer layout (data-flow columns, compact columns, orthogonal edges)`.

### Task 6: DesignerDiagram interactions

**Files:**
- Modify: `apps/web/components/DesignerDiagram.tsx`, `apps/web/app/(app)/schema/page.tsx` and the subject Schemat tab (pass-through only)
- Test: `apps/web/e2e/schema.spec.ts`

**Interfaces:**
- Consumes: Task 5 exports.
- Behaviour: toolbar above the canvas: `−`, `+`, `Dopasuj`, `Resetuj układ`, checkbox `Pokaż wszystkie kolumny` (state in component; not persisted). Zoom range 0.6–1.5 in 0.1 steps; "Dopasuj" = container width / layout width clamped to [0.6, 1]; initial zoom = Dopasuj, recomputed on container resize (ResizeObserver) until the user zooms manually. Drag on header via pointer capture (`touch-action: none` on header only); movement ≥ 4px (screen px) = drag (positions in layout px = screen / zoom), on release save all custom positions to localStorage; < 4px = navigate to `/tables/<view>` via the header link. Header is a focusable link; arrow keys move 16 / Shift 64 and save. Hover/focus box: its edges + rows `text-accent`, others `opacity-25`; hover a key row highlights its relation(s). Edge ends: crow's foot / bar markers drawn from `markers`. Each box `aria-label="<view>, przeciągnij nagłówek, aby przesunąć"`.

- [ ] **Step 1:** Load the taste skill; write `schema.spec.ts`: `/schema` shows all 11 boxes and `v_files` box fully inside the canvas viewport at 1440×900; drag the `v_users` header by (200, 120) → its bounding box moved ≈ (200,120)·zoom; reload → same position; "Resetuj układ" → back to the original; a click without movement on `v_tags` header → URL `/tables/v_tags`; toggle "Pokaż wszystkie kolumny" → `discord_thread_id` visible; touch context (`hasTouch: true`, 390 wide): tap a header navigates.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; then screenshot `/schema` and `/subjects/MECH?tab=schema` (light + dark) and tune `DESIGNER_DEFAULT_POS` until no edge passes through a box, keeping Task 5 tests green.
- [ ] **Step 4:** e2e PASS; whole web e2e + vitest + lint green.
- [ ] **Step 5:** Commit `feat(web): draggable, zoomable Schemat with compact columns and highlight`.

### Task 7: Final verification

- [ ] Run `pnpm lint`, `pnpm test`, web typecheck, full web e2e; fix anything red.
- [ ] Manual smoke on the dev server as user 2: every Widoki view's links, the three entity pages, Projektant drag/reset, subject Schemat tab, mobile drawer.
- [ ] Commit any fixes `fix(web): …`.
