# qa-security-auditor — Mallory (attacker) — 2026-10-31

Summary: Scope was the new semester surface (`/semester`, `?sem=`, cookie, admin-only feed Server Actions, feed secrecy), plus a short auth/authz sweep. No bypass found; all controls held. Two low notes only. Not tested in depth (outside the requested scope): event validation, output encoding, upload limits, rate limits, audit (no data was changed, so there is nothing to audit).

## Findings
### F1 [low] Dev build leaks framework paths in the 404 body of a refused Server Action
- Where: POST /admin/sync with `next-action: <saveFeedAction id>` as attacker/student/no session
- Actual: status 404 (correct), but the RSC body in this `next dev` sandbox contains node_modules paths (`.../next@16.4.3_.../segment-explorer-node.js`). Guess: dev-mode only; verify the production build returns an empty 404.
- Suggestion: confirm on a prod build.

### F2 [low] Feed fingerprint is an unsalted 24-bit sha256 prefix
- Where: `maskFeedUrl` (packages/db/src/unitime/feeds.ts). Output is `host/…#<6 hex>`; no path/query/userinfo character (checked offline with fake URLs). 24 bits of an unsalted hash leak almost nothing, but it lets an admin confirm a guessed URL. Hardening idea only.

## Checks (expected -> observed)
| Control | Result | Evidence |
|---|---|---|
| Unauthenticated GET of /s, /s/plan, /s/wydarzenia, /plan, /wydarzenia, /admin*, /sql, /schema, /tables/*, /api/schema, /api/material/1, /files/1/original, /semester | pass | all 307 -> /login-info |
| Unauthenticated POST /api/sql, /api/admin/sql, /api/wydarzenia/1/pliki | pass | 307/303 -> /login-info |
| Banned persona login | pass | POST /auth/callback -> 303 /login-info?error=expired |
| Reused login token | pass | 1st 303 /, 2nd 303 /login-info?error=expired |
| Foreign Origin on /auth/callback and on upload | pass | 403 |
| /admin, /admin/sync, /admin/sql, /admin/audit, POST /api/admin/sql as attacker and student | pass | 404 |
| GET /semester needs login | pass | 307 /login-info without a cookie |
| /semester `to` invalid (9, 0, 3.5, %00) | pass | 303 /s, no Set-Cookie; `to=3` sets cookie (Lax, 1 year); `to=all` clears it |
| /semester `next` hostile (`//evil.com`, `/%5Cevil.com`, `https://evil.com`, `/%2e%2e/x`, `/%252e%252e/x`, CRLF, NUL, invalid UTF-8, `..%2f`, `/%2F/evil.com`, 9000-char path, truncated %-escape) | pass | 303 to `/s`; no header injection; no 500 |
| /semester `next` valid with `sem` param | pass | `/s?sem=2&x=1` -> `/s`; `%3F`-encoded `sem=2&x=1#h` -> `/s?x=1#h`; `%C5%9B` stays ASCII-encoded in Location |
| /semester cross-site | pass | `Sec-Fetch-Site: cross-site` -> 303, no Set-Cookie; same-origin sets the cookie |
| Raw non-ASCII bytes in URL | note | 400 from the server for any URL (`/s?x=ś` too), not specific to /semester; browsers percent-encode |
| `?sem=` bad values (99, abc, %00, -1, 1e0, `sem[]=1`) and cookie values (99, abc, empty, %00, `3;x`, 0) | pass | /s and /plan answer 200; `sem=99`/`abc` page size equals `sem=all`; no error |
| saveFeedAction / clearFeedAction as attacker, student, no session | pass | 404 (sent with `semester=99` and a fake `https://example.invalid/fake?token=FAKE`, so nothing could be changed) |
| Same two actions as admin (control) | pass | 200 `{"ok":false,"message":"Choose a semester from 1 to 7."}` (the actions are reachable for admin; nothing changed) |
| unitime_feeds not in /tables, CSV, /schema, /structure, /api/schema | pass | /tables/unitime_feeds and /tables/v_unitime_feeds 404; schema pages 0 matches for unitime_feeds/class_url/exam_url |
| Read console (/api/sql) as attacker and admin | pass | `SELECT * FROM unitime_feeds` -> "SELECT command denied for table `unitime_feeds`"; `SHOW CREATE TABLE` denied; information_schema shows no feed table/columns; `users` denied |
| Write console (/api/admin/sql) as admin, preview only | pass | `SELECT/UPDATE ... unitime_feeds` and `users` -> 400 "outside the console's scope"; `class_sessions.source` / `feed_semester` -> "can't be changed from the console"; two statements -> "Only one statement is allowed." |
| Feed mask never shows path/query | pass (offline) | sandbox has no feeds set (all 7 rows "Not set"), so I called `maskFeedUrl` on fake URLs: `plan.agh.edu.pl/…#409b20`; userinfo/path/query absent; invalid -> `(invalid link)` |

## What worked well
- Every refusal is the same 404 or login redirect; no information difference between missing and forbidden.
- Defence in depth on feeds: the classifier, the `studies_rw` grants and the `studies_ro` grants each refuse `unitime_feeds`.

## Not tested / blocked
- Setting a real feed as admin (would replace other personas' timetable sessions and fetch from the network); the mask was verified on the function, not on the rendered page.
- Event validation, output encoding, upload size/count limits, rate limits, Dziennik audit entries: not run in this pass. I made no state changes, so there was nothing new to audit.
- Banned persona cookie-based action calls (the banned login is refused, so it holds no session).
- No screenshots taken (HTTP-level audit).
