# G6 Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close audit group G6 (P1, P2, P4–P13 in `docs/audits/2026-10-30/performance.md`; P3 was fixed in G3). Student pages no longer wait behind the SQL console, hot queries use indexes, the timetable loads without a waterfall, and pages stream.

**Architecture:**
- Query changes live where the queries live (`packages/db`, `apps/web/lib`).
- One normal drizzle migration adds the two indexes.
- Streaming uses Next `loading.tsx` and `<Suspense>`.

**Tech Stack:** MariaDB 11, Drizzle, mysql2 pools, Next 16 App Router.

**Spec:** `docs/audits/2026-10-30/performance.md` and `FINDINGS.md` (G6).

## Global Constraints

- **Migrations:** generate with `drizzle-kit generate` from `packages/db`; never `push`. Migration numbering continues after 0025.
- **Query results:** behaviour must not change. Each rewritten query keeps its existing tests green and gains a test for the edge it now depends on.
- **Pools:** user SQL stays on the RO pool alone, and application queries never run user SQL.
- **Test DB:** it is shared, so run one vitest file at a time.
- **Commits:** as DBOYttt, unsigned, no trailers; never push.
- **Next docs:** read the relevant guide in `apps/web/node_modules/next/dist/docs/` before touching `loading.tsx` or Suspense.

## Review Focus

1. **The `starts_at` lower bound must keep every event the old query returned.** That includes all-day events and events whose end is later than their start.
2. **The EXISTS rewrite must return the same group options,** including classes with only exam-kind sessions where the old query included or excluded them.
3. **Reusing `openingWeek` rows must not show stale data** when `?week` differs from the current week.
4. **The new view pool must not exceed `studies_ro`'s `MAX_USER_CONNECTIONS 10`,** counting the watchdog KILL connections.
5. **Streaming must not break `requireUser()` gating** or the redirects that run before render.

## Rulings

- **P2 window:** the lower bound is `starts_at >= now - INTERVAL 31 DAY`. Web/bot events always end the same day; only console-written longer events could be missed. [A console-written event that started more than 31 days ago and still runs won't show as upcoming.]
- **P1 pool:** a second `studies_ro` pool, `getViewsPool()`, with `connectionLimit: 4`, for the fixed view queries. User SQL keeps `getRoPool()` (4), now with `queueLimit: 8`, mapped to `BUSY_ERROR`. That makes 4 + 4 + 2 spare for KILL, within 10.

---

### Task 1: A separate pool for application view queries (P1)

**Files:**
- Modify:
  - `apps/web/lib/db.ts`;
  - every fixed-query caller listed in P1 (`components/plan/PlanWeekTab.tsx`, `app/(simple)/s/page.tsx`, `components/plan/GroupsTab.tsx`, `lib/event-form-page.ts`, `app/(app)/page.tsx`, the `countViewRows` caller, and anything else that passes `getRoPool()` to non-console code; grep);
  - `apps/web/lib/sql-console.ts`, so a full queue maps to `BUSY_ERROR`.
- Test: `apps/web/test/db-pools.test.ts`, plus the existing tests of the touched libs.

**Interfaces:**
- Produces: `getViewsPool(): mysql.Pool` (same RO credentials, `connectionLimit: 4`).
- Only `sql-console.ts` (and its callers `/sql`, `/api/sql`, reports, the table CSV) uses `getRoPool()`.

- [ ] **Step 1:** write a test that greps `apps/web` for `getRoPool(` and allows it only in the console modules (the list in the test); it fails now. Add a test that the queue-full error maps to `BUSY_ERROR`.
- [ ] **Step 2:** implement, run the touched test files one at a time, then web typecheck.
- [ ] **Step 3:** commit `perf(web): application view queries get their own pool`.

### Task 2: Index-friendly hot queries (P2, P4, P5, P6, P13 getSubjectAdmin)

**Files:**
- Modify:
  - `packages/db/src/events.ts` (`listUpcomingEvents`);
  - `packages/db/src/plan.ts` (`listMyGroupOptions`);
  - `packages/db/src/plan-marks.ts` (`listMarkableClasses`);
  - `apps/web/components/plan/PlanWeekTab.tsx`;
  - `apps/web/lib/plan-queries.ts` (`sessionRange`);
  - `apps/web/app/(app)/plan/page.tsx` (and the simple plan page if it has the same waterfall);
  - `apps/web/lib/admin-overview.ts`;
  - `apps/web/lib/simple-queries.ts` (`listSimpleFiles`);
  - `packages/db/src/admin-lists.ts` (`listUsersAdmin`, `getSubjectAdmin`).
- Test: the existing tests of each function, plus the new cases below.

- [ ] **Step 1: write the failing or pinning tests.**
  - **Upcoming events:**
    - an all-day event today is included;
    - an event that started 2 h ago and ends in 1 h is included;
    - an event that ended yesterday is excluded;
    - the order is unchanged.
  - **Group options and markable classes:** the same results as before on the seeded fixture, including a class with no sessions (excluded) and a class with exam-only sessions (keep the old behaviour; check it first).
  - **`listSimpleFiles({ withTotal: false })`:** returns rows and no count query. Spy on the query count, or check `total === undefined`.
  - **`getSubjectAdmin('fiz')`:** still finds `FIZ`.
- [ ] **Step 2: implement.**
  - Upcoming events gets the 31-day `starts_at` lower bound next to the exact end test.
  - Group options and markable classes use `EXISTS (SELECT 1 FROM class_sessions cs WHERE cs.class_id = c.id [AND cs.kind='class'])` against the base table.
  - `openingWeek` returns its loaded rows, and `PlanWeekTab` reuses them when the chosen week equals the opening week.
  - `getPlanSyncStatus` runs in parallel with the timetable data.
  - `sessionRange` uses base `class_sessions` when there is no filter.
  - The admin overview uses `listAuditRows`.
  - `/s` passes `withTotal: false`, and rows and count run in `Promise.all` where both are needed (including `listUsersAdmin`).
  - `getSubjectAdmin` uses `eq(subjects.code, code)`.
- [ ] **Step 3:** run the test files one at a time, then typecheck db and web. Then, with the QA sandbox DB (`studies_qa_test`, SELECT/EXPLAIN only), EXPLAIN the rewritten upcoming-events and group-options queries and paste the plans in the report: the plans should no longer show `type=ALL` on `events`/`class_sessions`.
- [ ] **Step 4:** commit `perf: index-friendly upcoming events, group options and timetable loading`.

### Task 3: Queue claims, audit filter index, search snippets (P7, P8, P9)

**Files:**
- Modify:
  - `packages/db/src/schema.ts` (indexes `idx_bot_requests_status_kind_id (status, kind, id)` and `idx_admin_audit_action (action, id)`);
  - a new migration generated by `drizzle-kit generate` (check it contains only the two `CREATE INDEX`);
  - `apps/worker/src/queue.ts` (`claimJob` `ORDER BY run_after, id`);
  - `packages/db/src/bot-requests.ts` (`claimNextBotRequest` uses the new index: equality on status, `kind IN`, order by id; or one query per kind; pick the one EXPLAIN shows as an index range);
  - `packages/db/src/search.ts` (rank and LIMIT ids in an inner query, compute the snippet in an outer join on those ids).
- Test:
  - the worker queue tests;
  - the bot-requests tests;
  - the search tests (snippets and order unchanged);
  - a migration test if the repo has one.

- [ ] **Step 1:** write a search test with more hits than the limit, asserting the same ids, order and snippet text as before. Write a claim test asserting that the oldest due job by `run_after` is claimed first.
- [ ] **Step 2:** implement and generate the migration. Run `pnpm db:migrate` **only against the test DB through the test helpers** (the tests' `resetTestDb` applies migrations). Never run the migrate CLI on a scratch DB.
- [ ] **Step 3:** run the test files one at a time, then typecheck db and worker.
- [ ] **Step 4:** commit `perf: claim and audit indexes, search snippets after the limit`.

### Task 4: Small wins (P3 extra, P10, P11, P13)

**Files:**
- Modify:
  - `apps/web/components/admin/AutoRefresh.tsx` (back off 3 → 6 → 12 → 30 s, pause while `document.hidden`, reset on visibility);
  - `apps/web/lib/admin-actions.ts` (`refresh()` also calls `invalidateCounts()`);
  - the worker's daily prune (find `pruneQueues`; delete `reminder_log` rows with `for_starts_at` older than 60 days);
  - `packages/db/src/unitime/group-import.ts` (`applyGroupImport`: one multi-row `INSERT … ON DUPLICATE KEY UPDATE group_id = VALUES(group_id)`);
  - `apps/bot/src/reminders.ts` (`dueEntryQuizzes` remembers "checked, none" for the day).
- Test: each file's existing tests, plus:
  - the AutoRefresh timing with fake timers;
  - prune deletes only rows older than 60 days;
  - the group import saves 100 pairs in one statement, with the same results;
  - no re-query after a "none" day.

- [ ] **Step 1:** write the tests (failing).
- [ ] **Step 2:** implement.
- [ ] **Step 3:** run the test files one at a time, then typecheck db, web, bot and worker.
- [ ] **Step 4:** commit `perf: refresh back-off, nav cache refresh, reminder log pruning, batched import`.

### Task 5: Streaming (P12)

**Files:**
- Create:
  - `apps/web/app/(app)/loading.tsx`;
  - `apps/web/app/(simple)/s/loading.tsx`;

  Each is a skeleton of the content pane in the existing visual language: neutral blocks using the same tokens, no spinner, `aria-busy`, and a polite "Loading…" for screen readers.
- Modify:
  - wrap `PlanWeekTab` (both modes) and the `/s` upcoming-events card in `<Suspense>` with a small skeleton fallback;
  - keep `requireUser()` at the top of each page, outside the Suspense boundary.
- Test: an e2e check that `/s` and `/plan` still render their main headings, plus the existing gating tests.

- [ ] **Step 1:** read the Next docs for `loading.js` and streaming in `node_modules/next/dist/docs/`.
- [ ] **Step 2:** implement, using the `minimalist-ui` skill's guidance (load it with the Skill tool if available) for the skeletons, but keep the existing tokens and layout.
- [ ] **Step 3:** run web typecheck and lint, then `pnpm --filter @studies/web e2e e2e/simple.spec.ts e2e/smoke.spec.ts`.
- [ ] **Step 4:** add a "Fixed" note on G6 to `docs/audits/2026-10-30/FINDINGS.md`.
- [ ] **Step 5:** commit `perf(web): stream page shells with loading skeletons`.
