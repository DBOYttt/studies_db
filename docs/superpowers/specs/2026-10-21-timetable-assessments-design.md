# Timetable assessments: tests on sessions, entry quizzes, exams

Decided with the user on 2026-10-21. UI words follow `docs/glossary.md`: wejściówka = **Entry quiz**, kolokwium =
**Test**, egzamin = **Exam**.

## Intent

Students read the timetable to see what each class session holds. Three things are missing:
- a kolokwium happens *during* a particular class session and should be marked on that session;
- a wejściówka happens at the start of *every* session of a class (or one group of it);
- egzaminy take place in the exam weeks after the semester, scheduled like classes but they are exams.

Success: a student opens the week view and sees "Test" or "Entry quiz" on the right lab, and exam weeks that read like
a timetable of exams; the same in the Discord plan images and panel.

## Decisions

| Question | Decision |
|---|---|
| How a kolokwium on a session looks | a badge on the existing session block, no separate block |
| How a wejściówka is set | a setting on the class (optionally one group), every session gets it, with "not this week" exceptions |
| Where exams come from | imported from UniTime where available and added by hand otherwise |
| UniTime exam source | probably the main feed; for now support both the main feed and an optional second feed |
| Kolokwium on a session | stays a full event (Discord post, reminders, files, history), shown as a badge |
| Who may set entry quizzes | any non-banned student (wiki-style, audited, admin can restore) |
| Approach | match events to sessions by time (no stored link) |

## 1. Data (`packages/db`)

### Test → session badge (no schema change)

A `kolokwium` event is shown as a badge on a session when all hold:
- the session has `kind = 'class'` and `status = 'confirmed'`;
- same `subject_id` and same `class_id`;
- the event's `group_id` is empty or equals the session's `group_id` (an event without a group marks every group's
  session at that time);
- the event's `starts_at` lies in `[session.starts_at, session.ends_at)` on the same wall-clock day.

An event that matches no session stays a normal event block. Only `kolokwium` turns into a badge. One pure function
`matchEventsToSessions(sessions, events) → { badges: Map<sessionKey, EventRef[]>, unmatched: Event[] }` in
`packages/db` (no I/O) is shared by web and bot.

### Entry quiz: `class_marks`, `class_mark_skips`

`class_marks`:
- `id` int PK
- `class_id` int FK → classes, ON DELETE CASCADE, NOT NULL
- `group_id` int FK → class_groups, ON DELETE CASCADE, NULL (= every group of the class)
- `kind` enum(`wejsciowka`) NOT NULL (enum leaves room for more weekly marks)
- `note` varchar(200) NULL
- `created_by`, `updated_by` int FK → users
- `created_at`, `updated_at` datetime
- `deleted_at` datetime NULL (soft delete)
- `version` int NOT NULL DEFAULT 0 (optimistic concurrency, as on `events`)

At most one non-deleted mark per (`class_id`, `group_id`, `kind`); enforced in code inside the transaction with
`SELECT … FOR UPDATE` (MariaDB has no partial unique index). The group must belong to the class. A group mark is
refused while an all-groups mark of the same class and kind is active ("Entry quiz is already on for all groups of
this class."); overlaps made before that rule are tolerated. Turning on an all-groups entry quiz hides any existing group marks of
that class and kind on the timetable (the all-groups mark takes precedence), and restoring a group mark is refused
while an all-groups one is on.

`class_mark_skips` ("not this week"):
- `id` int PK, `mark_id` int FK → class_marks ON DELETE CASCADE, `on_date` date, `created_by` int FK → users,
  `created_at` datetime; UNIQUE (`mark_id`, `on_date`).

Keyed by date, so a skip survives the sync re-creating sessions. A skip may only be added for a date on which the
mark's class/group has a confirmed session.

A session shows the Entry quiz badge when an active mark exists for its class and (its group or no group), the
session is a confirmed class session, and no skip exists for that mark on the session's date. When both apply, the
all-groups mark is shown (it takes precedence over the group mark). Skipping an all-groups mark skips every group
that day, so its button says "Not this week (all groups)" (web popover, session panel and the Discord select).

### Exams in `class_sessions`

- New column `kind` enum(`class`, `exam`) NOT NULL DEFAULT `class`.
- Exam sessions keep subject, room and lecturer from the feed; `class_id` stays NULL and `group_id` is stored NULL
  (a group needs a class).

### Views, grants, audit

- New views `v_class_marks`, `v_class_mark_skips` (deleted marks hidden; skips of deleted marks hidden);
  `v_class_sessions` (or the existing plan view) exposes `kind`. Add them to `PUBLIC_VIEWS`.
- `studies_rw` gets DML on `class_marks` and `class_mark_skips` (content tables).
- Audit actions (`admin_audit`): `class_mark.add`, `class_mark.edit`, `class_mark.remove`, `class_mark.restore`,
  `class_mark.skip`, `class_mark.unskip`.
- Migrations: one generated by `drizzle-kit generate`, one custom for the views. Never `drizzle-kit push`.

### Domain functions (`packages/db/src/class-marks.ts`)

`addMark`, `editMark` (expected version), `removeMark` (soft), `restoreMark` (admin), `skipDate`, `unskipDate`,
`listMarks(classIds)`. Each returns `{ ok: true, … } | { ok: false, message }` like `events.ts`, runs in
`withTxRetry`, refuses banned users, and audits.

## 2. Timetable display

### Website week/day view (simple and advanced)

- **Test badge** on a matched session: kind symbol + "Test", event title as tooltip, links to the event page. Several
  tests on one session: one badge "2 tests". The event is not drawn again as a block or in the all-day strip.
- **Entry quiz badge** on marked sessions (not on skipped dates, not on cancelled sessions). Clicking opens a
  popover: the note, "Not this week" and "Edit".
- A kolokwium whose session was cancelled (or moved) no longer matches and shows as a normal event block.
- **Exam blocks**: exam sessions from UniTime and `egzamin` events are drawn like class blocks (filled; time, room,
  lecturer) in a separate exam colour, labelled "Exam"; the legend gets the colour. My groups filtering applies; an
  exam without a group shows for everyone following the subject.
- No exam-period setting: weeks after the semester simply contain only exam blocks.
- Duplicate exam: an `egzamin` event with the same subject starting within ±60 min of an imported exam session is
  shown once, as the imported block. The block still opens the session panel, which links the event ("Open event").

### Bot

- `/plan` week and day images and the panel's day list show the same markers (week: "Laboratorium Gr. 2 · Test" /
  "· Entry quiz"; day: one extra line per badge); exams in the exam colour.
- The 18:00 digest lists entry quizzes of tomorrow as "Entry quiz: <subject>, <class> <group>". Reminder DMs stay for
  events only (no weekly entry-quiz DMs).

## 3. Adding and editing

### Test on a session

- Web event form: when the type is Test and a class is chosen, a "Pick a session" select lists the class/group's
  upcoming confirmed sessions ("Wed 21 Oct, 10:00–11:30 · B-2 202"); picking one fills date, time and room (still
  editable).
- Each session block on the timetable offers "+ Test", opening the form prefilled (subject, class, group, session).
- Saving is the normal event save (version check, audit, Discord post, reminders).
- Discord `/event` and the panel modal are unchanged; when the saved time falls inside a session the confirmation adds
  "Shown on <class> <group>, <date>".

### Entry quiz

- Web, class page (simple and advanced): section "Entry quiz every session" — choose all groups or one group, optional
  note, "Turn on". When on: "Turn off", the note (editable, with the version check) and the skipped dates with "Undo".
  The timetable popover offers "Not this week".
- Turning on an already active mark → "Entry quiz is already on for this class." (no duplicate).
- Discord `#panel` class view: "Entry quiz: on/off", "Not this week" with a select of the next sessions. Admin restore
  appears where event restore does (admin panel audit view and `#admin-panel`).
- Entry-quiz changes post nothing to Discord; the digest covers them.

## 4. UniTime exams

- `classify.ts` recognises exam entries by the type at the start of the line or summary (folded, longest prefix
  first): `egzamin`, `exam`, `egz.`, `zaliczenie`, `kolokwium zaliczeniowe` → stored with `kind = 'exam'` instead of
  the "Unknown class type" warning.
- Optional `UNITIME_EXAM_ICAL_URL`: read by the worker in the same 6 h loop and on `/plan sync`; every entry in this
  feed is an exam. A failure of this feed is recorded like a class-feed failure (no URL leak) and does not stop the
  class feed.
- Re-sync uses the existing upsert by `uid` + occurrence start; an exam missing from its feed is removed like a
  class. Each feed removes only its own rows (`source`). The same `uid` + start in both feeds belongs to the exam
  feed: the exam sync takes the row over, and the class sync leaves `source = 'exams'` rows alone.
- When the main feed starts carrying exams, the prefix rule picks them up; another word is a one-line addition.

## Error handling

- Mark on a deleted class, a group not in the class, or a skip for a date without a session → short English message,
  nothing saved.
- Concurrent "Turn on" → one mark; the other gets "Entry quiz is already on for this class.". Stale note edit → the
  events' conflict message.
- Banned users cannot change marks (web and Discord).
- `.env.example` documents `UNITIME_EXAM_ICAL_URL`.

## Testing

- db: `matchEventsToSessions` (inside, at start, at end, other group, no group, cancelled, other day, exam session);
  marks (add, duplicate, concurrent add, edit with stale version, skip/unskip, skip without a session, remove, restore,
  banned, audit rows); classifier exam prefixes; second-feed sync; exam dedup rule.
- web: plan view models (badges, "2 tests", exam blocks, skipped date, cancelled fallback); session picker options;
  e2e: turn an entry quiz on, skip a week and see the badge disappear; add a Test via "+ Test" and see the badge.
- bot: week/day image lines and panel day list with badges; panel entry-quiz buttons; digest line; Discord limits.

## Out of scope

- Grades or results of tests.
- A configurable exam-period date range.
- Entry-quiz reminder DMs.
- Fixing `/setup` dropping plain topic tags (separate round 2 item).
