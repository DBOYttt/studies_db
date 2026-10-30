# Import My groups from a personal UniTime calendar (2026-10-29)

## Goal

A student fills My groups in one step from their own UniTime timetable, instead of picking a group for every class by hand. They can do it on the web (simple and advanced modes) and from the Discord `#panel`.

Today the student picks groups one class at a time (`MyGroupsForm`, bot `groupsView`). `MyGroupsImport` only moves an old browser-only choice into the DB. It has nothing to do with iCal.

## What UniTime gives us

- **Personal export:**
  - URL: `https://plan.agh.edu.pl/UniTime/export?x=<token>`. The token is secret and identifies the student.
  - The response is `text/calendar` with `X-WR-CALNAME:Personal Schedule`.
  - It is the same format as the curriculum feed: SUMMARY is the subject (`Chemia ogólna (1rok)`), DESCRIPTION's first line names the class and group (`CWA 2c`, `Wykład 1`, `Ćwiczenia projektowe 1`).
  - On 2026-10-29 the user's own export returned **0 VEVENTs** (only VTIMEZONE). The student's personal timetable is not published in UniTime yet.
  - The feature must therefore say clearly when a calendar has no classes, and must be testable without a real personal feed.
- **Curriculum ("year") export:**
  - `…/export?output=events.ics&type=curriculum&name=O-TPR-1+S1&term=…` has every group of the year (433 events).
  - It cannot tell which groups a student is in, so it is **not** an import source.
  - Tests derive a personal-like fixture from it by keeping one group per class.
- **Sub-groups:** `classifyEvent` reads `CWA 1a`…`CWA 1g` as group 1, the same as the sync does, so the import maps them to the same `class_groups` row the timetable uses.

## Behaviour

### Sources

1. **A URL** the student pastes.
   - Fetched server-side, once, and **never stored or logged**. The full URL never appears in errors, logs or audit rows; messages name only the host.
2. **A `.ics` file** the student uploads (web only).
   - Max 2 MiB, read in memory, never written to `STORAGE_DIR`.

### Fetch rules (shared with the worker sync)

- **Code location:** `fetchTimetable` and `SafeSyncError` move from `apps/worker/src/plan-sync.ts` into `packages/db/src/unitime/fetch.ts`. The worker imports them from there, so its behaviour and tests are unchanged.
- **Constraints on the import fetch:**
  - **https only.**
  - **Host allowlist:**
    - The host must be in `UNITIME_IMPORT_HOSTS`, a comma-separated env var that defaults to `plan.agh.edu.pl`.
    - Also allowed are the hosts of `UNITIME_ICAL_URL` and `UNITIME_EXAM_ICAL_URL` when they are set.
    - Compare in lowercase, with no port other than 443.
    - No userinfo in the URL.
  - **Redirects:** the existing redirect rule (same host only, no downgrade) still holds.
  - **Caps:** 2 MiB and a 15 s timeout, tighter than the worker's.
  - **Content type:** must be `text/calendar`.
- **Rate limit:** 6 imports per user per 10 minutes. This counts both previews and file uploads.
  - Web: `createRateLimiter` in `apps/web/lib/rate-limit.ts`.
  - Bot: an in-memory limiter of the same shape in the bot.
  - Over the limit, the import answers "Too many imports. Try again in a few minutes."

### Matching (pure + one read, in `packages/db/src/unitime/group-import.ts`)

`planGroupImport(db, icsText)` returns a preview. It has no side effects.

1. `parseIcs`, then `classifyEvent` for each VEVENT. A calendar with more than 5000 VEVENTs is refused first ("The calendar has too many entries (max 5000)."). Each event is weighted by its number of occurrences (`countOccurrences`: the rules and caps of `expandOccurrences`, without allocating); an entry with no occurrence left is skipped as `noDates` ("N without dates"). Subject names are matched like the column's collation (case and trailing spaces ignored).
2. **Skipped entries:**
   - exams (`sessionKind = 'exam'`);
   - entries with no class kind;
   - entries with no group number.
   - Each skipped entry is counted under a reason.
3. **Subject:** matched by `subjects.unitime_name = unitimeName`, the exact key the sync uses. A subject that is soft-deleted or missing is **unmatched**. The import never creates subjects, classes or groups.
4. **Class:** matched by `(subject_id, kind)`. **Group:** matched by `(class_id, number)`. Either one missing makes the entry unmatched, with a reason.
5. **Per class, one group:** the group with the most occurrences wins.
   - On a tie between different groups, the class is **ambiguous**. It is listed with its candidates, and nothing is set for it.
6. **Result:**

   ```ts
   {
     calendarName: string | null;
     totalEvents: number;
     matched: { classId, groupId, subjectName, className, groupName, currentGroupId: number | null }[];
     ambiguous: { classId, subjectName, className, groupNames: string[] }[];
     unmatched: { subjectName: string; label: string; reason: 'subject' | 'class' | 'group' }[];  // deduped, max 50
     skipped: { exam: number; noKind: number; noGroup: number; noDates: number };
   }
   ```

   - `matched` is ordered like My groups: by subject name, then class kind order.
   - `currentGroupId` comes from `getMyGroups`, so the UI can show "changes" versus "already set".
7. **No classes:** if the calendar parses but has no VEVENTs, the caller shows "This calendar has no classes yet. UniTime may not have published your timetable; try again later or pick your groups below." The same message applies when every entry was skipped.
8. **Unparseable text:** if the text is not iCalendar, the caller shows "That is not a UniTime calendar (.ics)."

### Applying

- `applyGroupImport(db, userId, pairs)` sets each `(classId, groupId)` pair:
  - it uses the same validity check as `importMyGroups` (one query, the group must belong to the class);
  - it writes in one transaction with an upsert;
  - it **merges**: classes not in `pairs` keep their saved group;
  - it returns `{ set: number, skipped: number }`. Invalid pairs are skipped, never an error.
- **Size cap:** `pairs` is capped at 100 entries: the web client, the web action and the bot keep the first 100. The group check runs inside the transaction (`LOCK IN SHARE MODE`), so a group deleted meanwhile is skipped. A failed save says "Could not save the groups."; unexpected errors are logged as `group import failed:` with only `name`, `code` and `errno`.

### Web

- **Location:** the "My groups" tab (`GroupsTab`, both modes) gets an "Import from UniTime" section above `MyGroupsForm`.
- **Inputs:**
  - a URL field, labelled "UniTime calendar link", with help text on where to find it: UniTime → Personal timetable → Export → iCalendar, copy the link;
  - "or upload a .ics file".
  - The form has a "Preview" button.
- **Preview step:**
  - a server action (`previewGroupImportAction`) runs `requireUser()`, the rate limit, the fetch or file read, and `planGroupImport`;
  - it returns the preview, never the URL.
- **The preview shows:**
  - matched classes with old → new group, or "already set";
  - ambiguous classes;
  - a collapsible list of unmatched entries;
  - skipped counts.
- **Apply step:** "Apply N groups" runs `applyGroupImportAction(pairs)`.
  - This action runs `requireUser()` again and validates each pair as positive ints. `applyGroupImport` re-checks them.
  - On success: "Groups saved: N." `MyGroupsForm` remounts with the stored groups; the existing `key` does this.
- **Style:**
  - UI strings are English; subject and class names stay as stored (Polish).
  - Accessibility: the preview is announced (`role="status"`), errors use `role="alert"`, and buttons use the `aria-disabled` busy pattern.

### Discord (`#panel` → My groups)

- **Entry point:** the My groups view gets an "Import from UniTime" button.
  - custom_id `v1:stu:groups:import`, which opens a modal with one text input, "UniTime calendar link" (max 500).
  - The modal submit (`v1:stu:groups:importsubmit`) defers ephemerally, then fetches with the same rules and runs `planGroupImport`.
- **Apply:** the bot applies the matched pairs right away, without a confirm step. A custom_id cannot carry the pairs, and every change is one click to undo in My groups.
- **Reply:** an ephemeral summary.
  - "Saved N groups", followed by a list of at most 15 lines and "…and K more";
  - ambiguous and unmatched counts;
  - the "no classes yet" message when it applies.
  - The reply ends with the refreshed My groups view.
- **Banned users:** they are refused, like every other student action.

## Out of scope

- Storing the calendar link, or re-syncing groups periodically.
- Creating subjects or groups from a personal feed.
- Importing from the curriculum feed.
- Topic or event import.

## Testing

- **db, pure:**
  - `planGroupImport` matching, against a fixture derived from the year feed: one group per class, 2 subjects not in the DB, one exam, one ambiguous class with a tie, `CWA 2c` → group 2;
  - an empty-calendar fixture.
- **db, DB-backed:**
  - `applyGroupImport` merge semantics: invalid pairs skipped, other classes untouched.
  - `planGroupImport` with `currentGroupId`.
- **fetch:**
  - the moved `fetchTimetable` tests still pass in the worker;
  - new tests for the import guard: https only, allowlist, userinfo, port.
- **web:**
  - action validation and the rate limit, in lib-level tests;
  - one e2e on the simple My groups tab: upload a fixture `.ics`, preview, apply, and check the dropdowns.
- **bot:** the modal submit handler with a fake fetch: summary text, banned refusal, rate limit.
