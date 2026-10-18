# qa-security-auditor — Mallory (attacker) — 2026-10-16

Summary: All documented controls held in the sandbox (http://localhost:3200). I found no authentication or
authorization bypass, no missing validation and no missing limit. The only findings are an information leak in
SQL console errors (DB user name and internal IP) and a few hardening notes. Test data I created: events 8, 10, 11,
18, 20, 24, 26-34 (25 deleted), a few tiny uploads on event 26, one link (event 26 - topic 1). The Server Actions
were called with Next's own `encodeReply` format over HTTP, because the dev server's constant Fast Refresh kept
resetting the browser form.

## Findings
### F1 [medium] SQL console errors reveal the DB user name and an internal IP
- Where: `POST /api/sql` (read console; any logged-in user, including `student`).
- Steps: 1. Log in as `student`. 2. POST `{"sql":"SELECT * FROM users LIMIT 1"}` to `/api/sql`.
- Expected: a generic Polish message, no host, user or schema detail.
- Actual: HTTP 200 with `{"ok":false,"error":"SELECT command denied to user 'studies_ro_qa'@'10.88.0.2' for table \`studies_qa_test\`.\`users\`"}`.
  The same happens for `sessions`, `admin_audit`, `subjects` and `UPDATE subjects ...`. It exposes the DB account, the
  client IP of the web container, the schema name and the table names.
- Evidence: the response excerpt above (no tokens).
- Suggestion: map ER_TABLEACCESS_DENIED / ER_COLUMNACCESS_DENIED / ER_DBACCESS_DENIED to a fixed message such as
  "Brak uprawnień do tej tabeli." Keep the user, host and schema out of it (the write console already does this).

### F2 [low] Rejections that come from MariaDB grants in the admin write console are not audited, and the message is misleading
- Where: `POST /api/admin/sql` (admin).
- Steps: preview `UPDATE users SET is_admin=is_admin WHERE 1=0`, `UPDATE events SET created_by=created_by WHERE 1=0`,
  `UPDATE materials SET sha256=sha256 WHERE 1=0`, `INSERT INTO materials (id) VALUES (999999)`.
- Expected: CLAUDE.md says every executed or rejected statement is written to `admin_audit`. The message should say
  why (column or table not writable).
- Actual: all return 400 "Brak uprawnień: ta tabela jest poza zakresem konsoli administratora." DROP and
  multi-statement rejections are audited (`sql.rejected`, Dziennik ids 14, 15, 49), but I saw no Dziennik row for the
  grant-denied ones above. Also `events` and `materials` are in `CONTENT_TABLES`, yet the message says "ta tabela jest
  poza zakresem", although only specific columns are denied (a guess: the message is mapped from the MariaDB denial).
- Suggestion: audit these refusals as `sql.rejected` too, and word the message per column ("tej kolumny nie można zmieniać").

### F3 [low] Upload route accepts requests with no `Origin` header
- Where: `POST /api/wydarzenia/26/pliki`.
- Actual: a request with no `Origin` is accepted (200); a foreign one is refused (403). Browsers always send `Origin`
  on cross-site POSTs, so this is only hardening. A session cookie with SameSite=Lax/Strict makes it moot (I did not check the cookie flags).

### F4 [idea] Unauthenticated API calls redirect (307/303) rather than return 401
- Where: all `/api/...` routes and the upload route (303). Fine for browsers; an API client gets a redirect to HTML.

## Checklist (expected -> observed)

1. Authentication: **pass**
   - Without a cookie, 36 routes (all of `/s/*`, `/plan`, `/wydarzenia/*`, `/admin*`, `/sql`, `/schema`, `/tables/*`,
     `/topics`, `/users`, `/api/sql`, `/api/schema`, `/api/admin/sql`, `/api/material/1`, `/files/1/original`,
     `/api/wydarzenia/1/pliki`) answered 307 to `/login-info` for GET and POST (upload route: 303). A bogus `sid=deadbeef`
     cookie gets the same (307 on `/s`, 303 on the upload route, no data).
   - Banned persona: `POST /auth/callback` with its token -> 303 `/login-info?error=expired`, no `sid` cookie set.
   - Reuse: a student token used twice -> the second POST gave 303 `/login-info?error=expired`.
2. Authorization: **pass**
   - `student` and `attacker`: `GET /admin`, `/admin/sql`, `/admin/audit`, `/admin/audit/1` and `POST /api/admin/sql` -> 404. `admin` -> 200.
   - Restore: I deleted my own event 25, then `restoreEventAction(25)` as attacker and as student -> 404 (NEXT_HTTP_ERROR_FALLBACK;404). The event stayed deleted.
   - Deleted event 25 as student/attacker: `/s/wydarzenia/25`, `/wydarzenia/25`, `/s/wydarzenia/25/edytuj`, `GET /api/wydarzenia/25/pliki` -> 404; upload POST -> 404; edit action -> "Nie znaleziono wydarzenia."
   - `/tables/users`, `/tables/sessions`, `/tables/admin_audit` as attacker -> 404.
3. Validation on events: **pass** (Server Action `createEventAction`; no rows written in any case)
   - 101-char title: "Tytuł musi mieć od 1 do 100 znaków."; empty title: same.
   - Date 2026-08-01: "Data nie może być więcej niż miesiąc wstecz."; 2028-10-25: "Data nie może być więcej niż rok naprzód."
   - End before start: "Koniec musi być po początku."; time 25:99: "Nieprawidłowa godzina."
   - Place 101: "Miejsce może mieć najwyżej 100 znaków."; note 1001: "Notatka może mieć najwyżej 1000 znaków."
   - Class of another subject (subjectId=2, classId=1): "Wybrane zajęcia nie należą do tego przedmiotu."; class without subject: "Zajęcia i grupę można wybrać tylko z przedmiotem."; unknown subject: "Nie znaleziono przedmiotu."
   - Bad kind / repeat rule: "Nieznany rodzaj wydarzenia." / "Nieznana reguła powtarzania."
   - Bad ids to link/delete (`"26; DROP"`, `-1`, `99999`): "Nie znaleziono posta." / "Nie znaleziono wydarzenia."; a duplicate link: "Ten post jest już powiązany."
   - Not tested: more than 20 linked posts. The sandbox has only 17 topics (ids 1-17), so the cap cannot be reached.
   - The HTML `maxlength=100` on the title field truncates client input; the server check is independent (shown above).
4. Output encoding: **pass**
   - Event 24: title `<b>x</b> [link](http://example.com) # heading <img src=x onerror=alert(1)>`, place `<b>x</b> [link](...)`, note with `# heading`, `<b>`, `<script>alert(1)</script>`.
   - `/s/wydarzenia/24`, `/wydarzenia/24`, `/s/plan?week=2026-W44` and `/plan?week=2026-W44`: all values are HTML-escaped (`&lt;b&gt;x&lt;/b&gt;`); no raw `<b>`, `<script>` or `<img>` in the HTML, and no link element made from the markdown. Screenshot: `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-16/qa-security-auditor-1.png`.
   - The start page `/s` and `/s/recent` do not list the event (not an event list), so there was nothing to check there.
5. Uploads: **pass**
   - 11 files -> 400 "Możesz wysłać najwyżej 10 plików naraz."; empty file -> 400 "Plik jest pusty."; 10 MB + 1 byte -> 400 "Plik jest za duży (maks. 10 MB)."; exactly 10 MB -> accepted.
   - Declared `Content-Length: 125829120` -> 413 "Łącznie maks. 95 MB na raz." (nothing else was sent). A declared 95 MB is within the limit and waits for the body, as designed.
   - Not multipart -> 400 "Nieprawidłowe żądanie."; unauthenticated -> 303 `/login-info`; invalid id -> 404; deleted event -> 404.
   - File names `../x.txt`, `..\..\etc\passwd`, `/etc/cron.d/x` are stored/shown as `x.txt`, `passwd`, `x`. Temp files under `.qa/storage/uploads/` have UUID names.
   - Foreign `Origin: http://evil.example` -> 403 "Nieprawidłowe pochodzenie żądania." (see F3 for a missing Origin.)
6. Rate limits: **pass**
   - 10 events created within the hour; the 11th returned "Możesz dodać najwyżej 10 wydarzeń na godzinę. Spróbuj później." and wrote no row.
   - Files: 30 accepted in the hour (batches of 1+1+3+10+10+5 on top of earlier ones), then a 1-file and a 3-file upload -> 429 "Limit 30 plików na godzinę. Spróbuj później."
7. SQL consoles: **pass** (apart from F1 and F2; after the sandbox DB-user fix)
   - Read console (`/api/sql`) as admin: `SELECT 1` ok; `users`, `sessions`, `admin_audit`, `subjects` -> denied by MariaDB; `SELECT 1; SELECT 2` -> syntax error (single statement only); `UPDATE subjects SET name=name` -> denied. `student` is denied on `users` too.
   - Write console (`/api/admin/sql`, preview mode only, rolled back): `users`, `sessions`, `admin_audit` -> "Brak uprawnień: ta tabela jest poza zakresem konsoli administratora."; two statements -> "Dozwolone jest tylko jedno polecenie."; `DROP TABLE` -> "Dozwolone są tylko polecenia SELECT, INSERT, UPDATE, DELETE i REPLACE."; `reminder_log`, `web_uploads` refused; `UPDATE events SET created_by=...`, `UPDATE materials SET sha256=...` and `INSERT INTO materials` refused; `UPDATE subjects SET name=name WHERE 1=0` and `UPDATE events SET title=title WHERE 1=0` previewed with 0 rows affected. Foreign `Origin` -> 403 "Nieprawidłowe pochodzenie żądania." I never executed a write.
8. Audit: **pass**
   - Dziennik (`/admin/audit`, as admin) shows my actions under "Mallory": `event.add` (24, 26-34 and the earlier ones), `event.delete` 25, `event.link` 26, and `event.upload` 26 with row counts 1, 1, 3, 10, 10, 5. DROP and multi-statement console rejections appear as `sql.rejected` (see F2 for the ones that don't).
   - I did not open each row's `source` field detail; the list does not show it.

## What worked well
- Every route was gated; the upload route (excluded from the proxy matcher) still refused anonymous requests itself.
- Per-field Polish messages were precise and identical across cases; failed validations wrote no rows and no audit.
- Upload limits were enforced while streaming; temp names are generated UUIDs.

## Not tested / blocked
- More than 20 linked posts (only 17 topics in the sandbox).
- Banned user's actions with a live session (no session can be created for `banned`).
- Executing a write in the admin console (read-only preview only, by the brief).
- A real 95 MB body (only a declared Content-Length, by the brief).
- Cookie flags (HttpOnly, SameSite, Secure) and session expiry were not inspected.

## Summary table

| Control | Result |
|---|---|
| Auth: pages and APIs refuse anonymous requests | pass |
| Auth: banned login refused | pass |
| Auth: login link single-use | pass |
| Admin pages and API 404 for non-admins | pass |
| Restore refused for non-admins | pass |
| Deleted events 404 for students | pass |
| Event validation (Polish messages, no rows) | pass |
| Link cap of 20 | not testable |
| Output encoding (event, plan) | pass |
| Upload limits (count, empty, 10 MB, total, anonymous) | pass |
| Upload file name sanitised | pass |
| Upload foreign Origin refused | pass (missing Origin accepted, F3) |
| Rate limit 10 events/hour | pass |
| Rate limit 30 files/hour | pass |
| Read SQL console blocks users/sessions | pass (error leaks DB user/IP, F1) |
| Write SQL console scope and single statement | pass |
| Admin console rejection audit | partial (F2) |
| Dziennik records my changes | pass |
