# qa-security-auditor — Mallory (attacker) — 2026-10-19-r1

Summary: Re-test after fixes. All three previous findings are fixed. The full checklist passes: no critical, high or medium findings. A few low hardening notes remain (the RO console still returns the DB user, host and schema for a plain `SELECT user()`; the RO console and Server Actions accept a missing or foreign Origin, mitigated by `SameSite=lax`; logout accepts a foreign Origin). Tested only on `http://localhost:3200` with the sandbox personas attacker, student, admin and banned. Server Actions were called by direct multipart POST, because the form's `maxLength` blocks a 101-character title in the browser. No real change was executed in the admin console (previews only, rolled back).

## Re-check of previous findings

| # | Previous finding | Result |
|---|---|---|
| 1 | RO console errors reveal DB user, host/IP or schema name | FIXED for errors (see F1 for a leftover through a successful query) |
| 2 | Admin write console: grant-refused statements need a message naming the table or column and a `sql.rejected` Dziennik row | FIXED |
| 3 | Upload route must refuse a request with no `Origin`, still accept browser uploads, and still refuse a foreign Origin | FIXED |

Evidence for 1. `POST /api/sql` as student (all responses are 200 with `ok:false`):
- `SELECT * FROM users` → `SELECT command denied for table \`users\``
- `SELECT * FROM sessions` → `... denied for table \`sessions\``
- `SELECT * FROM studies_qa_test.users` → `... denied for table \`users\``. The schema prefix is stripped.
- `SELECT * FROM mysql.user` → `... denied for table \`mysql\`.\`user\``
- `SELECT 1; SELECT 2` and `SELEC 1` → the syntax error text only. It has no user, host or schema.
- `DROP TABLE v_files` → `DROP command denied for table \`v_files\``
- `INTO OUTFILE` → `Access denied; you need (at least one of) the FILE privilege(s) for this operation`

None of these errors contains `studies_ro_qa`, an IP or `studies_qa_test`.

Evidence for 2. `POST /api/admin/sql {"mode":"preview"}` as admin:
- `UPDATE users SET name = name WHERE id = 0` → 400 `Table \`users\` is outside the console's scope.`
- `UPDATE events SET topic_id = topic_id WHERE id = 0` → 400 `Column \`topic_id\` of \`events\` can't be changed from the console.`
- `UPDATE event_series SET topic_id = ...` → 400 `Column \`topic_id\` of \`event_series\` can't be changed from the console.`
- `UPDATE materials SET storage_path = storage_path ...` → 400 `Column \`storage_path\` of \`materials\` can't be changed from the console.`
- Dziennik (`/admin/audit`) lists every one of these as `sql.rejected` with the statement (rows 5 to 17 and 58 to 65). The `UPDATE users` row is #5 and the `events.topic_id` row is #6.
- A permitted no-op (`UPDATE events SET title = title WHERE id = 0`) returned `affected: 0` and a preview token.

Evidence for 3 (`POST /api/wydarzenia/15/pliki`):
- No `Origin` header → 403 `{"error":"Nieprawidłowe pochodzenie żądania."}`.
- `Origin: http://evil.example` → 403, same body.
- `Origin: null` → 403, same body.
- A browser upload (Playwright, "Dodaj pliki") → POST 200. The file appeared as "wysyłanie…" (screenshot `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-19-r1/qa-security-auditor-1.png`).
- `curl` with `Origin: http://localhost:3200` → 200.

## Findings

### F1 [low] RO SQL console still exposes DB user, host and schema through a successful query
- Where: `POST /api/sql` as student.
- Steps: 1. Send `SELECT user(), database(), @@hostname`.
- Expected: no internal infrastructure details (the previous finding was about errors, and the errors are now clean).
- Actual: 200, `["studies_ro_qa@10.88.0.2","studies_qa_test","209e3cc7a514"]`. `information_schema.tables` is also readable, but it lists only the `v_*` views (the grants limit it). The admin write console likewise returns `studies_rw_qa@10.88.0.2` for `SELECT user()` (admin only).
- Suggestion: optionally reject `user()`, `current_user()`, `database()`, `@@hostname` and `information_schema` in the classifier. This is hardening only, since it is a legitimate SELECT.

### F2 [low] Missing or foreign `Origin` is accepted by `/api/sql`, by Server Actions with no Origin, and by `/auth/logout`
- Where:
  - `POST /api/sql` as student, with no Origin and with `Origin: http://evil.example` → both 200 with data.
  - A Server Action POST with no Origin header → executed. This one is a non-browser client. A foreign Origin → 500 `Invalid Server Actions request.`, which is correct.
  - `POST /auth/logout` with `Origin: http://evil.example` → 303 to `/login-info` with the cookie cleared (my student session was ended).
- Expected: the same Origin refusal that `/api/admin/sql` (403 for both cases) and the upload route now have.
- Actual: inconsistent. Real-world risk is low:
  - the cookie is `HttpOnly; SameSite=lax`, so a cross-site POST carries no session;
  - the RO console is SELECT-only and the response isn't readable cross-origin.
- Suggestion: reuse `isCrossOrigin` in `/api/sql` and `/auth/logout` for consistency. A Server Action without an Origin is a Next.js default and only reachable by non-browser clients.

### F3 [low] The 95 MB total is enforced on the stream, with a 96 MB declared-length pre-check
- Where: `POST /api/wydarzenia/<id>/pliki`.
- Actual: a declared `Content-Length: 100663297` (96 MB + 1) → 413 `Łącznie maks. 95 MB na raz.`. A declared length of exactly 95 MB + 1 byte passes the header check, because the pre-check allows 1 MB of overhead, and the connection waits for the body. The streaming byte counter still enforces the limit.
- Suggestion: none required. It is noted only because it differs from "declared over 95 MB is refused up front".

### F4 [low] Dziennik list does not show the audit source (web or discord)
- Where: `/admin/audit`.
- Actual: the table columns are `# / Czas / Admin / Akcja / Tabela / Wiersze / Instrukcja`. The `source` field is not shown. It is visible on the event page under "Historia" ("przez stronę"). The action, target and user are correct for every row I created (items 8 below).
- Suggestion: add a "Źródło" column or show details in the audit list.

## Checklist results

1. Authentication: pass.
   - All of `/s`, `/s/plan`, `/s/wydarzenia[/nowe|/1]`, `/plan`, `/wydarzenia[/nowe|/1]`, `/sql`, `/tables`, `/admin`, `/admin/sql`, `/admin/audit`, `/api/schema`, `/api/material/1`, `/api/admin/sql`, `/api/wydarzenia/1/pliki`, `/files/1/original` and `/` → 307 to `/login-info` without a cookie.
   - POST `/api/sql`, `/api/admin/sql` and the upload route without a cookie → 307.
   - With a bogus `sid=bogus` cookie the pages and APIs also redirect (proxy plus `requireUser`). The upload with a bogus cookie → 303.
   - `GET /api/sql` → 405.
   - The banned persona's link → 303 `/login-info?error=expired` (refused).
   - A reused attacker link → 303 `/login-info?error=expired`.
2. Authorization: pass.
   - student and attacker: `/admin`, `/admin/sql`, `/admin/audit` and `POST /api/admin/sql` → 404.
   - Deleted event 13: student and attacker get 404 on `/s/wydarzenia/13` and `/wydarzenia/13`.
   - `restoreEventAction` as attacker and as student → 404. As admin it works (`Przywrócono wydarzenie.`) and appears as `event.restore` in Dziennik.
3. Event validation: pass. Server Actions were called directly, and each case returned the documented Polish message with no row written (v_events shows no such titles).

   | Case | Result |
   |---|---|
   | 101-char title | `Tytuł musi mieć od 1 do 100 znaków.` |
   | blank title | same message |
   | date 2026-08-01 and 2026-09-10 | `Data nie może być więcej niż miesiąc wstecz.` |
   | date 2028-10-30 | `Data nie może być więcej niż rok naprzód.` |
   | end before start | `Koniec musi być po początku.` |
   | start `25:99` | `Nieprawidłowa godzina.` |
   | unknown kind | `Nieznany rodzaj wydarzenia.` |
   | class of another subject (class 2 with subjects 2 to 6) | `Wybrane zajęcia nie należą do tego przedmiotu.` |
   | class without a subject | `Zajęcia i grupę można wybrać tylko z przedmiotem.` |
   | 101-char place | `Miejsce może mieć najwyżej 100 znaków.` |
   | 1001-char note | `Notatka może mieć najwyżej 1000 znaków.` |

   - The browser form also refuses these via `maxLength=100`, and the browser showed `Koniec musi być po początku.`
   - More than 20 linked posts: not exercised. The sandbox has only 17 topics (`MAX_EVENT_LINKS = 20` in `packages/db/src/events.ts`). 17 links succeeded, and ids 18 to 22 returned `Nie znaleziono posta.`. This part is UNVERIFIED.
4. Output encoding: pass.
   - Event 15 has title `<b>x</b> [l](http://example.com) # h`, place `<i>pl</i> [p](http://example.com)` and note `<script>alert(1)</script> # heading <img src=x onerror=alert(1)> **bold**`.
   - In the HTML of `/s/wydarzenia/15`, `/wydarzenia/15`, `/s/plan?week=2026-W44`, `/plan?week=2026-W44` and `/s` there is no raw `<b>`, `<script>` or `<img src=x`, and no `<a href="http://example.com`. The text appears escaped (`&lt;b&gt;x`).
   - The screenshot shows it as plain text.
5. Uploads: pass.
   - 11 files → 400 `Możesz wysłać najwyżej 10 plików naraz.`
   - An empty file → 400 `Plik jest pusty.`
   - A file of 10 MB + 1 byte → 400 `Plik jest za duży (maks. 10 MB).`, and no temp file is left in `.qa/storage/uploads`.
   - Declared length over the total (100663297) → 413 `Łącznie maks. 95 MB na raz.`
   - No session → 303.
   - `filename=../../etc/x.txt` is stored as `x.txt`, and `..\\..\\win.txt` as `win.txt`. The files on disk are `uploads/<uuid>`.
   - Foreign, `null` and missing Origin → 403.
6. Rate limits: pass.
   - Events: the 10th creation succeeded and the 11th returned `Możesz dodać najwyżej 10 wydarzeń na godzinę. Spróbuj później.`. A series creation is refused too.
   - Files: 30 files accepted (batches of 3, 10, 10 and 7), then 429 `Limit 30 plików na godzinę. Spróbuj później.`, repeated once.
7. SQL consoles: pass.
   - The RO console refuses `users`, `sessions`, `admin_audit`, `web_uploads` and `mysql.user`.
   - The write console previews returned these refusals:
     - `users`, `sessions`, `admin_audit`, `web_uploads`, `reminder_log` and `mysql.user` → `Table ... is outside the console's scope.` This also holds for a subquery (`... IN (SELECT id FROM users)`), a JOIN, `INSERT ... SELECT ... FROM sessions` and a backticked name.
     - `; DROP TABLE users` → `Dozwolone jest tylko jedno polecenie.`
     - `CREATE TABLE` → `Dozwolone są tylko polecenia SELECT, INSERT, UPDATE, DELETE i REPLACE.`
     - `INTO OUTFILE` → `Niedozwolone słowo kluczowe: INTO`
     - `INSERT INTO materials` → outside the console's scope
   - A trailing `;` or `/* ; */` is treated as a single statement, which is accepted.
   - No statement was executed (previews roll back).
8. Audit: pass. As admin, Dziennik shows my changes with the right user, action and target:
   - `event.add` 9, 13, 14, 15 and 16 to 21
   - `event.link` ×17 on 13
   - `event.delete` 13
   - `event.upload` on 15 with 2, 1, 10, 10 and 7 files
   - `event.restore` 13 by admin
   - `sql.rejected` ×17 or more

   The source ("przez stronę") is visible on the event's Historia (see F4).

## What worked well
- Error sanitising now covers every refusal path I tried on both consoles.
- The uploader and the admin console refuse a missing Origin, and refused statements are audited with a clear reason.
- Rate limits hold exactly at 10 events and 30 files per hour.
- Escaping is consistent in all five views.
- The `sid` cookie is `HttpOnly; SameSite=lax`.

## Not tested / blocked
- More than 20 linked posts (only 17 topics exist).
- Executing a real admin write, which is out of bounds.
- A banned user's write actions, because the banned login is refused.
- Series scope and cap (30 occurrences, 1 year), because the attacker was already at the hourly limit and I did not write as another persona.
- Test data left behind: events 9, 13 to 21 (the one with `ratelimit` titles, the HTML one and others) and about 30 small temp uploads on event 15, all owned by attacker.
- Dev-server note: error responses from `next dev` contain stack traces (for example for a malformed Server Action call). Check that production does not.
