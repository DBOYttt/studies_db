# Security audit: web and db (2026-10-30)

Reviewer: `sql-console-security-reviewer` (opus). This file was saved by the controller, because the agent is read-only.

Scope: `git diff b78ea64..main -- apps/web packages/db`, plus a check that the 2026-10-25 fixes held. Code was read only; no DB tests were run.

Counts: high 0 · medium 0 · low 1 · info 4

## W1. A hostile calendar blocks the event loop (low)
- **Where:**
  - `packages/db/src/unitime/group-import.ts:150` calls `expandOccurrences` for every event only to work out its weight.
  - The action is `apps/web/lib/group-import-actions.ts:58-63`.
- **Scenario:** a signed-in student uploads a 2 MiB `.ics` file with about 12 000 events, each `FREQ=WEEKLY;BYDAY=MO..SU` for a year. That measured about 4.5 M occurrence objects, roughly 420 ms of synchronous CPU per preview. Each user gets 6 per 10 min, and the limiter is per user and in memory. A few accounts can make the web server stutter for everyone.
- **Fix:**
  - Count occurrences without building `Date` objects.
  - Cap the number of events (for example 2 000) and the total occurrences across the calendar; refuse with `NotACalendarError` beyond that.
  - Optionally add a global limit of 1–2 concurrent previews.

## W2. The Server Action body limit was raised for every action (info)
- **Where:** `apps/web/next.config.ts:26` sets `serverActions.bodySizeLimit: '3mb'`.
- **Scenario:** every Server Action accepts and parses 3 MB before its own `requireUser()`/`requireAdmin()` runs. `proxy.ts` only checks that a `sid` cookie exists, so any cookie value gets through. The amplification is small.
- **Fix:** accept it, or move the `.ics` upload to a route handler that streams with its own cap and put the limit back to 1 MB.

## W3. The import allowlist includes the feed hosts, with no check on the resolved IP (info)
- **Where:** `packages/db/src/unitime/fetch.ts:124-128` adds the hosts of `UNITIME_ICAL_URL` and `UNITIME_EXAM_ICAL_URL`. The URL check is `fetch.ts:151-159`.
- **Scenario:** if an operator points a feed at an internal https host, any student can make the web server send GET requests to any path on that host. The response is only used through the parsed calendar and generic errors. DNS is not pinned, but that only matters if someone controls DNS for an allowed host.
- **Fix:** document that feed hosts become importable, or make adding them opt-in. Optionally refuse private and loopback addresses after resolving.

## W4. The admin request lock can stay stuck on a pooled connection (info)
- **Where:** `packages/db/src/bot-requests.ts:149-165`.
- **Scenario:** if `RELEASE_LOCK` throws, for example on a dropped packet, the transaction rolls back but the connection-scoped `GET_LOCK` may still be held. Other connections then wait 5 s and get `BOT_BUSY_MESSAGE` until the pool recycles that connection. This affects admins only.
- **Fix:** on failure, destroy the connection instead of returning it to the pool, or use `DO RELEASE_ALL_LOCKS()` in a `finally`.

## W5. An admin change can succeed with no audit row (info)
- **Where:** `apps/web/lib/admin-actions.ts:59-78`.
- **Scenario:** if the `admin_audit` insert fails, the change stays applied and the error is only logged. This is by design and matches the bot's `auditDiscord`.
- **Fix:** accept it, or alert on the `admin audit write failed` log line.

## Verified sound
- **2026-10-25 fixes held:**
  - **M1:** `readwrite-user.ts:39-52` keeps column-level grants that leave out the Discord id, event link and material file columns. `materials` still has no INSERT.
  - **L1:** `isCrossOrigin` is checked on `auth/callback` and `auth/logout`.
  - **L2:** global CSP, XFO, nosniff, HSTS in production, `poweredByHeader: false`.
  - **L3:** soft-deleted topics are filtered in migration 0021 and `http-files.ts`.
  - **I1:** `images.unoptimized` is set.
  - **I2:** risky content types are sent as octet-stream.
- **Auth:**
  - All 37 pages and route handlers under `(app)`, `(simple)` and `api` call the gate themselves. All 10 admin pages and 10 admin actions use `requireAdmin()`.
  - The group-import actions call `requireUser()` and validate their input: at most 100 pairs, ids that are safe integers, and a DB check that each group belongs to its class.
- **iCal fetch:**
  - Same-host manual redirects, with a check against a change of port or a downgrade.
  - The timeout covers the body too. The 2 MiB cap is applied while streaming, and the `text/calendar` type is required.
  - The URL is never returned, stored or logged, and errors name only the host.
- **Admin round 2:**
  - Forms are parsed field by field, so no mass assignment. `addSubject` hard-codes `channelId: null`.
  - Self-ban is refused. Bot requests are allowlisted to `ADMIN_REQUEST_KINDS`, one at a time.
  - The users search escapes LIKE wildcards. The report is rendered escaped in a `<pre>`, and external URLs go through `safeExternalUrl`.
- **SQL:**
  - User SQL runs only on the RO and RW pools, with `multipleStatements: false`.
  - There is no `sql.raw` in web or db code.
  - No new views. 0025 only adds `bot_requests.report`, and that table is not in `PUBLIC_VIEWS`.
- **Files:** unchanged since the last audit, and still sound.
- **CSV:** formula-prefix escaping is intact.
