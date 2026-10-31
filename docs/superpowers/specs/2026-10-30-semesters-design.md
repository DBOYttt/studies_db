# Semesters 1–7 — design

Date: 2026-10-30. Status: approved in chat ("yes go ahead").

## Goal

The server covers every semester of the programme, 1 to 7. Each semester has
its own Discord category with its own subject forums, its own UniTime
timetable feed, and students can narrow the website to one semester.

## What the user decided

- Semesters are fixed: 1–7. No rollover, no archive, no "current semester".
- Discord: one category per semester (`Semestr N`) holding that semester's
  subject forums, built by `/setup`.
- Students: no stored "my semester". The website has a semester switcher on
  lists and the timetable, remembered per browser.
- Timetable: one UniTime class feed (and an optional exam feed) per semester,
  configured by an admin in the web admin panel. The worker syncs each feed
  into its semester.

Assumptions (stated in chat, not contradicted): a subject belongs to exactly
one semester (`subjects.semester`, unchanged); "All semesters" is the default.

## 1. Semester bounds

`SEMESTERS` (`packages/db/src/admin-fields.ts`) becomes `[1, 2, 3, 4, 5, 6, 7]`.
Everything that validates a semester follows it: the bot slash-command choices
(`definitions.ts`), the admin modal parser (`parseSemester`, `SEMESTER_TEXT`
becomes "Semester must be a whole number from 1 to 7."), the web admin forms
and the seed. Type `Semester = (typeof SEMESTERS)[number]`, exported from the
same file, replaces the `1 | 2` literals. The DB column stays `tinyint`.

Seed: add subjects in semesters 3, 5 and 7 (one each is enough, with a class,
a group and a session) so the switcher and `/setup` have something to show.

## 2. Discord

`/setup` already plans one `Semestr N` category per semester that has
subjects and sorts forums by semester then code. Changes:

- Categories are created in numeric order (Semestr 1 … Semestr 7, not by
  string); a semester category created in a later run is appended and may be
  dragged into place. Existing tests extended to 7 semesters.
- A category is recognised as a semester's by `/^\s*semestr\s+(\d+)\s*$/i`
  (so `SEMESTR 3` or `semestr  3` is adopted, not duplicated); a forum under
  any other category is imported as semester 1 with a warning to move it.
- A planner warning (in the dry-run report) when a semester has more than 50
  subjects (Discord's channels-per-category limit); the extra forums are not
  created.
- An emptied semester category is left in place (as today for any category
  the bot did not create content in); `/setup` never deletes channels.
- Bot subject pickers: when more than 25 subjects exist, option labels get a
  semester prefix `S<n> · <code> <name>` so the paged selects stay readable.
  My groups keeps its 3×25 paging; the event modal keeps its text-field
  fallback.

## 3. Per-semester timetable feeds

### Storage

New table `unitime_feeds`:

| column | type |
|---|---|
| `semester` | tinyint, PK, 1–7 (CHECK) |
| `class_url` | varchar(500) NOT NULL |
| `exam_url` | varchar(500) NULL |
| `updated_at` | datetime, default now |
| `updated_by` | int NULL → users.id ON DELETE SET NULL |

The URLs are secrets (personal tokens in the query string). The table is not
in `CONTENT_TABLES` (so `studies_rw` gets no grant) and has no public view. A
URL is never logged, audited, shown in full or put in an error. The web shows
only `host` and a short sha256 fingerprint of the URL (`plan.agh.edu.pl/…#a1b2c3`, no path or query character).

`class_sessions` gets `feed_semester tinyint NULL`: the semester feed that
imported the row, NULL for the env feed (and for rows imported before this
change).

### Validation

`validateFeedUrl(raw, allowedHosts)`: trimmed, at most 500 chars, `https:`
only, no userinfo, host in the allowlist. The allowlist is
`feedAllowedHosts(env)`: `UNITIME_IMPORT_HOSTS` (default `plan.agh.edu.pl`)
plus the hosts of `UNITIME_ICAL_URL` / `UNITIME_EXAM_ICAL_URL`, i.e. the same
list as `importAllowedHosts`. The web checks on save, the worker re-checks
before every fetch with its own env (a feed whose host is not allowed is
skipped with the error "Semester N: host not allowed"). Compose passes
`UNITIME_IMPORT_HOSTS` to the worker too.

Because stored feeds must already be on an allowed host, the personal iCal
import's allowlist needs no change.

### Admin panel

`/admin/sync` gets a "Timetable feeds" card: one row per semester 1–7 with the
class feed and exam feed (masked or "Not set"), an Edit form and a Clear
button. The form has two `type="url"` inputs that are never pre-filled; an
empty class input keeps the stored class URL, an empty exam input keeps the
stored exam URL, and a "Remove exam feed" checkbox clears it. Setting a feed
for a semester with no class URL requires the class URL. Clear removes the row
(with a confirm). Server Actions call `requireAdmin()`, use `getDb()`, and
audit `plan.feed_set` / `plan.feed_clear` with target `semester:<n>`, payload
`{ classHost, examHost }` (hosts only), `source: 'web'`. Saving also calls
`requestPlanSync` so the new feed runs within a minute.

There is no bot command for feeds: pasting secret URLs into Discord is worse
than the web form. `/plan sync` still requests a run of every feed.

### Worker

Each run (`runPlanSyncOnce`):

1. Load `unitime_feeds` ordered by semester. If there are rows, sync each in
   order: class feed with `{ source: 'classes', feedSemester: n }`, then its
   exam feed with `{ allExams: true, source: 'exams', feedSemester: n }`. One
   feed's failure never stops the others.
2. If there are no rows, behave exactly as today with the env feeds
   (`feedSemester` NULL, semesters from `semesterFor`).
3. If there are rows and every configured class feed succeeded, remove the
   remaining `feed_semester IS NULL` sessions (left by the retired env feed;
   rows still in a semester feed were taken over by step 1).

`syncTimetable` scoping: a row missing from the feed is deleted only when its
`source` and `feed_semester` both match the running feed. A row present in the
feed is updated to the running feed's `feed_semester` (takeover; included in
`sameSession`). New subjects created by a semester feed get that semester;
existing subjects are never moved. With no `feedSemester` the old
`semesterFor` rule applies.

Status: `plan_sync` stays one row. `stats` gains
`feeds?: { semester: number; ok: boolean; created: number; updated: number; deleted: number }[]`;
errors are joined as `Semester N: <error>` (URL scrubbed). `planStatusText`
adds one line per semester feed. Totals stay as today.

## 4. Web semester switcher

`lib/semester.ts`:

- `SEMESTER_COOKIE = 'studiesdb.semester'`, value `1`–`7` (missing/other =
  all), 1 year, `sameSite: 'lax'`, not httpOnly (nothing secret).
- `parseSemester(v): Semester | null`.
- `currentSemester(sp)`: `?sem=` wins (`all` → null, `1`–`7` → that), else
  the cookie.
- Route `GET /semester?to=<1-7|all>&next=<path>` (calls `requireUser()`) sets
  or clears the cookie and redirects to `safeNext(next)` with any `sem` param
  removed (fallback `/s`).

Filtered (when a semester is chosen): simple Start subject cards and sidebar,
`/s/subjects`, advanced home and `/subjects` grid and the nav tree, the
timetable (week and list, both modes), the events index and the Start
"Upcoming events" card, search (simple and advanced), and the My groups class
list. Events without a subject always show (they are not tied to a
semester). Today card and My groups saved choices are not filtered (they are
already personal). Admin pages are never filtered; the admin subjects list
shows the semester column and can be sorted by it.

Queries: `PlanFilter` gains `semester?: number`, applied as `s.semester = ?`
on the `v_subjects` join; list and search queries take an optional
`semester` argument the same way. A filter that empties a page shows the
normal empty state plus "Showing semester N only — show all semesters".

UI: a compact segmented control "All · 1 · 2 … 7" in the simple top bar and
the advanced header, listing only semesters that have at least one subject
(plus All; hidden entirely when only one semester has subjects). On phones it
is a native `<select>`. It is a set of links to `/semester?...` (works without
JS). The current choice is `aria-current`. `modeTarget` keeps `?sem`.

## 5. Errors and limits

- A bad `?sem=` value is ignored (treated as no param), never an error.
- A feed save with a bad URL refuses with a field error on that input; the
  message names only the first allowed host.
- A semester feed that returns an empty class calendar fails that feed (as
  today) and leaves its rows alone.

## 6. Testing

- db: `SEMESTERS`; feed CRUD and `validateFeedUrl`; sync scoping (two
  semester feeds don't delete each other's rows; takeover; env-row cleanup
  only after all feeds succeed; new subject gets the feed semester); status
  text per feed; semester filters in plan/list/search queries.
- worker: runs every feed, continues after one fails, skips disallowed hosts,
  never logs a URL, env fallback.
- bot: planner with 7 semesters (order, warning over 50), slash choices 1–7,
  modal parser, label prefix over 25 subjects.
- web: `parseSemester`/`currentSemester`, `/semester` route (`safeNext`,
  clears on `all`), feed actions (admin only, masking, audit payload has no
  URL), queries with semester, switcher rendering rules.
- e2e: switch semester on simple Start and the timetable; the cookie
  survives navigation; "All" restores.
