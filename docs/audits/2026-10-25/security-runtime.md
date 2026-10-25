# Security runtime check: run 2026-10-25-ux

Persona: Mallory (`attacker`), with `student`, `banned` and `admin` for comparison. Target: sandbox `http://localhost:3200` (Next 16.4.3, dev mode), the only host contacted. About 300 requests in total, no load testing.

Summary: no authentication or authorization bypass found. Every protected page and route refuses an anonymous request, `/admin*` and `/api/admin/sql` return 404 to students, and event, upload, entry-quiz and SQL-console validation and limits all held. The runtime confirms the static review's verified findings L1 (login and logout CSRF) and L2 (no security headers, `X-Powered-By` present), plus the I4 information leak in the read console. Counts: critical 0, high 0, medium 0, low 4, idea 2.

## Findings

### F1 [low] No security headers and `X-Powered-By: Next.js` (confirms L2)
- Where: every response, for example `GET /login-info` (200) and `GET /s` (200, attacker session).
- Steps: `curl -D- http://localhost:3200/login-info`.
- Expected: `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, CSP, and no `X-Powered-By`.
- Actual: the response headers are `Cache-Control: no-store`, `Vary`, `Link`, `Content-Type`, and `X-Powered-By: Next.js`. None of the security headers listed above is present. This is the dev server, so HSTS is out of scope, but the rest is a config matter and would be the same in production.
- Suggestion: add `headers()` and `poweredByHeader: false` in `apps/web/next.config.ts`, as in L2.

### F2 [low] Cross-origin POST to `/auth/logout` and `/auth/callback` accepted (confirms L1)
- Logout: `POST /auth/logout` with `Origin: http://evil.example` and a valid attacker cookie returned `303 Location: /login-info` with `Set-Cookie: sid=; Max-Age=0`. The server session was really destroyed: another cookie jar holding the same `sid` was redirected to `/login-info` on its next request (307).
- Login CSRF: `POST /auth/callback` with `Origin: http://evil.example` and a valid one-time token returned `303 Location: /` plus a `sid` cookie (HttpOnly, SameSite=lax, 30 days). A request with no `Origin` at all was not tested on this route.
- Expected: the same `isCrossOrigin` refusal that the upload and admin SQL routes apply (403 `Invalid request origin.`).
- Actual: accepted. `SameSite=lax` does not protect, because a cross-site top-level form POST is exactly what the cookie attribute lets through on a login request, and it blocks only the cookie on the logout one if the browser decides so (the Origin check is the real control).
- Suggestion: call `isCrossOrigin` in both routes.

### F3 [low] The read console reveals server details (confirms I4)
- Where: `POST /api/sql` (any logged-in user), body `{"sql":"SELECT @@version, @@hostname, @@datadir"}` returned 200 with `["11.8.9-MariaDB-ubu2404","209e3cc7a514","/var/lib/mysql/"]`.
- Also: error messages name the internal tables a user may not read, for example ``SELECT command denied for table `mysql`.`user` ``. That is a mild leak, not a bypass: `users`, `sessions`, `login_tokens`, `admin_audit`, `web_uploads`, `mysql.user` were all denied, `INTO OUTFILE` failed (`FILE privilege`), multiple statements failed (syntax error) and `SELECT SLEEP(10)` stopped at 5 s (`Query timed out (5 s).`).
- Suggestion: reject `@@`/`@`-variables and `VERSION()`/`DATABASE()`/`USER()`-style functions in the classifier, or accept the leak as low-value.

### F4 [low] The dev server returns stack frames in an action's 404 response
- Where: `POST` of a Server Action as a non-admin, for example `restoreMarkAction` (refused correctly). The RSC body contains `"digest":"NEXT_HTTP_ERROR_FALLBACK;404"` and a `stack` array with internal paths (`lib/session.ts`, `lib/class-mark-actions.ts`).
- Actual: this is development mode behaviour. Guess, not verified: a production build omits the stack. Worth one check on the production build.

### F5 [idea] Copy: the entry-quiz stale-version message talks about an event
- `editMarkAction`/`removeMarkAction` with an old version return "Someone changed this event while you were editing. Your changes weren't saved — reload to see the current version." for an entry quiz. Suggest wording for quizzes ("this entry quiz").

### F6 [idea] Messages are English, not the documented Polish
- The task and the spec describe Polish messages; the app now returns English ones (for example `The title must be 1 to 100 characters.`). The behaviour is right, the spec text is out of date. Reconcile the spec with CLAUDE.md ("UI strings are English").

## Checklist (expected, then observed)

### 1. Authentication: pass
- Anonymous GET of 31 URLs (every page family under `/s`, `/plan`, `/wydarzenia`, `/admin`, `/users`, `/topics`, `/lecturers`, `/tags`, `/tables`, `/api/schema`, `/api/sql`, `/api/admin/sql`, `/api/material/1`, `/files/1/original`, `/api/wydarzenia/1/pliki`, `/s/reports/csv`) all returned `307 -> /login-info`. Anonymous POST to `/api/sql`, `/api/admin/sql`, `/api/wydarzenia/1/pliki` also 307. `/_next/image` is 404 for a local path and 400 for an external URL.
- Server Actions: an anonymous action POST (`addMarkAction`) returned 307 `/login-info`; a forged `sid` cookie got `x-action-redirect: /login-info`, no row written; a cookie with a foreign `Origin` got 500 `Invalid Server Actions request.` from Next.
- Banned: `POST /auth/callback` with a valid banned token returned `303 /login-info?error=expired` and set no cookie (the message is the generic one, no ban disclosure). I could not hold a banned session, so banned actions could not be exercised (see "Not tested").
- Reuse: the same attacker token a second time gave `303 /login-info?error=expired`. A GET on the link only shows the confirmation page (200) and did not consume the token.

### 2. Authorization: pass
- `student` and `attacker`: `GET /admin`, `/admin/sql`, `/admin/audit`, `/admin/audit/1` returned 404; `POST /api/admin/sql` returned 404.
- `restoreEventAction` as student and as attacker returned HTTP 404 (admin gate), `restoreMarkAction` the same (404 digest).
- A soft-deleted event (own test event 15, later 11 and 16-23) returned 404 on `/s/wydarzenia/<id>`, `/wydarzenia/<id>` and `/api/wydarzenia/<id>/pliki` for both attacker and student.

### 3. Validation on events: pass (16 cases, plus edit and link cases)
`createEventAction` called by direct POST as attacker. Each response was `{"ok":false,...}`, and `v_events` stayed at 14 rows (max id 14) through the whole set.

| Case | Message |
|---|---|
| title 101 chars | `The title must be 1 to 100 characters.` |
| blank title | same |
| date 2026-09-01 (more than a month back) | `The date cannot be more than a month in the past.` |
| date 2027-12-01 | `The date cannot be more than a year ahead.` |
| end 11:00 before start 12:00 | `The end must be after the start.` |
| date 2026-13-45 / time 25:99 | `Invalid date.` / `Invalid time.` |
| class 1 with subject 2 | `The chosen class does not belong to this subject.` |
| class without subject | `A class and group can only be chosen together with a subject.` |
| place 101 / note 1001 chars | `The place can be at most 100 characters.` / `The note can be at most 1000 characters.` |
| unknown kind / subject 999999 / `subjectId="1 OR 1=1"` | `Unknown event type.` / `Subject not found.` / `Invalid subject, class or group selection.` |
| repeat `daily` / weekly without until | `Unknown repeat rule.` / `Enter the date until which the event repeats.` |

- `updateEventAction`: title 101 and an old date refused with the same messages; id -1 and 999999 gave `Event not found.`.
- `linkTopicAction`: topic 999999 gave `Post not found.`, a repeated link `This post is already linked.`.
- Not reached: the 21st link. The sandbox has only 17 topics, so the limit of 20 cannot be crossed at runtime.

### 4. Output encoding: pass
- Event 11 (title `<b>x</b> [link](http://example.com) # heading`, place `<b>x</b> <img src=x onerror=alert(1)>`, note `# heading [link](...) <script>alert(1)</script> <b>x</b>`).
- Event page `/s/wydarzenia/11` and `/wydarzenia/11`, plan `/s/plan?week=2026-W46` and `/plan?week=2026-W46`: raw `<b>x</b>`, `<img src=x` and `<script>alert` occurred 0 times in the HTML; the escaped form (`&lt;b&gt;x&lt;/b&gt;`) was present. The accessibility snapshot shows the text literally, no link, no heading, no alert.
- Entry-quiz note `<b>x</b> <script>alert(1)</script>` on class 12: escaped on `/s/subjects/SK`, `/subjects/SK`, `/s/plan`, `/plan`.
- The start page did not list event 11 (it is more than a week out), so its rendering was not checked with this payload.
- Screenshots: `.qa/screens/2026-10-25-ux/security-1.png` (event page), `.qa/screens/2026-10-25-ux/security-2.png` (plan week).

### 5. Uploads (`POST /api/wydarzenia/11/pliki`): pass

| Case | Result |
|---|---|
| foreign `Origin: http://evil.example` | 403 `Invalid request origin.` |
| no `Origin` header | 403 `Invalid request origin.` |
| 11 files | 400 `You can send at most 10 files at once.` |
| empty file | 400 `The file is empty.` |
| 10,485,761 byte file | 400 `A file is too large (max 10 MB).` |
| declared `Content-Length` 97 MB, no body | 413 within a second |
| non-multipart body | 400 `Invalid request.` |
| multipart with no files | 400 `No files selected.` |
| anonymous | 307 `/login-info` |
| names `../x.txt`, `..\..\etc\passwd.txt`, `/etc/passwd` | 200; stored as `x.txt`, `passwd.txt`, `passwd` |

- None of the refused requests created a row (the status endpoint listed only the later successful uploads). The 95 MB total was only tested as a declared length; the code allows 96 MB of body, so a declared 95-96 MB passes the header check and is limited while streaming (not tested, would need a real body).

### 6. Rate limits: pass
- Events: 10 events created (ids 11, 15, 16-23); the next request returned `You can add at most 10 events per hour. Try again later.` and wrote no row.
- Files: after 3 + 10 + 10 + 7 = 30 files, the 31st (and a batch of 2) returned 429 `Limit of 30 files per hour. Try again later.`

### 7. SQL consoles: pass (previews and rejected statements only, nothing executed)
- Read console (`POST /api/sql`, admin): `users`, `sessions`, `login_tokens`, `admin_audit`, `web_uploads`, `mysql.user` all `command denied`; `INTO OUTFILE` denied; two statements refused. See F3 for the information that does leak.
- Write console (`POST /api/admin/sql`, mode `preview`, admin):
  - `UPDATE users|sessions|admin_audit ...` gave ``Table `x` is outside the console's scope.``;
  - `SELECT * FROM users` is refused the same way;
  - two statements gave `Only one statement is allowed.`;
  - `UPDATE materials SET storage_path = storage_path` gave ``Column `storage_path` of `materials` can't be changed from the console.``;
  - the same refusal for `events.discord_thread_id`;
  - `CREATE`, `DROP`, `GRANT` gave `Only SELECT, INSERT, UPDATE, DELETE and REPLACE statements are allowed.`;
  - `/*!50000 ... */` gave `Executable comments (/*! ... */) are not allowed.`;
  - `LOAD_FILE` gave `Keyword not allowed: LOAD_FILE`.
- No-op previews on `events` and `subjects` (`WHERE id = -1`) were accepted with `affected: 0`. A preview of `UPDATE subjects SET discord_channel_id = discord_channel_id WHERE id = -1` was also accepted, so the precondition of the static finding M1 holds (that column is writable from the console). I did not take it further.
- Foreign `Origin` as admin: `Invalid request origin.`; anonymous: 307.

### 8. Audit: pass
Dziennik (`/admin/audit`, admin) listed every change of mine with the right action and `"source": "web"` in the detail: `event.add` x10, `event.link` x2, `event.upload` (3, 10, 10 and 7 files, base names only), `event.delete` x10, `class_mark.add/edit/remove` (mark 5, note before-value kept) and the student's `class_mark.add/remove` (mark 6, "Ola Studentka"). All 14 rejected console statements appear as `sql.rejected` under the admin with the statement text and reason. Accepted previews are not logged (rollback only). Side remark: for events the "Table" column holds the event id, which reads oddly.

### New feature: entry-quiz actions and the session picker: pass
Called by direct POST (`addMarkAction`, `editMarkAction`, `removeMarkAction`, `skipMarkAction`, `unskipMarkAction`, `restoreMarkAction`, `sessionOptionsAction`).
- Allowed for any non-banned student: both attacker and student (Ola) added and removed a quiz on class 12, with an audit row each.
- Validation: class 0 / string / 999999 gave `Class not found.`; group 999999 gave `This group is not part of the class.`; a non-string note gave `Invalid note.`; a 5000-char note gave `The note can be at most 200 characters.`; a duplicate gave `Entry quiz is already on for this class.`; stale version gave the "changed" message (see F5); negative version or id 0 gave `Entry quiz not found.`; a SQL-like date, a date without a session and a 2020 date gave `There is no session of this class on that date.`; an unskip of a non-skipped date gave `This week is not skipped.`; removing twice gave `Entry quiz not found.`.
- `restoreMarkAction` as non-admin: 404 digest.
- Session picker (`sessionOptionsAction`): class 12 returned the upcoming sessions (value, label, date, times, room); class 0, 999999, `"1 OR 1=1"` and a string group returned `[]`. It reads through the read-only pool, so it exposes only what `v_class_sessions` already shows to every student.
- Anonymous and forged-cookie calls were redirected to `/login-info` and wrote nothing.

## What worked well
- Origin checks on the upload route, the admin console and Next's own action check; token reuse and the generic login failure for a banned user.
- Server-side limits that cannot be skipped by calling actions directly (both rate limits and the 413 on the declared length).
- Output is escaped everywhere I looked, including the audit detail page and the quiz note.

## Not tested / blocked
- Banned user's actions: a banned user cannot get a session, so `requireUser`/`checkUser` refusals ("Your access to the website is blocked.") could not be exercised over HTTP.
- 21 linked posts (only 17 topics exist), a real 95 MB body, series (repeat) creation, `/files` and `/api/material` content headers, admin restore of an event, and executing (not previewing) any write-console statement.
- Once during the run the server dropped one connection (`UND_ERR_SOCKET`, about 20 s of `000` responses) and then recovered. I think it was a dev-server reload caused by another persona; not investigated.
- Leftovers of my own data: events 11, 15-23 soft-deleted; 30 `queued` upload rows on event 11 (no bot is running, so they stay until the 24 h cleanup); posts 1 and 7 linked to event 11; entry quizzes 5 and 6 turned off.

## Summary table

| Control | Result |
|---|---|
| Anonymous refusal of all pages and `/api` routes | pass |
| Banned login refused | pass |
| Login link single use | pass |
| `/admin*` and `POST /api/admin/sql` 404 for students | pass |
| Restore refused for non-admins | pass |
| Deleted events 404 for students | pass |
| Event validation (16 cases, no rows written) | pass |
| Output encoding (event page, plan, quiz note) | pass |
| Upload limits, base-name storage, Origin check | pass |
| Event and file rate limits | pass |
| Read console cannot read `users`/`sessions` | pass |
| Read console does not leak server details | fail (low, F3) |
| Write console scope and single statement | pass |
| Audit of every change | pass |
| Entry-quiz actions and session picker | pass |
| Security headers, no `X-Powered-By` | fail (low, F1) |
| Cross-origin POST to `/auth/logout` and `/auth/callback` refused | fail (low, F2) |
