# Performance audit (2026-10-25)

Scope: PLAN.md section 2. Branch `chore/security-audits`, Next 16.4.3 (webpack). Production build
(`NEXT_DIST_DIR=.next-perf`, `next build --webpack`, `next start -p 3300`) with the env from
`apps/web/scripts/qa-serve.mjs`, against the QA sandbox DB `studies_qa_test` and `.qa/storage`. Logged in as the
`student` and `curator` personas through `POST /auth/callback`.

How it was measured:
- **TTFB:** curl, 3 warm-ups, then 20 sequential requests per URL.
- **Queries per page:** a `--require` preload on the server process subscribed to mysql2's `diagnostics_channel`
  tracing (`mysql2:query` / `mysql2:execute`). No global DB setting was changed: the general log and
  performance_schema were not touched.
- **EXPLAIN / ANALYZE:** run as the test admin user on `studies_qa_test`. For the scale tests, the rows lived in
  session-only `TEMPORARY` tables (50k `bot_requests`, 100k `admin_audit`), so no shared data changed.
- **Client metrics:** Playwright Chromium (PerformanceObserver for LCP, CLS and long tasks; CDP for bytes), median
  of 3 cold runs.

**Caveat:** the sandbox is tiny (22 materials, 126 class sessions, 72 audit rows, 34 bot requests). Every page answers
in under 15 ms, so the TTFB numbers are a floor. The DB findings rest on index analysis and on the scaled
temporary-table tests.

Counts: High 1 · Medium 5 · Low 9 · Info 6

## Summary of measured numbers

### Server TTFB (ms, 20 requests after 3 warm-ups, production build, local DB)

| URL | p50 | p95 | HTML (raw) | DB queries |
|---|---|---|---|---|
| `/s` | 7.5 | 8.8 | 85 KB | 9 |
| `/s/plan` | 9.9 | 11.7 | 62 KB | 15 |
| `/plan` | 9.6 | 10.7 | 132 KB | 14 |
| `/plan?week=2026-W44` | 10.2 | 11.4 | 139 KB | 13 |
| `/s/subjects/BD` | 8.8 | 9.3 | 86 KB | 12 |
| `/subjects/BD` | 9.7 | 10.6 | 138 KB | 12 |
| `/search?q=kolokwium` | 6.8 | 7.5 | 108 KB | 6 |
| `/s/search?q=kolokwium` | 6.2 | 6.4 | 52 KB | 6 |
| `/tables/v_files` (files list) | 8.9 | 9.3 | 256 KB (22.5 KB gz) | 9 |
| `/s/recent` (materials) | 7.3 | 10.5 | 158 KB | 6 |
| `/sql` (GET) | 6.8 | 7.4 | 105 KB | 3 |
| `/wydarzenia/1` (there is no `/wydarzenia` list route) | 10.4 | 13.4 | 106 KB | 18 (1 duplicate) |
| `/s/wydarzenia/1` | 9.8 | 11.9 | 37 KB | 16 (1 duplicate) |
| `/admin` (curator) | 8.3 | 9.9 | 133 KB | 10 |
| `/admin/audit` (curator) | 9.5 | 10.5 | 245 KB (20 KB gz) | 6 |
| `/admin/sql` (curator) | 6.8 | 7.6 | 96 KB | 3 |
| `/files/1/preview` | 3.4 | 3.7 | 0.8 KB | 2 |
| `/files/1/original` | 3.4 | 3.9 | 0.8 KB | 2 |
| `/api/material/1` | 3.5 | 3.7 | 0.4 KB | 2 |
| `/login-info` (no DB) | 1.5 | 2.0 | 6 KB | 0 |

Slowest three by p50: `/wydarzenia/1` (10.4 / 13.4), `/plan?week=2026-W44` (10.2 / 11.4) and `/s/plan`
(9.9 / 11.7).

### First-load JS per route

Sizes are the gzip size of every chunk the served HTML references, measured from the build. The `nomodule`
polyfills (38.5 KB gz) are left out because modern browsers don't download them.

| Route | gz | raw |
|---|---|---|
| `/login-info` (framework baseline) | 130 KB | 442 KB |
| `/s`, `/s/recent`, `/s/search` | 158 KB | 537 KB |
| `/s/plan` | 164 KB | 552 KB |
| `/s/subjects/[code]` | 165 KB | 556 KB |
| `/s/wydarzenia/[id]` | 164 KB | 559 KB |
| `/search`, `/structure`, `/admin`, `/admin/audit` | 152 KB | 521 KB |
| `/plan` | 184 KB | 628 KB |
| `/wydarzenia/[id]` | 173 KB | 594 KB |
| `/sql` | 324 KB | 1055 KB |
| `/tables/[view]` (any tab) | 325 KB | 1057 KB |
| `/admin/sql` | 327 KB | 1065 KB |
| **`/subjects/[code]` (any tab)** | **417 KB** | **1348 KB** |

Loaded only on demand (correct): pdf.js (`4e52dc9c` 128 KB gz plus `64de4ab2` 51 KB gz) and
`/pdf.worker.min.mjs` (1.27 MB, 375 KB gz).

### Client (Playwright, cold, median of 3)

| Profile | Page | LCP | CLS | TBT* | long tasks | JS transferred | total | requests | load |
|---|---|---|---|---|---|---|---|---|---|
| Desktop 1440×900 | `/s/plan` | 56 ms | 0 | 0 | 0 | 170 KB | 330 KB | 16 | 81 ms |
| Desktop | `/plan?week=2026-W44` | 64 ms | 0 | 0 | 0 | 191 KB | 358 KB | 19 | 93 ms |
| Desktop | `/s/subjects/BD` | 44 ms | 0 | 0 | 0 | 171 KB | 334 KB | 17 | 75 ms |
| Desktop | `/subjects/BD` | 48 ms | 0 | 0 | 0 | 426 KB | 598 KB | 27 | 101 ms |
| Mobile 375×812, 4× CPU | `/s/plan` | 80 ms | 0 | 0 | 1 | 170 KB | 338 KB | 27 | 188 ms |
| Mobile 4× CPU | `/plan?week=2026-W44` | 96 ms | 0 | 0 | 1 | 191 KB | 371 KB | 36 | 204 ms |
| Mobile 4× CPU | `/s/subjects/BD` | 68 ms | 0 | 0 | 1 | 171 KB | 342 KB | 27 | 179 ms |
| Mobile 4× CPU | `/subjects/BD` | 80 ms | 0 | 35 ms | 2 | 426 KB | 612 KB | 45 | 263 ms |
| Mobile 4× CPU + slow 4G (150 ms RTT, 1.6 Mbps) | `/s/plan` | 724 ms | 0 | 20 ms | 1 | 170 KB | 351 KB | 42 | 2.31 s |
| Mobile 4× + slow 4G | `/plan?week=2026-W44` | 716 ms | 0 | 21 ms | 1 | 191 KB | 404 KB | 75 | 2.41 s |
| Mobile 4× + slow 4G | `/s/subjects/BD` | 676 ms | 0 | 22 ms | 1 | 171 KB | 352 KB | 38 | 2.35 s |
| Mobile 4× + slow 4G | `/subjects/BD` | 664 ms | 0.002 | 56 ms | 2 | 426 KB | 644 KB | 79 | **3.68 s** |

\*TBT is approximated as the sum of (long task − 50 ms) after FCP. The request counts include the 21–58 RSC link
prefetches per page (L8).

### Idle DB load (from code)

| Process | Loop | Statements per minute | Uses an index |
|---|---|---|---|
| worker | `claimJob` × concurrency 2, every 3 s (BEGIN + SELECT … FOR UPDATE SKIP LOCKED + COMMIT) | ~120 | yes, `idx_jobs_status_run_after` |
| worker | `requeueStale` txn + `finalizeStuckMaterials`, every 60 s | ~4 | requeue yes; **finalize no** (L5) |
| worker | plan-sync status check, every 60 s (only with `UNITIME_ICAL_URL`) | 1 | PK |
| bot | `claimNextBotRequest`, every 5 s (BEGIN + SELECT … FOR UPDATE SKIP LOCKED + COMMIT) | ~36 | yes, `idx_bot_requests_status` (verified at 50k rows) |
| bot | reminders tick, every 60 s: `listEventsInRange` (more queries only when something is due; digest queries 18:00–18:30) | 1 (2–3 in the digest window) | yes, `idx_events_starts` |
| bot | upload cleanup, every 10 min | ~0.2 | `idx_web_uploads_status` |
| **Total** | | **~160 statements/min** (≈2.7/s) | |

That is negligible for MariaDB. The only idle query without an index is `finalizeStuckMaterials`.

## Findings

### H1. `/subjects/[code]` and `/tables/[view]` ship CodeMirror and React Flow on every tab (High, Measured)
- **Evidence:**
  - `app/(app)/subjects/[code]/page.tsx:18-26` statically imports `SqlConsole` (CodeMirror), `DataMap`
    (`@xyflow/react` plus `@dagrejs/dagre` through `lib/graph-layout.ts`) and `DesignerDiagram`. They render only on
    the `sql`, `map` and `schema` tabs (`:265-273`, `:620`, `:646`).
  - `app/(app)/tables/[view]/page.tsx:14` imports `SqlConsole` for the `sql` tab only (`:131`).
  - The client manifest still puts every statically imported client component into the route's first load. The
    default explorer tab of `/subjects/BD` loads these chunks:
    - `4352` (CodeMirror plus icons) 87 KB gz
    - `4af12079` (CodeMirror view) 62 KB gz
    - `8845` (xyflow plus dagre) 56 KB gz
    - `ba4fb354` (react-flow) 22 KB gz
    - the xyflow CSS
- **Impact:**
  - `/subjects/[code]` loads 417 KB gz of JS, against 165 KB for `/s/subjects/[code]`. On mobile with slow 4G its
    `load` is 3.68 s against 2.35 s, with twice the TBT.
  - `/tables/*` and `/sql` load about 170 KB more than the other advanced pages. The subject page is the main
    entry from the nav tree, so most advanced-mode visits pay this cost.
- **Fix:** load these components with `next/dynamic` (`const SqlConsole = dynamic(() => import('@/components/SqlConsole').then(m => m.SqlConsole))`)
  in a small client wrapper, or move each tab's body into its own client boundary file that the page imports only
  for that tab. Also consider running the dagre layout on the server and passing positions to `DataMap`, because
  `lib/graph-layout.ts` is pure.
- **Expected impact:** `/subjects/[code]` drops to about 190 KB gz (−55%), and `/tables/[view]?tab=browse` to
  about 175 KB. The code is then downloaded only when the SQL or map tab opens.

### M1. `bot_requests` has no index on (kind, target): the parked finding is confirmed (Medium, Measured)
- **Evidence:**
  - The table has only `PRIMARY` and `idx_bot_requests_status (status, created_at)`.
  - Nothing ever deletes rows (no `delete(botRequests)` anywhere), so the table only grows.
- **Problem 1: `lastBotRequest`** (`packages/db/src/bot-requests.ts:156-167`). It runs on every event page view
  whose post doesn't exist yet (`apps/web/lib/event-page.ts:39`). Its plan is `type=index` on PRIMARY, scanned
  backwards.
  - With 50k rows and no matching target, ANALYZE gives r_rows 50 000 and 9.7 ms.
  - With an index on `(kind, target, status)` it reads 0 rows in 0.01 ms.
- **Problem 2: the `enqueueBotRequest` locking read** (`bot-requests.ts:56-60`, `LOCK IN SHARE MODE`).
  - At 50k rows the plan is `ref` on `idx_bot_requests_status` (status = 'queued') plus a filesort, so it scans
    every queued row.
  - Under REPEATABLE READ (verified as the global isolation level), that shared next-key lock covers every queued
    row and the gap after them, not just this (kind, target).
  - Two concurrent enqueues for *different* events then both hold S locks on that gap and both try to INSERT a
    `queued` row into it. That is the classic S→X deadlock (1213), which `withTxRetry` then has to retry. This
    serialisation is Inferred: it follows from InnoDB locking rules and was not reproduced under load.
  - Before `ANALYZE TABLE`, the planner instead chose a backwards PRIMARY scan (`type=index`, small table). That
    plan locks every row it reads.
- **Fix:**
  - Add the index `idx_bot_requests_kind_target (kind, target, status, id)` with a normal `drizzle-kit generate`
    migration. It serves the locking read (exact key range, so narrow locks), `lastBotRequest` (`ORDER BY id DESC
    LIMIT 1` resolved from the index) and the `existing()` fallback.
  - Separately, prune `done`/`failed` rows older than 30 days, for example in the bot's 10-minute cleanup.
- **Expected impact:** constant-time event pages, enqueue lock scope cut to one key, and no growth-linked slowdown.

### M2. Admin audit: list is ordered via temp table + filesort; event history scans the whole table (Medium, Measured at 100k rows)
- **Evidence:** `packages/db/src/audit.ts:84-96`: `listAudit` INNER JOINs `users` and orders by
  `admin_audit.id DESC LIMIT 50`. `admin_audit` has no index on `target` or `action`. `eventHistory`
  (`apps/web/lib/event-queries.ts:167-183`) runs on every event page (both modes), filters by `target IN (…)` and
  `action LIKE 'event.%'`, and discards the `total` count query that `listAudit` always runs. ANALYZE on a
  100k-row temporary copy:

  | Query | Plan | Time |
  |---|---|---|
  | `/admin/audit` page (INNER JOIN, ORDER BY id DESC LIMIT 50) | `users` ALL → `admin_audit` by user_id, *Using temporary; Using filesort*, reads all 100k | 22.6 ms |
  | same with `LEFT JOIN users` | `admin_audit` PRIMARY backwards, reads 50 | 0.02 ms |
  | count(*) for pagination | reads 100k | 5.5 ms |
  | event history (`target='17' AND action LIKE 'event.%'`) | reads 100k | 31.3 ms |
  | same with an index on `(target, action)` | reads 0 (no match) | 0.01 ms |

- **Impact:** every SQL-console statement and every event change adds a row, and the table is never pruned. Each
  event page view then costs about 1 ms per 3k audit rows, and the audit list grows linearly with the table.
- **Fix:**
  - Add `idx_admin_audit_target (target, action, id)`.
  - In `listAudit`, use `leftJoin(users …)`; `user_id` is NOT NULL with an FK, so the results stay the same.
    Alternatively, add `STRAIGHT_JOIN`.
  - Give `eventHistory` a `withTotal: false` option so it skips the count.
  - Optionally, cap the pagination total ("50 of 10 000+").

### M3. The advanced layout counts 15 views and runs correlated nav counts on every page load (Medium, Measured count / Inferred scale)
- **Evidence:** `app/(app)/layout.tsx:23-28` runs these on every full page load of the advanced UI:
  - `countViewRows` (`lib/tables.ts:287-307`): one `UNION ALL` of `COUNT(*)` over all 15 `PUBLIC_VIEWS`. That
    includes `v_files`, `v_materials`, `v_class_sessions` and `v_events`, which are join views with no usable
    covering index for COUNT.
  - `getNavSubjects` (`lib/queries.ts:761-790`): subjects ⋈ classes ⋈ groups, with 4 correlated
    `COUNT(*) FROM materials JOIN topics` subqueries per row. The subject-level counts are recomputed for every
    group row of that subject.

  They are 2 of the 3 queries `/sql` runs.
- **Impact:**
  - Each advanced full load does a full count of every view, so the cost grows with all content.
  - `countViewRows` runs on the RO pool, which is capped at 10 connections and shares a 5 s `MAX_STATEMENT_TIME`
    with the user SQL console. Under load, nav counts compete with student queries, and past 5 s they silently
    disappear (the `catch` returns `null`).
  - Soft navigation within `(app)` doesn't re-render the layout, but every full load, `router.refresh()` and
    server action does.
- **Fix:**
  - Compute the nav counts in one grouped query, `SELECT t.subject_id, t.class_id, t.group_id, COUNT(*) … GROUP BY
    … WITH ROLLUP`, and fold the result in JS.
  - Memoise both results in-process for 30–60 s, for example a module-level `{at, value}` cache in `lib/`.
    `use cache` isn't used anywhere in the app, so a plain TTL memo avoids a new surface.
  - Run the view counts on the main pool. They are fixed SQL, not user SQL.

### M4. Every simple-mode page re-aggregates all materials for the subject cards (Medium, Measured presence / Inferred scale)
- **Evidence:** `listSubjectCards` (`lib/simple-queries.ts:56-80`) is called by 10 pages: `/s`, `/s/plan`,
  `/s/subjects/[code]`, `/s/search`, `/s/recent`, `/s/reports`, the three `/s/wydarzenia` pages and `/wydarzenia/[id]`.
  - It runs `COUNT(materials.id), MAX(created_at) … GROUP BY topics.subject_id` over every live material.
  - EXPLAIN: `materials` index scan, *Using temporary; Using filesort*.
- **Impact:** an O(materials) scan on every simple page, the student default mode.
- **Fix:**
  - Apply the same 30–60 s in-process TTL memo as in M3.
  - Or add a covering index `materials (deleted_at, topic_id, created_at)` so the aggregate becomes an index-only
    scan.

### M5. File routes are not cacheable, and each request (including every pdf.js range request) loads `extracted_text` (Medium, Measured headers / Inferred cost)
- **Evidence:**
  - `apps/web/lib/http-files.ts:94` runs `.select()` of every `materials` column, including `extracted_text`
    (MEDIUMTEXT, up to 16 MB), only to read paths and mime.
  - `:103` sets `Cache-Control: private, no-store` with no ETag or Last-Modified. Measured: `/files/1/preview` and
    `/files/1/original` both answer `private, no-store`.
  - The route advertises `Accept-Ranges: bytes`. For larger PDFs, react-pdf/pdf.js then fetches in 64 KiB ranges,
    and each range is a full request: session query, materials row with the text, then file stat.
- **Impact:**
  - A 5 MB PDF means about 80 requests, each reading the whole extracted text from the DB.
  - Reopening a preview, or going back to it, downloads the file again.
- **Fix:**
  - Select only the columns the handler uses (`id, storagePath, previewPath, previewKind, mimeType,
    originalFilename, sha256`).
  - Send `ETag: "<sha256>[-preview]"` and answer `If-None-Match` with 304.
  - For `original` (content-addressed by sha256 and immutable per id), send `Cache-Control: private,
    max-age=31536000, immutable`. For `preview`, send `private, no-cache` plus the ETag, because a pending
    conversion can change it.
  - `private` keeps Cloudflare from caching it. The trade-off is that a file stays in the browser cache after
    logout.

### L1. Recent-file lists sort all live materials (Low, Measured plan / Inferred scale)
- **Evidence:** `lib/simple-queries.ts:165` and `:196` use `ORDER BY materials.created_at DESC, id DESC LIMIT n`.
  `materials` has no `created_at` index; the EXPLAIN for `/s` (LIMIT 5) is `materials` ALL with *Using filesort*.
  `v_files ORDER BY material_id LIMIT 25` (`/tables/v_files`) likewise shows *Using temporary; Using filesort*,
  because the plan starts from `topics`.
- **Fix:** add the index `materials (deleted_at, created_at, id)`.

### L2. Simple search adds an unindexable `LIKE '%q%'` pass over all materials (Low, Measured plan)
- **Evidence:** `searchSimpleFiles` (`lib/simple-queries.ts:179-200`) first runs
  `LOWER(filename) LIKE LOWER('%q%') OR LOWER(topic.title) … OR LOWER(subject.name) …`. Its plan is `topics` ALL,
  *Using temporary; Using filesort*. Only then does it run the FULLTEXT `searchAll`. The column collation is
  already case-insensitive, so `LOWER()` adds nothing.
- **Fix:** match filenames through `MATCH(search_name, extracted_text)` (`search_name` is already indexed), or cap
  the LIKE pass to `search_name` with a prefix. Drop the `LOWER()` calls.

### L3. The search snippet is computed for every hit before the LIMIT (Low, Inferred)
- **Evidence:** `packages/db/src/search.ts:119-120` runs
  `SUBSTRING(COALESCE(extracted_text, …), LOCATE(…) - 300, 1000)` inside the derived table, before `ORDER BY score
  DESC LIMIT 100`. Each hit's full MEDIUMTEXT is read and scanned with LOCATE, even for hits that are thrown away.
  The FULLTEXT index itself is used (`type=fulltext`, Measured).
- **Fix:** rank and limit ids in the inner query, then compute the snippet in an outer join on the 100 ids.

### L4. Event pages: 18 queries, 6 of them sequential, 1 duplicate (Low, Measured)
- **Evidence:**
  - `getEvent` (`packages/db/src/events.ts:626-670`) awaits `events` → `subjects` → `event_series` →
    `event_topics` → `users` (created_by) → `users` (updated_by) one after another. It queries the same user twice
    when the creator is also the last editor, as seen in the `/wydarzenia/1` log.
  - `event_topics` is read again by `listTopicsByIds`.
  - The history count (M2) is wasted.
- **Fix:** fetch the subject, series, topics and both names in one query with joins (or `Promise.all`), and dedupe
  the user ids. This cuts about 5 round trips.

### L5. Worker `finalizeStuckMaterials` runs a non-indexed UPDATE scan every minute (Low, Measured plan)
- **Evidence:** `apps/worker/src/queue.ts:75-86` runs `UPDATE materials … WHERE status='pending' AND EXISTS …`.
  Its plan is `materials` index (PRIMARY, full) with *Using where*, because there is no `status` index.
  - Under REPEATABLE READ an UPDATE locks every row it scans. For a moment each minute, all `materials` rows plus
    the supremum are X-locked, which briefly blocks the bot's material inserts.
- **Fix:** add an index on `materials (status)` (pending rows are rare), or SELECT the candidate ids first and UPDATE
  by PK.

### L6. `/pdf.worker.min.mjs` is revalidated on every preview session (Low, Measured)
- **Evidence:** the response is `Cache-Control: public, max-age=0` with a weak ETag, for 1.27 MB (375 KB gz). The
  hashed `/_next/static/*` assets correctly get `public, max-age=31536000, immutable`.
- **Fix:** have `scripts/copy-pdf-worker.mjs` write a versioned name (`pdf.worker.<pdfjs version>.min.mjs`) and
  point `PdfViewer.tsx:10` at it. Add a `headers()` rule in `next.config.ts` giving it a long immutable
  max-age, and keep the proxy matcher exclusion in step.

### L7. Tables that are never pruned (Low, Inferred from code)
- **Evidence:** there are no delete paths for `bot_requests`, `admin_audit`, `reminder_log`, `jobs` (done), expired
  `login_tokens`, or expired `sessions`. `deleteSession` only runs on logout.
- **Impact:** M1 and M2 get worse with time. Lookups by unique token stay fast.
- **Fix:** add a daily prune in the worker's requeue loop:
  - done/failed `bot_requests` and done `jobs` older than 30 days;
  - expired `sessions` and `login_tokens`;
  - `reminder_log` older than 60 days.

  Keep `admin_audit` (it is the audit trail) but index it (M2).

### L8. Link prefetch fires 21–58 RSC requests per page load (Low, Measured)
- **Evidence:** a cold load of `/plan?week=2026-W44` issues 55–56 `?_rsc=` prefetches and `/subjects/BD` 53–58,
  covering every visible nav, table and event link. Many URLs are requested twice with two different `_rsc`
  hashes. The traced DB query count for the page view does not grow, so these prefetches don't render dynamic
  segments, and responses are around 0 KB.
- **Impact:** server cost is negligible. On slow 4G they compete with the page's own chunks (requests rise from 16
  to 75), and they add load to the Cloudflare tunnel.
- **Fix:** optional: `prefetch={false}` on the long generated link lists (nav tree views, plan event chips,
  ResultGrid FK links).

### L9. HTML payloads of the grid pages are large (Low, Measured)
- **Evidence:**
  - `/tables/v_files` sends 256 KB of HTML (22.5 KB gzip) for 25 rows.
  - `/admin/audit` sends 245 KB, of which 112 KB is the inline RSC payload: full statements are sent twice, as
    rendered HTML and as flight data.
- **Fix:** truncate `statement` to a preview on the list (the full text stays on `/admin/audit/[id]`), and pass
  `ResultGrid` only the columns it renders.

### Info
- **I1:** Phosphor icons are tree-shaken. Client chunks contain only the icons that are used (3–16 icon modules per
  chunk), so mixing `@phosphor-icons/react` with `/dist/ssr` costs nothing.
- **I2:** pdf.js is code-split properly. `FilePreview.tsx:6` uses `next/dynamic(..., { ssr: false })`, and no route
  has react-pdf in its first load.
- **I3:** Hashed static chunks and CSS use `public, max-age=31536000, immutable`, and responses are gzip-compressed
  by `next start`.
- **I4:** Dynamic pages send `private, no-cache, no-store, max-age=0, must-revalidate`. That is correct for
  authenticated, per-user HTML.
- **I5:** Core Web Vitals are healthy everywhere:
  - CLS 0 to 0.002;
  - LCP under 100 ms on desktop and around 0.7 s on throttled mobile with slow 4G;
  - TBT at most 56 ms (`/subjects/BD`, mobile).

  JS weight (H1) is the only material client cost.
- **I6:** The hot indexed paths are fine:
  - session lookup (`sessions_token_hash_unique`, 1 query per request; `requireUser` is deduped between layout and
    page);
  - week plan (`idx_class_sessions_starts`, range);
  - events (`idx_events_starts`, range);
  - FULLTEXT search (`ft_materials`, `ft_topics`);
  - job and bot-request claim (status indexes).

  The `filesort` on 1–20-row `classes`/`tags`/`subjects` lists is harmless.

## Notes
- `next start` warns that `output: 'standalone'` should run `node .next/standalone/server.js`. The two share the
  same server code, but production (`compose.yaml`) uses the standalone server.
- **Cleanup:**
  - Server on :3300 stopped.
  - Build output left in `apps/web/.next-perf` (gitignored).
  - Logging in created 2 sessions and 2 consumed login tokens in `studies_qa_test`.
  - Temporary tables vanished with their session.
  - No global DB setting was changed.
- Helper scripts are in the session scratchpad: env launcher, TTFB, bundle summing, query tracer, Playwright vitals.
