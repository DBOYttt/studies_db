# Studies DB — Plan 5: Class/Group Hierarchy, Subject Explorer & Diagrams

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subject → class → group → topic hierarchy (fed by Discord forum tags), replace the subject page with a three-tab Explorer (tree + table + preview, data map, schema diagram), and make file rows in the Tabele browser open previews.

**Architecture:** New `classes` / `class_groups` / `class_lecturers` tables and `topics.class_id/group_id` in `@studies/db` (migration 0003 + TS backfill). A shared pure `classifyTags` maps Discord tag names to class kind / group number for both bot and backfill. The web explorer keeps all state in URL search params; server components load tree + files; client components render the preview panel and React Flow diagrams (dagre layout).

**Tech Stack:** existing stack (Drizzle/MariaDB, discord.js 14, Next.js 16 webpack, React 19, Tailwind 4, Vitest, Playwright) + `@xyflow/react` 12, `@dagrejs/dagre` 1, `@phosphor-icons/react` 2, `geist` (next font package).

**Spec:** `docs/superpowers/specs/2026-10-10-explorer-hierarchy-design.md` (and the base spec `2026-10-10-studies-db-design.md`).

## Global Constraints

- All constraints of Plans 1–4 still hold (soft delete, studies_ro SELECT-only on `v_*`, Polish UI, requireUser on every page/route, relative redirects, R23 file headers, no `dangerouslySetInnerHTML`).
- Class kinds exactly: `wyklad, laboratorium, cwiczenia, projekt, seminarium`; display names `Wykład, Laboratorium, Ćwiczenia, Projekt, Seminarium`; tree order is that order, then `Bez kategorii` (class NULL).
- Group canonical name `Gr. N` (N = 1…99). Groups belong to a class (never year-wide).
- Migration must be idempotent (run `pnpm db:migrate` twice safely).
- Design language (taste skill): Geist + Geist Mono via the `geist` package; zinc neutrals; single accent emerald (`emerald-600` light / `emerald-500` dark); radii: controls 8 px (`rounded-lg`), panels 12 px (`rounded-xl`), chips full; light+dark via `prefers-color-scheme`; icons only from `@phosphor-icons/react`; no emoji; no em/en dash characters in UI copy; motion only for preview-panel slide (≤150 ms, transform/opacity) and diagram fit-view, disabled under `prefers-reduced-motion`.
- Explorer URL params: `class` (kind or `none`), `group` (number), `topic` (id), `file` (material id), `tab` (`explorer|map|schema`, default explorer). Invalid values are ignored (fall back to nearest valid parent), never 500.

## Review Focus

1. **Tag variants and diacritics** (`Wykład` vs `wyklad`, `Gr.3`, `Grupa 12`, `G3`, `gr 03`, trailing spaces, two class tags) — expected: deterministic classification, first applied wins. → Task 2 table tests.
2. **Concurrent first post in a new class/group** (threadCreate + messageCreate racing) — expected: one class row, one group row, no duplicate-key failure. → Task 3 concurrency test.
3. **Re-tagging a post** (Laboratorium → Ćwiczenia, group removed) — expected: topic moves; empty old group stays in DB but disappears from the tree (non-empty nodes only). → Task 3 + Task 4 tests.
4. **Hand-edited / stale explorer URLs** (`?class=foo&group=abc&file=999999`) — expected: page renders the nearest valid parent, preview closed. → Task 4 parse tests + Task 9 e2e.
5. **Schema diagram drift** (a `v_*` view gains/loses a column, relation map references a missing column) — expected: test fails loudly rather than diagram silently wrong. → Task 7 test.

---

### Task 1: Schema, migration 0003, views

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`
- Create: `packages/db/migrations/0003_*.sql` (drizzle-kit generate) + `packages/db/migrations/0004_hierarchy_views.sql` (custom) and journal entries
- Test: `packages/db/test/hierarchy-schema.test.ts`; update `packages/db/test/schema.test.ts` for the new PUBLIC_VIEWS

**Interfaces:**
- Produces (schema.ts): tables `classes`, `classGroups`, `classLecturers`; `topics.classId`, `topics.groupId`; `CLASS_KINDS = ['wyklad','laboratorium','cwiczenia','projekt','seminarium'] as const`, `type ClassKind`, `CLASS_NAMES: Record<ClassKind,string>`; `subjectLecturers` removed.
- `PUBLIC_VIEWS` becomes `['v_subjects','v_lecturers','v_classes','v_class_groups','v_class_lecturers','v_topics','v_tags','v_topic_tags','v_materials','v_files','v_users']`.

- [ ] **Step 1: Write failing tests** (`resetTestDb`): tables + views exist; `v_topics` has `class_id`,`group_id`; `v_files` returns flat rows (subject_code, class_name, group_name, topic_title, filename…) and hides soft-deleted materials and materials of soft-deleted topics; UNIQUE(subject_id,kind) and UNIQUE(class_id,number) enforced; data migration: seed a `subject_lecturers` row in a DB migrated to 0002, then run remaining migrations → `class_lecturers` row with class of that kind exists and `subject_lecturers` is gone (use drizzle migrator on a fresh DB with a custom folder copy truncated at 0002, or run 0003 SQL manually — implementer's choice, document it); studies_ro_test can SELECT the new views and not `classes`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement schema; `drizzle-kit generate` for tables/columns (FKs per spec §2: classes→subjects CASCADE, class_groups→classes CASCADE, topics.class_id/group_id SET NULL, class_lecturers CASCADE); custom migration for: data move from `subject_lecturers` (INSERT IGNORE classes … SELECT DISTINCT; INSERT class_lecturers … ), `DROP VIEW IF EXISTS v_subject_lecturers`, `DROP TABLE IF EXISTS subject_lecturers`, `CREATE OR REPLACE VIEW` for v_classes, v_class_groups, v_class_lecturers, v_topics (+class_id, group_id), v_files. `ensureReadonlyUser` already revokes + regrants from PUBLIC_VIEWS. Order matters: the data move must run before the drop — put both in the custom migration and have the generated one only add tables/columns (hand-edit the generated SQL to NOT drop subject_lecturers; document).
- [ ] **Step 4:** Run → PASS; `pnpm db:migrate` twice on dev DB → OK; `pnpm --filter @studies/db test` green.
- [ ] **Step 5:** Commit `feat(db): classes, class groups, class lecturers, v_files`.

---

### Task 2: classifyTags, ensureClassAndGroup, backfill

**Files:**
- Create: `packages/db/src/hierarchy.ts`; Modify: `packages/db/src/index.ts`, `packages/db/src/cli/migrate.ts`
- Test: `packages/db/test/hierarchy.test.ts`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces:
  - `classifyTags(tagNames: string[]): { classKind: ClassKind | null; groupNumber: number | null }` — normalise: trim, lowercase, strip diacritics (NFD + remove marks, `ł→l`); class map: `wyklad`→wyklad; `lab|laboratorium|laborki`→laboratorium; `cwiczenia|cw`→cwiczenia; `projekt`→projekt; `seminarium`→seminarium; group regex `^(gr\.?|grupa|g)\s*0*(\d{1,2})$` with value 1…99; first match of each kind wins (array order = Discord applied order).
  - `groupName(n: number): string` → `Gr. ${n}`.
  - `ensureClass(db: DbExecutor, subjectId: number, kind: ClassKind): Promise<number>` and `ensureGroup(db: DbExecutor, classId: number, number: number): Promise<number>` — insert-ignore then select (race-safe).
  - `assignTopicHierarchy(db: DbExecutor, topicId: number, subjectId: number, tagNames: string[]): Promise<{ classId: number | null; groupId: number | null }>` — uses classifyTags; group only when class present; updates topics row.
  - `backfillTopicHierarchy(db: Db): Promise<number>` — for topics with `class_id IS NULL` and not deleted, read their tag names (topic_tags join tags, ordered by tags.id) and call assignTopicHierarchy; returns updated count. Called by the migrate CLI after migrations.

- [ ] **Step 1: Write failing tests:** classifyTags table: `['Wykład']`→wyklad; `['LAB','Gr. 3']`→laboratorium,3; `['Ćwiczenia','Gr.3']`; `['cw','grupa 12']`→cwiczenia,12; `['G3']` alone → class null, group 3 (classify returns both; assign ignores group without class); `['gr 03']`→3; `['Gr. 0']`,`['Gr. 100']` → group null; `['Kolokwium']`→nulls; `['Laboratorium','Ćwiczenia']`→laboratorium; `[' wyklad ']`. ensureClass/ensureGroup: `Promise.all` of 5 concurrent calls → same id, 1 row. assignTopicHierarchy: sets ids; with group tag but no class → groupId null; re-run with different tags moves topic. backfill: topics with tags get classified, already-classified untouched, returns count.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; migrate CLI logs `backfilled <n> topics`.
- [ ] **Step 4:** Run → PASS; `pnpm db:migrate` on dev → backfills demo topics.
- [ ] **Step 5:** Commit `feat(db): tag classification and topic hierarchy backfill`.

---

### Task 3: Bot — classify on sync, lecturer assign by class

**Files:**
- Modify: `apps/bot/src/sync.ts`, `apps/bot/src/commands/admin.ts`, `apps/bot/src/commands/definitions.ts`, `apps/bot/src/commands/router.ts`, `apps/bot/README.md`
- Test: `apps/bot/test/sync.test.ts`, `apps/bot/test/commands.test.ts`

**Interfaces:**
- Consumes: `assignTopicHierarchy`, `ensureClass`, `ensureGroup`, `CLASS_KINDS`, `CLASS_NAMES`, `groupName` (Task 2), `classLecturers` (Task 1).
- Produces:
  - `upsertTopic` (existing signature unchanged) additionally calls `assignTopicHierarchy` with the names of the thread's applied tags in `t.tagIds` order (resolve names from `tags` by discord_tag_id, preserving order).
  - `assignLecturer(db, i: { subjectCode: string; lecturerId: number; classKind: ClassKind; groupNumber?: number })` → reply `"Przypisano prowadzącego do <CODE> / <ClassName>."` or `"Przypisano prowadzącego do <CODE> / <ClassName>, Gr. N."`; duplicate assignment = no-op success (check existing row first because NULL group_id is not unique-enforced); unknown subject / lecturer messages as before.
  - Slash command `/lecturer assign subject lecturer class:<choice of 5 kinds, Polish names> [group:int 1–99]` (replaces `role`).
  - `LECTURER_ROLES` / `LecturerRole` removed; anything still importing `subjectLecturers` updated.

- [ ] **Step 1: Write failing tests:** upsertTopic with applied tags [Laboratorium, Gr. 3] → topic class laboratorium + group 3; threadUpdate re-tag to [Ćwiczenia] → class cwiczenia, group null; two concurrent upsertTopic for two different new threads in the same new class/group → single class + group row, both topics assigned; assignLecturer with/without group, duplicate no-op, definitions JSON has `class` choices and optional `group` with min 1 max 99.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; README: add the forum-tag list (Wykład, Laboratorium, Ćwiczenia, Projekt, Seminarium, Gr. 1…Gr. N) to setup and the manual checklist.
- [ ] **Step 4:** Run → PASS; `pnpm test` (all packages) green.
- [ ] **Step 5:** Commit `feat(bot): class/group from forum tags; lecturer assign per class`.

---

### Task 4: Web data layer — tree, files, explorer state, home cards

**Files:**
- Create: `apps/web/lib/explorer.ts`; Modify: `apps/web/lib/queries.ts`, `apps/web/app/(app)/page.tsx`
- Test: `apps/web/test/explorer.test.ts`, update `apps/web/test/queries.test.ts`

**Interfaces:**
- Produces (`lib/explorer.ts`):
  - `type ExplorerParams = { classKind: ClassKind | 'none' | null; group: number | null; topic: number | null; file: number | null; tab: 'explorer' | 'map' | 'schema' }`
  - `parseExplorerParams(sp: Record<string, string | string[] | undefined>): ExplorerParams` (pure; invalid → null; tab default 'explorer').
  - `explorerHref(code: string, p: Partial<ExplorerParams>): string` (omits null/default params; stable param order class, group, topic, file, tab).
- Produces (`lib/queries.ts`):
  - `type TreeTopic = { id: number; title: string; fileCount: number }`, `type TreeGroup = { id: number; number: number; name: string; fileCount: number; topics: TreeTopic[] }`, `type TreeClass = { id: number | null; kind: ClassKind | 'none'; name: string; fileCount: number; lecturers: { name: string; title: string | null; groupName: string | null }[]; groups: TreeGroup[]; topics: TreeTopic[] /* topics without group */ }`
  - `getSubjectTree(db, subjectId): Promise<TreeClass[]>` — non-deleted only; non-empty nodes only (fileCount > 0 OR topic exists? → rule: include topics even with 0 files, include groups/classes that contain ≥1 topic); fixed class order then 'none' ("Bez kategorii"); ≤ 4 queries total.
  - `resolveSelection(tree, p: ExplorerParams): ExplorerParams` — drops invalid segments (group not in class, topic not under selection…).
  - `listExplorerFiles(db, subjectId, sel: ExplorerParams, opts: { tagId?: number; q?: string; sort?: 'topic'|'filename'|'created'|'uploader'; dir?: 'asc'|'desc' }): Promise<ExplorerFile[]>` with `ExplorerFile = { id, filename, topicId, topicTitle, className, groupName, previewKind, status, uploader, createdAt, sizeBytes, discordUrl }` (cap 500 rows).
  - `getExplorerFile(db, subjectId, materialId): Promise<ExplorerFile | null>` (null if not in subject or deleted).
  - `listSubjectsOverview` returns `classes: { kind, name }[]` instead of lecturers by role; home page renders class chips.
- [ ] **Step 1: Write failing tests** (test DB, seeded hierarchy incl. soft-deleted topic/material, class with no topics, topic without class): tree shape/order/counts; 'none' bucket; resolveSelection drops `group` not under `class`, unknown topic, file from another subject; parseExplorerParams junk (`class=foo`, `group=abc`, `group=0`, `file=-1`, arrays); explorerHref round-trip; listExplorerFiles filters by class/group/topic/tag/q and sorts; overview class chips.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; update home page.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(web): subject tree, explorer state and file queries`.

---

### Task 5: Explorer UI (tab 1), design foundation

**Files:**
- Modify: `apps/web/package.json` (add `@phosphor-icons/react`, `geist`), `apps/web/app/layout.tsx` (Geist fonts, base tokens), `apps/web/app/globals.css`, `apps/web/app/(app)/subjects/[code]/page.tsx`, `apps/web/app/(app)/topics/[id]/page.tsx` (redirect to explorer `?topic=`), `apps/web/components/SqlConsole.tsx` + `app/(app)/sql/page.tsx` (read initial `q`)
- Create: `apps/web/components/explorer/ExplorerShell.tsx` (header, breadcrumb, tabs), `ExplorerTree.tsx`, `ExplorerTable.tsx`, `PreviewPanel.tsx` (client; desktop side panel / mobile full-screen sheet; reuses `FilePreview`), `apps/web/lib/sql-prefill.ts`
- Test: `apps/web/test/sql-prefill.test.ts`, Playwright additions in Task 9

**Interfaces:**
- Consumes: Task 4.
- Produces:
  - `buildExplorerSql(code: string, sel: { className?: string; groupName?: string; topicId?: number }): string` (`lib/sql-prefill.ts`) → e.g. `SELECT filename, topic_title, class_name, group_name, created_at FROM v_files WHERE subject_code = 'MECH' AND class_name = 'Laboratorium' AND group_name = 'Gr. 3' ORDER BY created_at DESC` (single quotes in values doubled).
  - `PreviewPanel` props `{ file: ExplorerFile | null; closeHref: string }` — shows FilePreview + filename, topic, size (`formatBytes`), Pobierz (`/files/id/original`), Pełny ekran (`/files/id/preview`, new tab, only when previewKind ≠ none and status ready), Otwórz w Discordzie (when discordUrl); "Plik został usunięty" when file prop null but `file` param set.
  - Tree/table links built with `explorerHref`; selection highlight uses accent; icons Phosphor (CaretRight/CaretDown, FilePdf, FileText, FileImage, File, DownloadSimple, ArrowsOut, X).
- [ ] **Step 1: Write failing test** `buildExplorerSql` (escaping `O'Brien`, minimal and full selections).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement page + components per spec §4.1 and Global Constraints design language (empty state "Brak plików w tej grupie", skeleton not needed for server-rendered table; mobile `< 768px`: tree → `<select>` breadcrumb, preview → fixed full-screen sheet with close link).
- [ ] **Step 4:** `pnpm --filter @studies/web test`, lint, build → green. Manual: dev server, Mechanika explorer renders with demo data.
- [ ] **Step 5:** Commit `feat(web): subject explorer with tree, table and preview panel`.

---

### Task 6: Mapa danych tab (React Flow)

**Files:**
- Modify: `apps/web/package.json` (add `@xyflow/react`, `@dagrejs/dagre`)
- Create: `apps/web/lib/graph-layout.ts`, `apps/web/components/explorer/DataMap.tsx` (client)
- Test: `apps/web/test/graph-layout.test.ts`

**Interfaces:**
- Consumes: `TreeClass[]`, `ExplorerParams`, `explorerHref`.
- Produces:
  - `buildDataMapGraph(subject: { code: string; name: string }, tree: TreeClass[], sel: ExplorerParams): { nodes: MapNode[]; edges: MapEdge[] }` where `MapNode = { id: string; label: string; count: number; kind: 'subject'|'class'|'group'|'topic'|'more'; href: string; selected: boolean; position: { x: number; y: number } }`, `MapEdge = { id: string; source: string; target: string; selected: boolean }`; ids `s`, `c:<kind>`, `g:<groupId>`, `t:<topicId>`, `m:<groupId|kind>`; left→right dagre layout (rankdir LR, nodesep 24, ranksep 80, node 180×44); groups with > 15 topics show the first 15 + a `more` node ("+ N tematów") linking to the explorer for that group; `selected` true for the selection path.
  - `DataMap` renders React Flow (custom node component, fitView, pan/zoom, no node dragging/connecting), click → `router.push(node.href)`.
- [ ] **Step 1: Write failing tests:** node/edge counts for seeded tree, ids, selected path flags, `more` node at 16+ topics, positions finite and distinct, 'none' class node present when present in tree.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; import `@xyflow/react/dist/style.css` once in the client component; dark-mode styles via CSS variables. Empty state when tree empty: "Brak tematów. Oznacz posty na forum tagami klasy i grupy."
- [ ] **Step 4:** tests, lint, build green. **Step 5:** Commit `feat(web): data map tab with react flow`.

---

### Task 7: Schemat bazy tab + /schema

**Files:**
- Create: `apps/web/lib/schema-relations.ts`, `apps/web/components/SchemaDiagram.tsx` (client), `apps/web/app/(app)/schema/page.tsx`
- Modify: `apps/web/app/api/schema/route.ts` (add relations), header nav in `(app)/layout.tsx` (add "Schemat" link), `apps/web/lib/graph-layout.ts` (schema layout helper)
- Test: `apps/web/test/schema-relations.test.ts`

**Interfaces:**
- Produces:
  - `SCHEMA_RELATIONS: { from: { view: PublicView; column: string }; to: { view: PublicView; column: string } }[]` covering: v_classes.subject_id→v_subjects.id; v_class_groups.class_id→v_classes.id; v_class_lecturers.class_id→v_classes.id; v_class_lecturers.lecturer_id→v_lecturers.id; v_class_lecturers.group_id→v_class_groups.id; v_topics.subject_id→v_subjects.id; v_topics.class_id→v_classes.id; v_topics.group_id→v_class_groups.id; v_topic_tags.topic_id→v_topics.id; v_topic_tags.tag_id→v_tags.id; v_tags.subject_id→v_subjects.id; v_materials.topic_id→v_topics.id; v_materials.uploader_id→v_users.id; v_files.topic_id→v_topics.id; v_files.material_id→v_materials.id.
  - `selectionPath(sel: ExplorerParams): { views: PublicView[]; caption: string | null }` (subject→v_subjects; +class→v_classes; +group→v_class_groups; +topic→v_topics; +file→v_materials, v_files); caption e.g. `Gr. 3 jest w v_class_groups`.
  - `buildSchemaGraph(columns: Record<PublicView, string[]>, highlight: PublicView[]): { nodes; edges }` (dagre LR, node height from column count).
  - `/api/schema` returns `{ columns, relations: SCHEMA_RELATIONS }`.
  - `SchemaDiagram` props `{ columns, relations, highlight: PublicView[], caption: string | null }`; table node shows view name + columns (Geist Mono), relation columns marked; click → `/tables/<view>`.
- [ ] **Step 1: Write failing tests:** every relation endpoint column exists in the live `listViewColumns` result (test DB) — the drift guard; every PUBLIC_VIEW appears as a node; selectionPath for each depth; highlighted edges = relations between highlighted views.
- [ ] **Step 2:** FAIL. **Step 3:** Implement tab inside ExplorerShell + global `/schema` page (no highlight). Errors from RO pool → existing `roErrorMessage`.
- [ ] **Step 4:** tests, lint, build green. **Step 5:** Commit `feat(web): schema diagram with selection path`.

---

### Task 8: Tabele — file cells open preview

**Files:**
- Modify: `apps/web/lib/cells.ts`, `apps/web/components/DataGrid.tsx`, `apps/web/app/(app)/tables/[view]/page.tsx`
- Create: `apps/web/components/TablePreviewDrawer.tsx` (client), `apps/web/app/api/material/[id]/route.ts` (returns `ExplorerFile` JSON for the drawer; requireUser; 404 for deleted)
- Test: `apps/web/test/cells.test.ts` (extend), `apps/web/test/material-route.test.ts`

**Interfaces:**
- Produces: `previewColumn(view: PublicView): string | null` → `'id'` for v_materials, `'material_id'` for v_files, else null; also the `filename`/`original_filename` cell in those views gets the same action. Table page passes `?preview=<id>` in URL (preserving view query params); drawer reads it and fetches `/api/material/<id>`; close link removes the param. Reuses `PreviewPanel` from Task 5.
- [ ] **Step 1: Write failing tests:** previewColumn mapping; toCells marks preview cells for those views only; route: 200 JSON for valid, 404 for deleted, redirect without session.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** tests, lint, build green. **Step 5:** Commit `feat(web): open file previews from table browser`.

---

### Task 9: E2E, seed fixtures, docs

**Files:**
- Modify: `apps/web/e2e/global-setup.ts` (seed classes, groups, topics with hierarchy), `apps/web/e2e/smoke.spec.ts` or new `apps/web/e2e/explorer.spec.ts`, `docs/deploy.md`, `apps/bot/README.md` (if not done)

- [ ] **Step 1:** E2E: open `/subjects/MECH`, click Laboratorium → Gr. 3 → a file → preview panel visible (PDF canvas); URL contains `class=laboratorium&group=3&file=`; switch to Mapa danych → node "Gr. 3" highlighted, click topic node → back in explorer with topic selected; Schemat bazy → caption mentions `v_class_groups`; stale URL `?class=foo&group=abc&file=999999` renders tree without error and no panel; mobile viewport 375 px: select-based breadcrumb visible, opening a file shows full-screen sheet with close; `/tables/v_files` click filename → drawer opens; `/sql?q=SELECT%201` prefills editor.
- [ ] **Step 2:** Run `pnpm --filter @studies/web e2e` → all pass (paste output in report).
- [ ] **Step 3:** docs/deploy.md: "Forum tags" section (exact tag list) + note that `pnpm db:migrate` runs the backfill.
- [ ] **Step 4:** `pnpm lint && pnpm test && pnpm --filter @studies/web build` green.
- [ ] **Step 5:** Commit `test(web): explorer e2e; docs: forum tag setup`.
