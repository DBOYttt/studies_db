# Correctness review: b78ea64..main (2026-10-30)

Scope: `git diff b78ea64..main` (iCal group import, admin panel round 2, follow-ups batch), checked against
`docs/superpowers/specs/2026-10-29-ical-group-import-design.md`, `2026-10-29-admin-panel-round2-design.md` and CLAUDE.md.
Read-only review. `pnpm --filter {db,bot,web,worker} typecheck` and `pnpm lint` are clean. DB tests were not run.

Overall the work matches both specs: the fetch guard, rate limits, link secrecy, preview/apply split, the
bot modal flow, the admin queue (named lock plus FOR UPDATE), cancel-only-while-queued, report truncation, boot
recovery and requireAdmin on every page and action are all there and tested. No High findings. The items below
are the risky paths that remain.

| # | Severity | Area |
|---|---|---|
| C1 | Medium | Admin edit forms: lost update from a stale form |
| C2 | Medium | Admin queue: a hung `running` request blocks every new request until the bot restarts |
| C3 | Low | Group import: CPU/memory cost of weighting by occurrences on a hostile 2 MiB calendar |
| C4 | Low | Admin queue: `GET_LOCK` name is server-wide, not per database |
| C5 | Low | Group import: apply errors are reported as a calendar read failure (bot) or swallowed unlogged |
| C6 | Low | Group import (web): more than 100 changes makes Apply fail completely |
| C7 | Low | Group import: subject lookup is collation-insensitive in SQL but exact in JS |
| C8 | Low | Group import: a series with zero expanded occurrences still decides the group |
| C9 | Low | Admin edit: semester/ECTS re-validated even when unchanged |
| C10 | Low | Docs drift |
| C11 | Low | Test gaps |

---

## C1 (Medium): admin edit forms silently revert a concurrent change

**Where:** `apps/web/lib/admin-actions.ts:126-132` (subject), `:173-177` (class), `:221-227` (lecturer).
The forms submit every field, prefilled with `defaultValue` (`components/admin/SubjectForm.tsx:55,85,104`, and the same
in `ClassForm` and `LecturerForm`).

**Scenario:**
1. Admin A opens `/admin/subjects/ANA1` when the name is "Analiza".
2. Admin B (on the web, or with `/subject edit` in Discord) renames it "Analiza matematyczna".
3. A then changes only the ECTS and saves. The action diffs the submitted form against the row it reads now, so
   `v.name ("Analiza") !== cur.name ("Analiza matematyczna")` puts `name` into the patch.
4. B's rename is reverted with no warning. The audit row says A edited `name`, though A never touched it.

The same happens to the semester, description, URL, class assessment and note, and the lecturer's
title/email/hours/room. The "only changed fields" diff was meant to narrow writes. Because it diffs against the
current row rather than the row the form was rendered from, it does not narrow them.

**Fix:** render each editable field's original value into a hidden `orig_<field>` input, or one hidden JSON/hash
of the row. Build the patch from `submitted !== orig`, not `submitted !== cur`. Optionally refuse with "Changed by
someone else, reload" when `orig !== cur` for a field the user also changed. Add a test: edit through the action
with a stale `orig_*`, and check that the other field survives.

## C2 (Medium): a request stuck in `running` blocks the admin queue with no way out from the web

**Where:** `packages/db/src/bot-requests.ts:178-190` (the busy check counts `running`), `:197-211`
(cancel works only on `queued`), `apps/bot/src/admin-requests.ts:179-204`, and `apps/web/app/(app)/admin/sync/page.tsx:277`.

**Scenario:** a web `setup` is claimed, and `runSetup` then never settles (a discord.js REST call stuck behind a
long rate-limit bucket, or a promise that never resolves). Stale `running` rows are only recovered at boot
(`recoverInterruptedAdminRequests`). Until then:
- every new request gets "The bot is already working on a request.";
- the Sync page shows no Cancel button (cancel is for queued rows only) and no stale notice (`isStaleRequest` only
  looks at `queued`);
- the in-process `/setup` lock is also held, so the Discord `/setup` answers busy too.

The admin's only remedy is to restart the bot, and nothing on the page says so.

**Fix:** any one of these:
- (a) in the poller, wrap the run in a timeout (for example 15 min) that fails the request with
  "Setup timed out." and releases the lock. Note the work itself may still be in flight, so keep the lock until it
  settles, or document the overlap.
- (b) in `isStaleRequest`, also flag a `running` request older than N minutes with "The bot seems stuck; restart
  it.".
- (c) allow `failStaleBotRequests(db, now, 30*60_000, ADMIN_REQUEST_KINDS)` on each poller tick.

(b) is the minimum and needs no change to the bot.

## C3 (Low): weighting by expanded occurrences is costly for a hostile calendar

**Where:** `packages/db/src/unitime/group-import.ts:150` (`weight: expandOccurrences(ev).length`) and
`packages/db/src/unitime/ics.ts:245-290`.

**Scenario:** a student uploads a 2 MiB `.ics` file (or links one on the allowlisted host) with about 15–20k minimal
VEVENTs. Each has `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU` and a matching DESCRIPTION. Each event allocates
up to 365 `{start,end}` pairs (the one-year cap applies before the 500 cap). That makes about 7M short-lived objects
and several seconds of synchronous CPU on the Next.js server, or in the bot's event loop for links, where it delays
every interaction and gateway heartbeat. The rate limit is 6 per 10 min per user, and the bot and the web count
separately.

**Fix:** count occurrences without allocating them (a `countOccurrences` that runs the same loop and only
increments), and/or cap the VEVENTs considered (for example 5 000) and the total weight. Parsing is linear and fine.

## C4 (Low): the named lock is shared by every database on the server

**Where:** `packages/db/src/bot-requests.ts:129,149`.

`GET_LOCK` names are global to the MariaDB server. The dev server hosts `studies`, `studies_test` and
`studies_qa_test`, so a web admin enqueue on :3000, an e2e run on :3100 and the QA sandbox on :3200 serialise on
`admin_bot_request`. Under contention one of them waits up to 5 s and then answers "The bot is already working on a
request." even though its own database has no request. This is rare, but it would make a flaky e2e/QA result.

**Fix:** use `CONCAT(DATABASE(), ':admin_bot_request')` as the lock name, in both the GET and the RELEASE.

## C5 (Low): failures after the fetch are mislabelled or invisible

**Where:** `apps/bot/src/ui/student.ts:368-384`, `apps/web/lib/group-import-actions.ts:60-68` and `:91`.

- **Bot:** `applyGroupImport` sits in the same try as the fetch. A DB error, for example an FK violation when the
  sync deletes a `class_groups` row between the validity check and the upsert (the check is outside the
  transaction, `group-import.ts:315-336`), becomes `IMPORT_FAILED` ("Could not read the calendar."). This misleads
  the user, and it is not logged at all.
- **Web:** `previewGroupImportAction` also discards a DB failure in `planGroupImport` with no log line. The
  "never log, the error may embed the link" rule applies only to fetch errors, and those are already
  `SafeSyncError`.

**Fix:**
- log non-`SafeSyncError`/`NotACalendarError` errors with only their `name`/`code`/`errno` (never `message`);
- give the bot's apply step its own catch and message ("Could not save the groups.");
- move the validity check into the transaction (`SELECT … FOR SHARE`-equivalent `LOCK IN SHARE MODE`), or catch
  the FK error per row.

## C6 (Low): web Apply fails outright when there are more than 100 changes

**Where:** `apps/web/lib/group-import-actions.ts:76-86`, `apps/web/components/plan/GroupImport.tsx:96-100`.

The client sends every changed pair. The action refuses the whole array with "Invalid selection." when there are
more than 100. The bot (`student.ts:372`) slices to 100 instead, and `applyGroupImport` slices too. The two paths
are inconsistent. A real personal plan has fewer than 100 classes, so this is an edge case.

**Fix:** slice to `GROUP_IMPORT_MAX_PAIRS` in the client and the action (or let `applyGroupImport` do it), and keep
the strict shape check only for the type.

## C7 (Low): subject matching mixes a case-insensitive SQL filter with an exact JS lookup

**Where:** `packages/db/src/unitime/group-import.ts:155-167` and `:223`.

`inArray(subjects.unitime_name, names)` runs under the column's `_ci` collation, which is also PAD SPACE, so it
ignores case and trailing spaces. `subjectByName.get(e.unitimeName)` is exact. A row that differs only in case or
trailing whitespace (an admin fixing it through the SQL console, or a UniTime casing change) is fetched and then
reported as "subject not in Studies DB". The sync itself uses `eq` (collation semantics), so the two disagree.

**Fix:** key the map with the same normalisation as the collation (`trimEnd().toLowerCase()`, applied to both sides),
or match in SQL.

## C8 (Low): an entry with zero expanded occurrences still picks the group

**Where:** `packages/db/src/unitime/group-import.ts:150,238-258`.

`expandOccurrences` can return `[]`, for example when an RRULE's UNTIL comes before DTSTART or every date is in
EXDATE. The entry then adds weight 0, but it still creates the class's map entry. If it is the only entry for the
class, `top = 0` and that group is matched and applied. If two groups both have 0, the class is "ambiguous".

**Fix:** skip entries with `weight === 0`, or count them under a skipped reason.

## C9 (Low): unchanged semester/ECTS are still validated on edit

**Where:** `apps/web/lib/admin-forms.ts:134-143,203`.

The "a stored value that breaks today's limits must not block editing other fields" rule (lines 83-88) covers
name/description/URL/note/lecturer fields but not semester/ECTS. Suppose a subject has `semester = 3` or `ects = 40`,
written through the SQL console (allowed for `studies_rw`). It cannot be edited at all on the web, and the select
shows 1 because `String(3)` is not an option, so a save would also silently change it to 1.

**Fix:** pass the stored semester/ects to `parseSemesterEcts` and accept them unchanged. Render the stored value as
an extra `<option>` when it is out of range.

## C10 (Low): docs drift

- **Admin round 2 spec, §1:** the spec says `report TEXT NULL`, but the migration and schema use `mediumtext`. The
  code is right (the 60 000-character cap overflows TEXT in utf8mb4), but the spec is stale.
- **iCal spec, Matching:** the spec gives `planGroupImport(db, icsText)`, but the real signature is
  `(db, userId, icsText)`, and `matched[]` gained `currentGroupName`. The spec also says "A subject that is
  soft-deleted … is unmatched", but subjects have no `deleted_at`, so that clause is moot.
- **Config docs:** `.env.prod.example` and `docs/deploy.md` do not mention `UNITIME_IMPORT_HOSTS` (only
  `.env.example` does). `deploy.md` also does not mention that `web` and `bot` now make outbound HTTPS requests to the
  import host. Firewalled deployments need that egress, and `web`/`bot` receive the secret `UNITIME_ICAL_URL` through
  `env_file`, but use it only for its host.
- **Server Action body limit:** `next.config.ts` raises `serverActions.bodySizeLimit` to 3 MB for every Server
  Action, not just the import. That is acceptable, but CLAUDE.md does not mention it. One line in the Web app
  architecture section would stop someone "fixing" it back.
- **Digest thread name:** `DIGEST_THREAD_NAME` is now `📅 Reminders`, but an existing digest thread is reused by its
  stored id and keeps its Polish name `📅 Przypomnienia`. There is no rename step, and neither deploy.md nor the
  `/setup` legacy-rename note says so.

## C11 (Low): test gaps on the risky paths

- No test for C1 (concurrent edit). The admin action tests always edit from a fresh read.
- No test for a `running` admin request older than any threshold (C2), and none showing that the Sync page offers
  no way out.
- **group-import (db):** missing tests for a zero-occurrence entry (C8), a case-only `unitime_name` difference (C7),
  and an over-cap event count or a large BYDAY expansion (C3).
- **Bot import:** "maps fetch and parse failures" covers the fetch and parse errors only. A DB error in
  `applyGroupImport` (C5) is untested.
- **Web import:** missing a test for 101 changed pairs (C6). The e2e covers the upload path only. That is fine,
  because the link path is unit-tested with a fake fetch.
- **`fetchImportCalendar`:** only the size cap is tested through the import wrapper. The 15 s timeout and the
  same-host redirect rule rely on the worker's `fetchTimetable` tests. That is acceptable, since it is one function,
  but one import-level redirect test would pin that `fetchImportCalendar` keeps `redirect: 'manual'`.
