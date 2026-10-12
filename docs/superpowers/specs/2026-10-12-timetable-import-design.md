# Timetable import (UniTime iCalendar), Plan zajęć and Courses+

Date: 2026-10-12. Status: design approved in chat ("yes"), pending spec review.

## Intent

The user listed features for the year's database (student list, courses and
instructors, schedule, organizational matters, contacts) and supplied the
AGH UniTime iCalendar export of the year's timetable, asking to "add it to
database and to schedule", including rooms and lecturers.

Agreed decomposition (one spec → plan → build per round):

1. **This round:** timetable import + Plan zajęć screen + Courses+ fields.
2. Next: web editor (phpMyAdmin-style Wstaw/Edytuj/Usuń, admins only, role
   from the Discord admin role), audit log, admin-entered terms (tests,
   exams, deadlines, cancellations, rector's days).
3. Later: contacts, student profiles (self-entered, opt-in private fields,
   kept out of the open SQL views), organizational (fees, sign-ups,
   announcements).

Agreed role model for all rounds: admins edit everything; every student
edits their own profile, signs up for events and marks their own fees.

Success for this round: after the import runs, the real subjects, class
types, groups, lecturers (with AGH e-mails) and all 433 sessions of the
winter semester are in the database; the existing lecturer/subject pages,
nav tree and Projektant show them; a student can open Plan zajęć, pick
their groups and see their own week with rooms and lecturers.

## Source data (observed 2026-10-12)

`X-WR-CALNAME: O-TPR-1 S1 harmonogram dla Semestr zimowy 2026`,
`X-WR-TIMEZONE: Europe/Warsaw`, UniTime 4.6.1. 433 `VEVENT`s,
2026-10-01 … 2027-01-28, all `STATUS:CONFIRMED`. Every event has
`DTSTART;TZID=Europe/Warsaw`, `DTEND`, `LOCATION`, `UID`, `SEQUENCE`,
`SUMMARY`, `DESCRIPTION`, `DTSTAMP`, `ORGANIZER;CN="…":mailto:…`.
14 events carry `RRULE:FREQ=WEEKLY;UNTIL=…;BYDAY=…` + `EXDATE` (WF).
Lines may be folded (RFC 5545: CRLF + space); text escapes `\n`, `\,`,
`\;`, `\\`.

- `SUMMARY` = subject name, mostly suffixed ` (1rok)`; 9 subjects.
- `DESCRIPTION` = `<type> <group><session letter>\n<lecturer CN>`, e.g.
  `CWL 5b\ndr hab. inż. Malinowski\, P`. The digits are the group; the
  trailing letter only numbers the sessions (`1`, `1a` … `1n`).
- `ORGANIZER;CN="dr hab. inż. Piekło, J":mailto:jarekp60@agh.edu.pl` —
  title + `Surname, Initial`, and e-mail. 23 lecturers.
- `LOCATION` = room, e.g. `D-8 006`, `U-13 Hala II (A)`. 18 rooms.

Type mapping (`DESCRIPTION` first line, accents/case-insensitive):

| Prefix | Class kind | Group |
|---|---|---|
| `Wykład` | `wyklad` | digits |
| `CWA`, `Ćwiczenia audytoryjne` | `cwiczenia` | digits |
| `CWL`, `Ćwiczenia laboratoryjne`, `Laboratorium` | `laboratorium` | digits |
| `Ćwiczenia projektowe`, `Projekt` | `projekt` | digits |
| `Zajęcia seminaryjne`, `Seminarium` | `seminarium` | digits |
| `Zajęcia praktyczne` | `praktyczne` (new) | digits |
| `Hala <code>-<n>` (WF) | `wf` (new) | `n`; group name `<K|M>-<n>` from the code's `_K`/`_M` |

An unknown prefix is imported with kind `null` (no class/group), its
first line kept as the session label, and counted as a warning in the
sync status.

## 1. Schema (migration 0006)

- `classes.kind` enum gains `praktyczne`, `wf`, appended after the
  existing five (`CLASS_KINDS`: wyklad, laboratorium, cwiczenia, projekt,
  seminarium, praktyczne, wf;
  `CLASS_NAMES`: `Zajęcia praktyczne`, `WF`). Forum tag aliases add
  `praktyczne`, `zajęcia praktyczne`, `wf`, `wychowanie fizyczne`.
- `subjects.discord_channel_id` becomes NULLable (unique kept; MariaDB
  allows many NULLs). New `subjects.platform_url varchar(500) NULL`,
  `subjects.unitime_name varchar(200) NULL UNIQUE` (the SUMMARY it was
  imported from, before stripping).
- `lecturers`: `email` gets a UNIQUE index (NULLs allowed);
  new `office_hours varchar(200) NULL`, `room varchar(100) NULL`.
- `classes`: new `assessment enum('egzamin','kolokwium','projekt',
  'sprawozdania','zaliczenie') NULL`, `assessment_note varchar(300) NULL`,
  `platform_url varchar(500) NULL`.
- `class_groups.name` stays varchar(20); WF names `M-128` fit.
- New `class_sessions`: `id`, `uid varchar(100)`, `occurrence_start
  datetime` (UNIQUE (`uid`,`occurrence_start`)), `subject_id` FK,
  `class_id` FK NULL, `group_id` FK NULL, `lecturer_id` FK NULL,
  `label varchar(100)` (DESCRIPTION first line), `room varchar(100)`,
  `starts_at datetime`, `ends_at datetime` (local Europe/Warsaw wall time,
  like the rest of the app), `status enum('confirmed','cancelled')`,
  `sequence int`, `updated_at`. Index on `starts_at`.
- New singleton `plan_sync` (`id` = 1): `requested_at`, `last_run_at`,
  `last_ok_at`, `last_error text`, `stats json` (created/updated/deleted/
  warnings).
- Views: `v_subjects`, `v_lecturers`, `v_classes` gain the new columns
  (appended last); new `v_class_sessions` (`id, starts_at, ends_at,
  subject_id, subject_name, class_id, class_kind, class_name, group_id,
  group_name, lecturer_id, lecturer_name, room, label, status`). Granted
  to the RO user; added to `PUBLIC_VIEWS`, `SCHEMA_RELATIONS` (subject,
  class, group, lecturer) and the designer default layout. `plan_sync` is
  not a public view.

## 2. Import (`packages/db/src/unitime/`)

Pure parts, unit-tested against a trimmed fixture of the real file with
lecturer e-mails replaced by `@example.edu` addresses:

- `parseIcs(text): IcsEvent[]` — unfold lines, split VEVENTs, decode text
  escapes, read `TZID` local times, `RRULE` (weekly with `UNTIL`, `BYDAY`)
  and `EXDATE`. Other RRULE shapes → event imported once + warning.
- `expandOccurrences(ev): {start, end}[]` — weekly expansion minus EXDATEs.
- `classifyEvent(ev): { subjectName, kind, groupNumber, groupName, label,
  lecturer: { title, name, email } | null, room, status }` — table above;
  `subjectName` strips a trailing ` (1rok)`/` (Nrok)`; lecturer
  `"dr hab. inż. Piekło, J"` → title `dr hab. inż.`, name `J. Piekło`
  (no comma → whole CN is the name, title from known prefixes `prof.`,
  `dr hab.`, `dr`, `mgr`, `inż.`).
- `subjectCode(name, taken): string` — uppercase initials of words ≥ 3
  letters plus words that are acronyms/digits (`Przemysł 4.0` → `P40`,
  `Programowanie w języku Python` → `PJP`), ASCII-folded, max 20; suffix
  `-2`, `-3` on collision.

Database part `syncTimetable(db, icsText, now): SyncStats` in one
transaction:

1. Upsert subjects by `unitime_name` (create with generated code, semester
   from the year in X-WR-CALNAME → winter semester = 1 for "1rok",
   ects 0; never rename an existing subject).
2. `ensureClass`/`ensureGroup` (existing helpers) for kind/group.
3. Upsert lecturers by e-mail (create with parsed title/name; existing
   rows keep their edited name/title).
4. Ensure `class_lecturers` (class, lecturer, group) rows.
5. Upsert `class_sessions` by (`uid`, `occurrence_start`), updating when
   `sequence` or any field differs; delete sessions whose (`uid`,
   occurrence) is no longer in the feed; `STATUS:CANCELLED` → status
   `cancelled`.
6. Never deletes subjects, classes, groups, lecturers, assignments or
   anything from Discord.

Running it twice on the same feed changes nothing (stats all zero).

## 3. Scheduling

- `UNITIME_ICAL_URL` in `.env` (documented in `.env.example` without the
  real value, and in `docs/deploy.md`). Never committed, never stored in
  the DB, never logged (logs show only the host).
- The worker runs a sync loop: at start, then every 6 h, and within one
  poll interval when `plan_sync.requested_at` is newer than
  `last_run_at`. Fetch with a 30 s timeout, max 5 MB, must be
  `text/calendar`; on error `last_error` is set and existing sessions are
  kept.
- Bot: new admin command `/plan sync` (sets `requested_at`, replies with
  the last sync status) and `/plan status`.
- `/subject add` with the `code` of an existing subject that has no
  channel links the channel to it instead of failing.
- `/lecturer add|edit` get `office_hours`, `room` options; `/subject edit`
  gets `platform_url`; a new `/class edit subject kind assessment note
  platform_url` sets the class fields. (Web editing arrives in round 2.)

## 4. Plan zajęć (web)

New route `/plan` (nav tree node "Plan zajęć" under studies_db, above
Przedmioty; db tab strip gains "Plan"). phpMyAdmin look, light + dark.

- **Tydzień** (default): Mon–Fri columns (Sat/Sun columns appear only if
  that week has sessions), rows 7:00–20:00 at 15-minute resolution.
  Session blocks coloured per class kind (seven colours derived from the
  existing tokens, readable in both themes), showing subject short name,
  kind + group, room, lecturer. Overlapping sessions sit side by side.
  Cancelled sessions are struck through with "Odwołane". Clicking a block
  opens a side panel (like PreviewPanel) with full details and links to
  the subject (class+group), lecturer and `v_class_sessions` row.
- `?week=YYYY-Www` (ISO week) with ‹ Poprzedni, Dziś, Następny › links;
  default is the current week, or the first week with sessions when the
  current week is outside the semester.
- **Lista**: the same sessions as a ResultGrid of `v_class_sessions`
  (server paging), showing its SQL like other grids.
- **Moje grupy**: a form listing every (subject, class kind) with its
  groups as a select ("Wszystkie" default); saved in localStorage
  `studiesdb.myGroups.v1` as `{ "<class_id>": <group_id> }`; when set,
  the week view shows only matching sessions plus sessions with no group
  (lectures). A banner says "Filtr: Moje grupy (zmień)".
- Subject screen gains a **Plan** tab (that subject's sessions, week view
  with the same navigation); lecturer page gains a **Plan** tab.
- Footer of `/plan`: "Ostatnia synchronizacja: <time>" from `plan_sync`
  (error text shown to everyone as "Synchronizacja nie powiodła się —
  pokazuję ostatnie dane").

## 5. Courses+ display

- Subject header: platform link ("UPeL / platforma ↗") when set; per class
  link on class rows when set.
- Prowadzący tab and lecturer page header: office hours, room.
- Subject screen class rows / nav: assessment type label + note.

## Error handling

- Fetch/parse failure: sync aborts before writing; previous data stays;
  status records the error.
- Unknown type prefix / unsupported RRULE: imported as described, counted
  in `stats.warnings` with the label.
- A subject later renamed in the feed: new `unitime_name` → new subject
  (old one keeps its files); documented, rare.

## Testing

- Unit: `parseIcs` (folding, escapes, TZID, RRULE+EXDATE), `classifyEvent`
  for every table row and WF, lecturer CN parsing, `subjectCode`.
- DB: `syncTimetable` on the fixture creates the expected counts; second
  run = zero changes; edited feed (changed room, removed event, cancelled
  event) updates/deletes/marks correctly; never deletes subjects or
  lecturers; existing lecturer matched by e-mail keeps its name.
- Web: week computation helpers (ISO week, layout of overlapping blocks),
  `v_class_sessions` week query; e2e: `/plan` shows a seeded week, Moje
  grupy filter hides other groups and persists across reload, block opens
  the details panel, subject Plan tab.

## Out of scope (later rounds)

Web editor/roles/audit; admin-entered exams, deadlines, cancellations and
days off; student profiles and "my groups" stored server-side; iCal export;
contacts; organizational features.
