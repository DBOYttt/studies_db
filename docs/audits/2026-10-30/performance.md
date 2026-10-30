# Performance audit (2026-10-30)

Scope: `main` at `73e0c3f` (41 commits since the 2026-10-25 audit merge `b78ea64`: iCal group import, admin round 2,
seed, follow-ups). Static review of `packages/db/src`, `apps/web/{app,lib,components}`, `apps/bot/src` pollers and
reminders, `apps/worker/src`. Index use was checked with `EXPLAIN` (SELECT/EXPLAIN only, no temporary tables, no
writes, no `ANALYZE TABLE`) on the QA sandbox DB `studies_qa_test`, which has every migration up to `0025`.

**Caveat:** the sandbox is tiny (129 class sessions, 37 events, 23 materials, 37 audit rows, 20 bot requests). On tables
this small the planner often picks a full scan even when a good index exists. So "full scan" findings below rest on the
query shape: a predicate no index can serve, or an unbounded `IN (subquery)`. They are not latency measurements. No
build, no test run and no page timing were done this round.

Counts: Medium 3 · Low 10

## Status of the 2026-10-25 findings

| Finding | Status | Evidence |
|---|---|---|
| H1 CodeMirror / React Flow in first load | **Held** | `components/lazy-tabs.tsx` wraps `SqlConsole`, `DataMap` and `DesignerDiagram` in `next/dynamic`. `subjects/[code]` and `tables/[view]` import only the lazy versions. No client component imports a value from `@studies/db` (only `import type`) or from a server-only `lib/*` module. |
| M1 `bot_requests (kind, target)` index | **Held** | `idx_bot_requests_kind_target` is live. The enqueue locking read is `ref const,const,const` and uses the index only. Finished rows are pruned after 30 days (`pruneBotRequests`). |
| M2 audit LEFT JOIN, target index, no count on event pages | **Held** | `listAuditRows` uses a LEFT JOIN. `eventHistory` skips the count. The target query is `range` on `idx_admin_audit_target`. |
| M3 / M4 nav counts and subject cards | **Held** | `lib/count-cache.ts` keeps them for 60 s. View counts still run on the RO pool (see P1), but only about once a minute. |
| M5 file routes | **Held** | `lib/http-files.ts:126-145` selects only the 7 columns it uses. Sends a sha256 ETag, answers `If-None-Match` with 304, and marks originals `immutable`. Bodies are streamed (`createReadStream` → `Readable.toWeb`), not buffered. No full-row `.select()` on `materials` remains anywhere. |
| L1 recent-files index | **Held** | `idx_materials_recent` is used (`range`, no filesort) for `ORDER BY created_at DESC, id DESC LIMIT 5`. |
| L4 event page query count | **Held** | `getEvent` is one join plus the topic links. The event page loads the rest in a single `Promise.all`. |
| L5 `finalizeStuckMaterials` | **Held** | `range` on `idx_materials_status`. |
| L6 pdf.js worker caching | **Held** | Versioned file name plus `cacheHeaderRules()` (`immutable`). |
| L7 pruning | **Mostly held** | Sessions and login tokens are purged daily. `jobs` and `bot_requests` are pruned at 30 days. `reminder_log` is still never pruned (P11). |
| L2, L8, L9 | Still open, deferred as before | Not re-reported. |
| L3 snippet before LIMIT | Still open, **and now costlier** | See P9. |

## Findings

### P1. Timetable and start-page queries share the 4-connection read-only pool with the user SQL console (Medium)
- **Where:**
  - `apps/web/lib/db.ts:27-46`: `RO_POOL_OPTIONS.connectionLimit: 4`, with mysql2's default unbounded queue and no
    acquire timeout.
  - App queries on this pool:
    - `components/plan/PlanWeekTab.tsx:86-104` (sessions, events, group options, marks, plus `openingWeek`);
    - `app/(simple)/s/page.tsx:33` (`upcomingForUser`: events plus group options);
    - `components/plan/GroupsTab.tsx:19`;
    - `lib/event-form-page.ts`;
    - `app/(app)/page.tsx:26`;
    - the per-minute `countViewRows`.
  - User SQL on the same pool: `lib/sql-console.ts:113` (`runReadonlyQuery`) holds a connection for the whole statement
    (up to 5 s of `max_statement_time`, plus a 0.5 s watchdog grace, plus a 1 s hard stop), then **destroys** it
    (`:88-95`). The `/sql` console, `/api/sql`, the table CSV export, `/s/reports` and its CSV all go through it. The
    rate limit is 30 statements per minute per user (`:246`).
- **Impact:**
  - Four students running heavy console queries at the same time take every RO connection for up to about 6.5 s.
  - Every `/plan`, `/s/plan`, subject timetable tab and `/s` start page then queues behind them.
  - One `/plan` render alone issues up to 5 parallel RO queries, so it can fill the pool by itself.
  - Each destroyed connection means a new TCP and auth handshake for the next request that borrows one.
- **Fix:**
  - Give the fixed application queries their own pool. They are trusted, constant SQL over the `v_*` views, so they can
    run on the main pool (`getDb()`'s mysql2 pool; the main user can read the views) or on a second `studies_ro` pool
    with `connectionLimit: 4`. `studies_ro` has `MAX_USER_CONNECTIONS 10`, so 4 + 4 still leaves 2 for watchdog
    `KILL` connections.
  - Keep user SQL alone on the current 4-connection pool.
  - Optionally, set `queueLimit` or an acquire timeout on the user-SQL pool, so a saturated console answers "busy"
    instead of hanging.

### P2. "Upcoming events" on `/s` scans and sorts every event on every load (Medium)
- **Where:**
  - `packages/db/src/events.ts:821-834` (`listUpcomingEvents`) filters on
    `END_SQL >= ?` (`:750-751`: `CASE WHEN e.all_day THEN starts_at + INTERVAL 1 DAY ELSE COALESCE(ends_at, starts_at)
    END`). No index can serve that expression.
  - Called from `apps/web/lib/upcoming-events.ts:30` with `SCAN = 100` on every load of `/s`, the default landing page
    of the default (simple) mode.
- **Evidence:** EXPLAIN gives `v_events e  type=ALL  rows=32  Using where; Using filesort`, even though
  `idx_events_starts` exists. Events are only ever soft-deleted, and every series occurrence is its own row (20 of the
  37 sandbox events). The table therefore only grows, and this query reads and sorts all of it.
- **Fix:** add a sargable lower bound next to the exact test:
  `WHERE e.starts_at >= ? - INTERVAL <max span> AND <END_SQL> >= ?`. Here `<max span>` is the longest allowed event
  (clamp `ends_at - starts_at` in `validateEvent`, for example to 31 days, if it isn't clamped already). The range on
  `idx_events_starts` then reads only recent rows, and `ORDER BY starts_at, id LIMIT 100` can stop early.

### P3. `/admin/sync` loads up to 20 full reports (60 000 chars each) and reloads them every 3 s (Medium)
- **Where:**
  - `packages/db/src/bot-requests.ts:221-252`: `listAdminBotRequests` selects `report` (MEDIUMTEXT, capped at
    `MAX_REPORT` = 60 000) for all 20 rows.
  - `app/(app)/admin/sync/page.tsx:57-60` and `:148-156` render every report inside a closed `<details>`.
  - `components/admin/AutoRefresh.tsx:17`: `router.refresh()` every 3 s while a request is queued or running. A resync
    or setup can run for minutes.
- **Impact:**
  - Worst case is about 1.2 MB of report text per render, sent twice on a full load (HTML plus the RSC flight data).
  - It is then re-fetched as RSC every 3 s for as long as the request runs, together with the session, plan-status and
    request queries.
  - Only the newest one or two reports are ever opened.
- **Fix:**
  - List the rows without `report`, adding `LENGTH(report) AS report_len` for the "show" affordance.
  - Load the report on demand: a `/admin/sync/[id]` page or route, or only the newest finished request.
  - Alternatively, send a 2 KB preview in the list.
  - Optionally, have `AutoRefresh` back off (3 s, 6 s, 12 s, up to 30 s) and pause while `document.hidden`.

### P4. Group options re-scan all class sessions on every start page, timetable and panel view, uncached (Low)
- **Where:** `packages/db/src/plan.ts:455-470` (`listMyGroupOptions`) and the same shape in
  `plan-marks.ts:62-75` (`listMarkableClasses`). Both filter with
  `c.id IN (SELECT class_id FROM v_class_sessions WHERE class_id IS NOT NULL)`. Callers:
  - `/s` (P2's `upcomingForUser`);
  - every timetable with My groups (`PlanWeekTab.tsx:98`);
  - the My groups tab;
  - the bot `#panel` (`apps/bot/src/ui/student.ts:286,347,391,460,472,482`).
- **Evidence:** EXPLAIN shows `class_sessions` as `type=ALL` under a DuplicateWeedout semi-join (`Start temporary …
  End temporary`). The view also drags its joins to `subjects`, `classes`, `class_groups` and `lecturers` into the
  subquery. Rewritten as `EXISTS (SELECT 1 FROM class_sessions cs WHERE cs.class_id = c.id)` against the base table,
  the plan is `ref` on `class_sessions_class_id_classes_id_fk`, `Using index; FirstMatch`: index-only, one probe per
  class.
- **Fix:** use `EXISTS` on `class_sessions` in both functions (add `AND cs.kind = 'class'` for the markable one). The
  set only changes on a timetable sync, so it can also go behind a `ttlCache` (60 s) in the web.

### P5. Default-week timetable: 4-step waterfall, the current week fetched twice, `MIN`/`MAX` over a join (Low)
- **Where:**
  - `app/(app)/plan/page.tsx:52` awaits `getPlanSyncStatus` before `PlanWeekTab` starts.
  - `components/plan/PlanWeekTab.tsx:41-62` (`openingWeek`) runs `sessionRange`, then the current week's
    sessions and events. Then `:91-99` fetches the same week's sessions and events again, and `:100` loads the marks
    only after that.
  - `lib/plan-queries.ts:69-83` (`sessionRange`) runs `MIN/MAX(starts_at) FROM v_class_sessions`.
- **Evidence:**
  - Without `?week` (every nav link to `/plan` and `/s/plan`), a render is status → range → [sessions, events] →
    [sessions, events, links, options, groups] → marks. That is 5 serial DB steps and 2 duplicate queries.
  - EXPLAIN of `sessionRange`: `cs ALL … BNL join` through the view. The same `MIN/MAX` on the base `class_sessions`
    is `Select tables optimized away` (index ends only).
- **Fix:**
  - Have `openingWeek` return the rows it loaded, and reuse them when the chosen week is the current week.
  - Start `getPlanSyncStatus` in parallel, or render it in its own `<Suspense>`.
  - Run `sessionRange` on `class_sessions` directly when there is no filter. A filter needs only `subject_id`,
    `class_id`, `group_id` and `lecturer_id`, which are all base columns.
  - Load marks by class id from the session list's subjects in the same `Promise.all`, or accept the one dependent
    query.

### P6. Count queries whose result is thrown away, and rows→count run one after the other (Low)
- **Where:**
  - `apps/web/lib/admin-overview.ts:34` calls `listAudit(… limit 10)`, which always counts the whole `admin_audit`
    table (`packages/db/src/audit.ts:106-117`). The overview uses `audit.rows` only.
  - `apps/web/lib/simple-queries.ts:163-176` (`listSimpleFiles`) runs the page query, *then* a `COUNT(*)` over all
    live materials. EXPLAIN of that count: `materials ALL`, a clustered scan of the wide rows. `/s` (`page.tsx:30`)
    asks for 5 rows and never reads `total`.
  - `packages/db/src/admin-lists.ts:141-156` (`listUsersAdmin`): rows, then the count, serially.
- **Fix:**
  - Overview: call `listAuditRows`.
  - `listSimpleFiles`: add a `withTotal: false` option for `/s`, and run rows and count in `Promise.all` where both are
    needed. Do the same in `listUsersAdmin`.

### P7. Queue claims sort every candidate before `LIMIT 1` while holding `FOR UPDATE` (Low)
- **Where:**
  - `apps/worker/src/queue.ts:29-40` (`claimJob`):
    `status='queued' AND run_after <= now ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED` on
    `idx_jobs_status_run_after (status, run_after)`.
  - `packages/db/src/bot-requests.ts:75-83` (`claimNextBotRequest`): `status='queued' AND kind IN (…) ORDER BY id`.
- **Evidence:**
  - Neither `ORDER BY` matches its index, so InnoDB reads and locks every due or queued row in the range before the
    filesort. Under REPEATABLE READ it keeps the locks on rows the `kind` filter rejects.
  - The bot now has **two** consumers (the event poller and the admin poller, each every 5 s). EXPLAIN in the sandbox
    picks a PRIMARY scan (`type=index`), which locks from the oldest row onward.
  - The claim transaction lasts milliseconds, so the visible effect is small. During a backlog (a resync ingesting
    hundreds of files), the second worker loop's or the other poller's `SKIP LOCKED` sometimes sees nothing. It then
    sleeps a full poll (3 s or 5 s) while work is waiting.
- **Fix:**
  - Jobs: `ORDER BY run_after, id`, which matches the index, so `LIMIT 1` stops after one row and locks one row.
  - Bot requests: an index `(status, kind, id)`, with one claim query per kind, or `(status, id)` together with a
    `kind` check after the claim.

### P8. Audit log "Action" filter and its total scan the whole table (Low)
- **Where:**
  - `packages/db/src/audit.ts:69` filters on `action = ?`.
  - The page (`app/(app)/admin/audit/page.tsx:38-45`) also counts the total.
  - The indexes are `idx_admin_audit_created_at`, `idx_admin_audit_target (target, action, id)` and the `user_id` FK
    (`schema.ts:311-313`), but none on `action` alone.
- **Evidence:** EXPLAIN of `action='sql.rejected' ORDER BY id DESC LIMIT 50` gives `PRIMARY index … Using where`, a
  backwards scan until 50 rows match. For a rare action that means the whole table, twice (rows, then count).
  `admin_audit` is never pruned, by design, and every console statement and every event or quiz change adds a row.
- **Fix:** add `idx_admin_audit_action (action, id)` through a normal `drizzle-kit generate` migration. The user filter
  is already served by the FK index (`user_id`, then PK).

### P9. Search snippets now read two MEDIUMTEXT columns per hit before the LIMIT (Low; L3 carried forward)
- **Where:** `packages/db/src/search.ts:123-125` computes
  `SUBSTRING(COALESCE(m.extracted_text, …), GREATEST(1, LOCATE(?, COALESCE(m.search_text, …)) - 300), 1000)` for
  every FULLTEXT hit inside the derived table, before `ORDER BY score DESC LIMIT n`.
- **New since L3:**
  - Migration 0023 added `search_text`, a `STORED` generated MEDIUMTEXT copy of `extracted_text` (with ł folded), and
    0024 moved `ft_materials` onto it.
  - Each hit now reads both off-page texts, up to 16 MB each.
  - Storage, buffer-pool use and backups carry every extracted text twice. STORED is needed for the FULLTEXT index,
    so the duplication itself is the accepted trade-off.
- **Fix:** as in L3, rank and `LIMIT` ids in the inner query, then compute `body` in an outer join on those ids.

### P10. Admin edits of subjects don't refresh the 60 s nav cache (Low; a side effect of the M3 fix)
- **Where:**
  - `apps/web/lib/admin-actions.ts:80-84` (`refresh`) and `:236` only call `revalidatePath`.
  - `invalidateCounts()` (`lib/count-cache.ts:55`) is called from the event, entry-quiz and SQL-console paths, but not
    from the admin Server Actions.
- **Impact:** a subject added or renamed on `/admin/subjects` is missing from, or stale in, the advanced nav tree and
  the simple subject cards for up to 60 s, including for the admin who made the change.
- **Fix:** call `invalidateCounts()` in `refresh()` (or at least after subject and class writes).

### P11. `reminder_log` is never pruned (Low; L7 remainder)
- **Where:** `schema.ts:523-536`. The only writes are inserts (`markSent`). No delete exists in `packages/db`, the bot
  or the worker.
- **Impact:** one row per DM per opted-in user per event, plus one per digest entry. Lookups use
  `uq_reminder_log (event_id, …)` and stay fast, so the cost is growth only.
- **Fix:** in the worker's daily `pruneQueues`, delete rows whose `for_starts_at` is older than 60 days.

### P12. No streaming anywhere: no `loading.tsx` and no page-level `<Suspense>` (Low)
- **Evidence:**
  - `find apps/web/app -name loading.tsx` finds nothing.
  - `<Suspense>` appears only in three shell components (`ModeSwitch`, `NavPanel`, `AdminNavLink`).
  - Every page is `force-dynamic` and waits for its slowest query before sending any byte.
- **Impact:** small today (sub-15 ms renders in the 2026-10-25 audit). Under P1 contention or P5's waterfall, though,
  a navigation gives no feedback until the whole page is ready. Dynamic routes with a `loading.tsx` also get their
  loading shell prefetched.
- **Fix:**
  - Add a `loading.tsx` (a skeleton of the content pane) under `app/(app)` and `app/(simple)/s`.
  - Wrap the timetable (`PlanWeekTab`) and the start page's upcoming-events card in `<Suspense>` so the shell and the
    subject cards stream first.

### P13. Minor shapes (Low, grouped)
- **`applyGroupImport`** (`packages/db/src/unitime/group-import.ts:330-336`): up to 100 serial
  `INSERT … ON DUPLICATE KEY UPDATE`s in one transaction. Use one multi-row insert with
  `ON DUPLICATE KEY UPDATE group_id = VALUES(group_id)`. The rest of the import is well batched: 3 `IN` queries, and
  the fetch is streamed with a 2 MB cap and a timeout.
- **`syncTimetable`** (`packages/db/src/unitime/sync.ts:355-358`):
  - Issues one `UPDATE` per changed session, serially, inside the single sync transaction. A feed-wide change (for
    example a `SEQUENCE` bump on every entry) means hundreds of round trips while the row locks are held. Reads stay
    unblocked (MVCC); only concurrent writers to `class_sessions` (console DML) wait.
  - Option: group the changed rows and `INSERT … ON DUPLICATE KEY UPDATE` on `uq_class_sessions_occurrence` in chunks
    of 500, as the inserts already are.
- **`getSubjectAdmin`** (`packages/db/src/admin-lists.ts:37`): `UPPER(code) = ?` cannot use `subjects_code_unique`.
  The collation is already case-insensitive (`utf8mb4_unicode_ci`), so `eq(subjects.code, code)` gives the same
  result. The table is tiny.
- **`dueEntryQuizzes`** (`apps/bot/src/reminders.ts:247-256`): on a day with no entry quizzes, `memory.quizDate` is
  never set. The week's sessions and marks are therefore re-read every minute from 18:00 to 18:30 (about 60 queries a
  day). Remember "checked, none" for that day too.
- **`lastBotRequest`:** `ORDER BY id DESC` after `kind, target` uses `idx_bot_requests_kind_target` with a filesort,
  because `status` sits between `target` and `id` in the index. There are only a few rows per target, so this is
  harmless.

## Idle DB load (from code)

Changed since 2026-10-25: the bot gained a second 5 s poller (`startAdminRequestPoller`, `apps/bot/src/admin-requests.ts:229`).
Bot claims are now about 72 statements per minute (2 pollers × 12 ticks × BEGIN/SELECT/COMMIT), so the total is about
195 per minute. That is still negligible. Per-tick costs otherwise match the last audit:
- worker: claim ×2 every 3 s, and the requeue/finalize/prune sweep every 60 s;
- reminders: 1 range query per minute.

## Notes
- Read-only: only `SELECT`, `SHOW` and `EXPLAIN` were run on `studies_qa_test`, through a guard script that refused
  anything else. No temporary tables, no `ANALYZE TABLE`, and nothing was run against `studies` or `studies_test`.
- No servers were started, no builds or tests were run, and there were no git changes.
