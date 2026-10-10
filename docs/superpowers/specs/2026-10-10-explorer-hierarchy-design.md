# Studies DB — Class/Group Hierarchy, Subject Explorer & Database Diagrams

**Date:** 2026-10-10
**Status:** Draft — awaiting review
**Builds on:** `2026-10-10-studies-db-design.md` (all of its constraints still apply)

## 1. Purpose

Students want to browse each subject like its own small database:
**subject → class (Wykład / Laboratorium / …) → group (Gr. 3) → topic → file**,
open file previews directly from table rows, and see the structure visually —
both the actual contents of a subject and the database schema behind it.

**Success criteria**

- A forum post tagged `[Laboratorium] [Gr. 3]` in `#mechanika` lands under
  Mechanika › Laboratorium › Gr. 3 › *post title* without any extra student action.
- On a subject page a student can drill down the tree and open any file's preview
  next to the table, without leaving the page (desktop) or with one tap (mobile).
- File rows in the global "Tabele" browser open the same preview.
- A "Mapa danych" tab shows the subject's classes, groups and topics as a clickable
  node graph with file counts.
- A "Schemat bazy" tab shows all public `v_*` views, their columns and relations,
  generated from the live database, highlighting the path of the current selection.
- `SELECT * FROM v_files WHERE subject_code = 'MECH'` gives a flat per-subject file
  table in the SQL console.

**Non-goals**

- No physical per-subject tables and no auto-generated per-subject views.
- No editing of the hierarchy from the website (Discord + admin commands only).
- No year-wide groups: a group always belongs to one class of one subject.

## 2. Data Model Changes (migration 0003)

```
subjects ─< classes ─< class_groups
              │             │
              └──< topics >─┘     topics.class_id NULL, topics.group_id NULL
                     └─< materials
classes ─< class_lecturers >─ lecturers      (class_lecturers.group_id NULL)
```

**classes** (new)
| column | type | notes |
|---|---|---|
| id | INT PK AI | |
| subject_id | FK subjects ON DELETE CASCADE | |
| kind | ENUM('wyklad','laboratorium','cwiczenia','projekt','seminarium') | |
| name | VARCHAR(50) | display name: Wykład, Laboratorium, Ćwiczenia, Projekt, Seminarium |
| | UNIQUE (subject_id, kind) | |

**class_groups** (new)
| column | type | notes |
|---|---|---|
| id | INT PK AI | |
| class_id | FK classes ON DELETE CASCADE | |
| number | SMALLINT | 1…99 |
| name | VARCHAR(20) | canonical "Gr. 3" |
| | UNIQUE (class_id, number) | |

**topics** — add `class_id INT NULL FK classes (ON DELETE SET NULL)`,
`group_id INT NULL FK class_groups (ON DELETE SET NULL)`, index on both.
Invariant (enforced in app code): if `group_id` is set, its class equals `class_id`.

**class_lecturers** (new, replaces `subject_lecturers`)
| class_id | FK classes ON DELETE CASCADE |
|---|---|
| lecturer_id | FK lecturers ON DELETE CASCADE |
| group_id | FK class_groups NULL ON DELETE CASCADE |
| PK | surrogate `id INT AI` + UNIQUE (class_id, lecturer_id, group_id); MariaDB treats NULLs as distinct in UNIQUE, so the insert path checks for an existing (class, lecturer, NULL) row first |

**Data migration (same migration, idempotent):**
1. For each `subject_lecturers` row: ensure `classes(subject_id, kind=role)` exists, insert
   `class_lecturers(class_id, lecturer_id, NULL)`. Role mapping: wyklad→wyklad,
   laboratorium→laboratorium, cwiczenia→cwiczenia, projekt→projekt.
2. Drop `subject_lecturers` and `v_subject_lecturers`.
3. Backfill topics from existing `topic_tags` using the tag mapping in §3
   (done by a TS backfill step in the migrate CLI, since it reuses the parser).

**Public views (granted to studies_ro), changes:**
- `v_classes` (id, subject_id, kind, name)
- `v_class_groups` (id, class_id, number, name)
- `v_class_lecturers` (class_id, lecturer_id, group_id)
- `v_topics` gains `class_id, group_id`
- `v_files` — flat, non-deleted materials of non-deleted topics:
  `material_id, subject_code, subject_name, class_name, group_name, topic_id,
  topic_title, filename, mime_type, size_bytes, preview_kind, status, uploader,
  created_at`
- removed: `v_subject_lecturers`
- `PUBLIC_VIEWS` updated accordingly (table browser + grants follow it).

## 3. Discord Mapping (bot)

Forum tags on a post are classified (case- and diacritic-insensitive, trimmed):

| Tag text matches | Meaning |
|---|---|
| `wyklad`, `wykład` | class kind wyklad |
| `lab`, `laboratorium`, `laborki` | laboratorium |
| `cwiczenia`, `ćwiczenia`, `cw`, `ćw` | cwiczenia |
| `projekt` | projekt |
| `seminarium` | seminarium |
| `/^(gr\.?|grupa|g)\s*(\d{1,2})$/` | group number |
| anything else | ordinary tag (as today) |

- Pure function `classifyTags(tagNames: string[]): { classKind: ClassKind | null; groupNumber: number | null }` in `@studies/db` (shared by bot + backfill). If several class tags are applied, the first in Discord's applied order wins; same for groups.
- `upsertTopic` (bot) ensures `classes(subject, kind)` and `class_groups(class, number)`
  exist (insert-or-get, race-safe on the unique keys) and sets `topics.class_id/group_id`.
  Group without class tag → `group_id = NULL`. No class tag → both NULL ("Bez kategorii").
- Tag changes on a thread (threadUpdate / catch-up) re-classify the topic.
- All tags (including class/group ones) still go to `tags`/`topic_tags` as today.
- Admin command `/lecturer assign` changes to `subject lecturer class:<kind> [group:<number>]`
  writing `class_lecturers`. Reply copy: `"Przypisano prowadzącego do <CODE> / <Klasa><, Gr. N>."`.

## 4. Website

### 4.1 Subject page = Explorer (replaces current `/subjects/[code]`)
URL: `/subjects/[code]?class=<kind>&group=<n>&topic=<id>&file=<materialId>&tab=explorer|map|schema`
(all optional; state lives in the URL so links are shareable and back/forward works).

- **Header:** breadcrumb (Mechanika › Laboratorium › Gr. 3) + tabs *Explorer*, *Mapa danych*, *Schemat bazy*.
- **Tree (left, 220 px):** classes in fixed order (Wykład, Laboratorium, Ćwiczenia, Projekt,
  Seminarium, Bez kategorii); under a class its groups (by number) then topics without a group;
  under a group its topics. Each node shows its file count. Only non-empty nodes are shown.
  Lecturers listed under the class name (small, muted).
- **Table (center):** files under the selected node (whole subject when nothing selected):
  columns temat, plik, typ (preview kind chip), autor, dodano; filter by tag chips and
  free-text filename filter; sort by column; "Eksport CSV"; "Otwórz w SQL" opens
  `/sql?q=<prefilled SELECT … FROM v_files WHERE …>` (SqlConsole reads an initial `q` search param into the editor; it does not auto-run).
- **Preview panel (right, 360 px):** opens when a row is clicked (`file=` in URL): the
  existing FilePreview (pdf.js / image / text / none + status badges), filename, topic,
  size, "Pobierz", "Pełny ekran" (opens `/files/<id>/preview` in a new tab), "Otwórz w Discordzie".
- **Mobile (< 768 px):** tree becomes a breadcrumb select above the table; preview opens as a
  full-screen sheet with a close button; diagrams get pinch-zoom.
- `/topics/[id]` stays and links into the explorer (`/subjects/CODE?topic=id`).

### 4.2 Mapa danych tab
- React Flow (`@xyflow/react`) graph laid out left→right with `@dagrejs/dagre`:
  nodes subject → classes → groups → topics; edges along the hierarchy; node label + file count.
- Pan/zoom/fit-view; node click navigates to the explorer selection for that node;
  the current selection (from URL) is highlighted (accent border + edges).
- Large subjects: topics collapsed per group when a group has > 15 topics ("+ N tematów" node, click expands).

### 4.3 Schemat bazy tab (also reachable globally at `/schema`)
- Nodes = every `PUBLIC_VIEWS` entry with its columns (live from `information_schema`, existing
  `listViewColumns`). Edges from a fixed relation map in `lib/schema-relations.ts`
  (e.g. `v_topics.class_id → v_classes.id`, `v_files.topic_id → v_topics.id`).
- Highlight path: for the current selection, highlight the views + edges on the path
  (subject → v_subjects, class → v_classes, group → v_class_groups, topic → v_topics,
  file → v_materials/v_files) with a short caption, e.g. "Gr. 3 jest w v_class_groups (id 7)".
- Clicking a view opens `/tables/<view>`; on the global `/schema` page nothing is highlighted.
- Rendered client-side; data fetched via `/api/schema` (extended to return relations).

### 4.4 Tabele (global table browser)
- In views that contain a material id (`v_materials.id`, `v_files.material_id`), that cell and the
  filename cell become buttons that open the same preview panel (right side drawer; full-screen
  sheet on mobile). Other views unchanged.

### 4.5 Home page
- Subject cards link to the explorer; card shows class chips (e.g. Wykład · Lab · Ćw.)
  instead of the current lecturer-by-role list.

## 5. Design Language (taste skill, adapted to a data tool)

Reading: data-browsing tool for students, clean and quiet, Tailwind 4 + Geist / Geist Mono,
zinc neutrals with one emerald accent (selection, primary button, highlighted path).
- One accent everywhere; one radius system (controls 8 px, panels 12 px, chips full);
  light + dark via `prefers-color-scheme`; no emoji; no em/en dashes in UI copy
  (topic titles from users are shown verbatim); icons from `@phosphor-icons/react` only
  (tree chevrons, file-type icons, download, expand).
- Motion: minimal and motivated only — preview panel slide-in (150 ms, transform/opacity),
  diagram fit-view transition; all disabled under `prefers-reduced-motion`.
- States: skeleton rows while loading, empty states ("Brak plików w tej grupie"),
  inline errors (incl. RO-pool busy message from earlier work).

## 6. Error Handling

| Case | Behaviour |
|---|---|
| Unknown `class`/`group`/`topic`/`file` in URL | ignored segment, explorer falls back to the nearest valid parent; invalid `file` closes the panel |
| File soft-deleted while panel open | preview shows "Plik został usunięty" |
| Conflicting tags (two class tags) | first applied tag wins; deterministic |
| Group tag on a post without class tag | group ignored (topic under class NULL) |
| Migration run twice | idempotent (IF NOT EXISTS / insert-or-ignore / backfill only where class_id IS NULL) |
| Diagram with 0 classes | empty state with hint how to tag posts in Discord |

## 7. Testing

- **db:** migration creates tables/views; data migration from `subject_lecturers`; `classifyTags`
  table tests (Polish diacritics, `Gr.3`, `Grupa 12`, `G3`, junk); backfill; `v_files` hides deleted;
  studies_ro can read new views, not base tables.
- **bot:** upsertTopic sets class/group from tags; concurrency (two upserts creating the same
  class/group); tag change re-classifies; `/lecturer assign` new signature.
- **web:** queries for tree + counts; explorer URL-state parsing; schema relations map covers every
  FK-like column of PUBLIC_VIEWS (test asserts relation endpoints exist in live columns); Tabele file
  cell → preview; e2e: drill Mechanika › Laboratorium › Gr. 3, open preview, switch to Mapa danych and
  Schemat bazy (highlight visible), mobile viewport sheet.

## 8. Rollout

Single deploy: migrate (0003 + backfill) → bot → worker (unchanged) → web. README / deploy.md:
tell admins to add forum tags `Wykład, Laboratorium, Ćwiczenia, Projekt, Seminarium, Gr. 1 … Gr. N`
in every subject forum.
