# qa-security-auditor — Mallory (attacker) — 2026-10-30

Summary: The documented controls held in every check. No authentication or authorization bypass, no write that should have been refused, and no leak of other users' data. I found one medium (the read console's `SHOW GRANTS` shows the `studies_ro` password hash) and a few low hardening points. Server Actions were called directly by POST with the action ids from the dev manifest, so the checks did not depend on the UI.

Method: curl and small Python helpers against `http://localhost:3200` only (sandbox, confirmed `200` on `/login-info`). Personas: attacker, student, admin (for the admin-only checks), banned (login only). Screenshots: `.qa/screens/2026-10-30/qa-security-auditor-1.png` (event created with HTML/markdown title) and `-2.png` (event page showing it as plain text).

## Findings

### F1 [medium] `SHOW GRANTS` in the read console exposes the RO user's password hash
- Where: `POST /api/sql` (also the advanced `/sql` console), any logged-in student.
- Steps: 1. Log in as attacker. 2. `POST /api/sql {"sql":"show grants"}`.
- Expected: no credential material in what a student can read.
- Actual: `200`, `Grants for studies_ro_qa@%` → `GRANT USAGE ON *.* TO studies_ro_qa@% IDENTIFIED BY PASSWORD '*B3FB…8C82' WITH MAX_USER_CONNECTIONS 10 MAX_STATEMENT_TIME 5.000000` (hash shortened here). The same console also reads `information_schema`.
- Impact: a student can take the hash of the read-only DB password and crack it offline. It matters only if the DB port is reachable, and the account only has SELECT on the views.
- Suggestion: have the console classifier refuse `SHOW GRANTS`, `SHOW CREATE USER` and similar, or create the RO user so the hash isn't shown. Rotating the RO password limits the damage.

### F2 [low] Series count as one event in the hourly limit
- Where: `packages/db/src/event-series.ts` (read only; I did not create series).
- Actual (from code): `addSeries` calls `checkAddRateLimit` once and writes one `event.add` row, so a user can create 10 series × 30 occurrences = 300 event rows per hour.
- Suggestion: count occurrences (or cap series per hour). This follows the spec literally ("10 new events"), so it is a hardening idea.

### F3 [low] Dev-mode stack traces in Server Action errors
- Where: a Server Action with a malformed body, as admin: `POST /admin/users` with `Next-Action: <setBanAction>` and a `text/plain` body → `500` with `"form.get is not a function"` and a stack of `webpack-internal:///(rsc)/./lib/admin-forms.ts…`. A student calling `updateEventAction` with a missing form got `Cannot read properties of undefined (reading 'get')`.
- Probably dev-server only (`"b":"development"`); I can't confirm production behaviour. The CSP also has `'unsafe-eval'`, which I expect is dev-only too.
- Suggestion: confirm that the production build returns the generic digest only.

### F4 [idea] Spec says validation messages are Polish; the app returns English
- The messages match the project's current rule that the UI is English, so I don't count this as a failure. The 2026-10-15 spec text is out of date.

## Checklist (expected → observed)

1. **Authentication: pass**
   - Without a session, all 44 GET paths listed below returned `307 → /login-info`: `/`, `/s*`, `/plan`, `/schema`, `/search`, `/sql`, `/structure`, `/subjects/*`, `/lecturers/*`, `/tables/*`, `/tags/*`, `/topics/*`, `/users/*`, `/wydarzenia/*` (including `nowe` and `edytuj`), every `/admin*` page, `/api/schema`, `/api/sql`, `/api/admin/sql`, `/api/material/1`, `/api/wydarzenia/1/pliki`, `/files/1/original` and `/files/1/preview`.
   - Unauthenticated `POST` to `/api/sql`, `/api/admin/sql` and `/api/wydarzenia/1/pliki` returned `307 → /login-info`.
   - A forged cookie `sid=bogus` behaves the same (the route handlers and pages call `requireUser`, not just the proxy). A Server Action POST without a cookie returned `307 /login-info`.
   - Banned persona: `POST /auth/callback` with its fresh token → `303 /login-info?error=expired` (refused).
   - Used link: replaying the attacker's token → `303 /login-info?error=expired`. A foreign `Origin` on `/auth/callback` → `403`.
   - Code check: `getSessionUser` filters `is_banned = false`, so an old session of a banned user stops working.

2. **Authorization: pass**
   - As attacker and as student: `GET /admin`, `/admin/audit`, `/admin/audit/1`, `/admin/lecturers`, `/admin/lecturers/1`, `/admin/sql`, `/admin/subjects`, `/admin/subjects/BD`, `/admin/sync`, `/admin/users` → `404`. `POST /api/admin/sql` → `404`.
   - As admin, `/admin/users` → `200` (so the 404s are real authorization, not broken pages).
   - **New admin round-2 Server Actions** (direct POST with `Next-Action`): `addSubjectAction`, `editSubjectAction`, `editClassAction`, `addLecturerAction`, `editLecturerAction`, `assignLecturerAction`, `setBanAction`, `requestPlanSyncAction`, `requestBotAction` and `cancelBotRequestAction`, each as student and as attacker → every one answered with `NEXT_HTTP_ERROR_FALLBACK;404` from `requireAdmin` (stack top: `requireAdmin … lib/session.ts`). No effect on the data: no sync request appeared in Dziennik for those calls.
   - `restoreEventAction` and `restoreMarkAction` as student and as attacker → `404` (admin-only).
   - A deleted event (my own event 40): `GET /s/wydarzenia/40` and `/wydarzenia/40` as student and attacker → `404`. `linkTopicAction(40, 1)` → "Event not found." `POST /api/wydarzenia/40/pliki` → `404`.
   - The banned persona has no session, so I could not call these as banned. The `getSessionUser` filter makes it the same as an anonymous user.

3. **Validation on events: pass** (direct `createEventAction`, every case `200` with a refusal message and no new row, confirmed by the next event id)
   - Title of 101 chars → "The title must be 1 to 100 characters." (an empty title gives the same)
   - Date 2026-08-01 → "The date cannot be more than a month in the past."
   - End 11:00 before start 12:00 → "The end must be after the start."
   - Place of 101 chars → "The place can be at most 100 characters." Note of 1001 chars → "The note can be at most 1000 characters."
   - Subject 1 with class 4 (belongs to subject 2) → "The chosen class does not belong to this subject." Subject 99999 → "Subject not found."
   - Bad kind → "Unknown event type." Bad date → "Enter the event date."
   - More than 20 linked posts: **not reproducible**, because the sandbox has only 18 topics. The cap exists in code (`events.ts:57`, check at line 554: "You can link at most 20 posts.").
   - Messages are English, see F4.

4. **Output encoding: pass.** Title, place and note were `<b>x</b> [link](http://example.com) # heading` (the note also had `<img src=x onerror=alert(1)>`). In the HTML of `/s/wydarzenia/39`, `/wydarzenia/39`, `/s/wydarzenia/39/edytuj`, `/s/plan?week=2026-W44`, `/plan?week=2026-W44` and `/s`, the text appears as `&lt;b&gt;x&lt;/b&gt;…`; there is no raw `<b>`, `<img`, `<h1>` or `<a href="http://example.com">` anywhere. The audit page (Dziennik) escapes it too. Screenshots 1 and 2.

5. **Uploads (`POST /api/wydarzenia/39/pliki`): pass**

   | Case | Result |
   |---|---|
   | unauthenticated, and forged `sid` | redirect to `/login-info`, no row |
   | foreign `Origin: http://evil.example`, and no Origin | `403 {"error":"Invalid request origin."}` |
   | 11 files | `400 You can send at most 10 files at once.` |
   | empty file | `400 The file is empty.` |
   | 10 MB + 1 byte | `400 A file is too large (max 10 MB).` |
   | declared `Content-Length: 104857600` (raw socket, no body sent) | immediate `413 Payload Too Large` |
   | event 40 (deleted), `abc` | `404 Event not found.` |
   | file name `../../x.txt` | `200`, stored and shown as `x.txt`; nothing named `x.txt` appears under `.qa` |

   One request with the declared length at exactly 95 MiB (inside the allowed body size) waited for the missing body until my client timed out, as expected; the busy slot was released after the socket closed.

6. **Rate limits: pass**
   - Events: I created 10 in the hour (ids 39, 40, 42–49). The 11th (and the next ones) → "You can add at most 10 events per hour. Try again later." Refused calls wrote no row.
   - Files: 1 + 10 + 10 + 9 = 30 accepted. The 31st (1 file) and the next batch of 3 → `429 Limit of 30 files per hour. Try again later.`
   - **New, group import limit:** 7 uploads of a non-calendar file, the first six reached the parser ("That is not a UniTime calendar (.ics)."), the 7th → "Too many imports. Try again in a few minutes." (6 per 10 min).
   - Admin write console: more than 20 requests in a minute → "Too many queries. Please wait a moment." (refused statements in that window were not written to the audit log).

   **iCal group import (new surface), `previewGroupImportAction`, direct POST, no outbound fetch made** (I never sent a link on the allowlist, to keep traffic inside the sandbox):

   | Input | Result |
   |---|---|
   | `http://plan.agh.edu.pl/…`, `ftp://…`, `file:///etc/passwd` | "Use an https:// link from plan.agh.edu.pl." |
   | `https://u:p@plan.agh.edu.pl/…`, `https://plan.agh.edu.pl@evil.example/…` | same message (userinfo refused) |
   | `https://plan.agh.edu.pl:8443/…` | same message (port refused) |
   | `https://localhost/…`, `https://127.0.0.1/…`, `https://evil.example/…` | "Only links from plan.agh.edu.pl can be imported." |
   | `https://evil.plan.agh.edu.pl/…`, `https://plan.agh.edu.pl.evil.example/…`, `webcal://evil.example/…` | same "Only links from…" |
   | 600-char link, `abc`, empty | "That link is too long." / "That is not a link." / "Paste a UniTime link or choose a .ics file." |
   | a `.ics` of 2 MB + 16 bytes | "The file is too large (max 2 MB)." |
   | no session | `307 /login-info` |

   Error messages name only the allowed host and never echo the pasted link. The size and 15 s time limits for a fetched link, and the same-host redirect rule, exist in `packages/db/src/unitime/fetch.ts`; I did not test them because that needs a real outbound fetch. `applyGroupImportAction` refused non-numeric ids, a list of 101 pairs and non-array input ("Invalid selection."); a pair with a non-existent group answered `ok` and wrote nothing (per code, rejected by the class/group match).

7. **SQL consoles: pass for the boundary, with F1**
   - Read console (`POST /api/sql`, as attacker and admin): `users`, `sessions`, `admin_audit`, `login_tokens`, `web_uploads`, `bot_requests` and `mysql.user` → "SELECT command denied for table …". `select 1; select 2` → syntax error (single statement only). `UPDATE v_events …` → "UPDATE command denied". `load_file('/etc/passwd')` → `null`. The public views (`v_events`, `v_users` with id, display name, created_at) are readable as documented. Deleted event 40 isn't in `v_events`.
   - Write console (`POST /api/admin/sql`, admin; previews only, plus one executed no-op): `SELECT * FROM users|sessions`, `UPDATE users|sessions|admin_audit|bot_requests|web_uploads|reminder_log …` → "Table `…` is outside the console's scope." Subquery and join variants through `sessions` or `users` (also with backticks and `mysql`.`user`) → same refusal. Two statements → "Only one statement is allowed." `CREATE TABLE`, `DROP TABLE` → "Only SELECT, INSERT, UPDATE, DELETE and REPLACE statements are allowed." `LOAD_FILE` → "Keyword not allowed: LOAD_FILE". `/*!50000 UPDATE */` → "Executable comments (/*! … */) are not allowed." `UPDATE events SET topic_id = topic_id` and `UPDATE materials SET stored_path = stored_path` → "Column … can't be changed from the console."
   - Executed `UPDATE events SET title = title WHERE id = 39` (my own event): `ok`, `affected: 1`, `auditId: 94`. Reusing its token → "Token already used. Run the preview again." As student → `404`. Foreign `Origin` as admin → `403 Invalid request origin.`

8. **Audit: pass.** As admin, `/admin/audit` showed my changes, each with the right action and source "via the website": Event added (39, 40, 42–49), Event deleted (40), Event changed (39, "changed: start, end, note"), Files added (1, 10, 10, 9 rows), and the executed `SQL executed | events | 1` row plus every `SQL rejected` row with its statement. Other personas' rows were present too.

## What worked well
- Every Server Action checks the session or admin role itself. Direct POSTs with valid action ids from outside the UI were still refused.
- The write console is strict in layers: an application classifier (scope, columns, keywords, comments) and the DB grants, plus one-shot preview tokens.
- The group import error messages never echo the link.
- The upload route enforces limits while streaming, and a rejected upload leaves nothing in `storage/uploads` that I could find.

## Not tested / blocked
- More than 20 linked posts (only 18 topics in the sandbox).
- The banned persona's pages and Server Actions with a live session (no session can be issued); covered by code reading only.
- A real fetch for the group import (size limit, 15 s timeout, redirect to another host): it needs outbound traffic to an allowlisted host, which I avoided on purpose. Verified from code only.
- Series occurrences against the hourly limit (F2), and an upload of exactly 10 MB and the 95 MB total with a real body.
- Production-mode error output and CSP (F3): the sandbox runs `next dev`.
- My test data left in the sandbox: events 39, 42–49 (and deleted 40), 29 queued upload rows on event 39.
