# qa-admin — Adam Starosta (admin) — 2026-10-16

Summary: The admin panel works end to end. Overview, SQL write (preview, execute, typed confirmation, protected-table refusal), weekly series edit/delete, restore, web upload and the Dziennik filters all behaved as designed. Main gaps: a protected-table SQL attempt is not written to the audit log, and several smaller confusions in labels and series display. The sandbox dev server also hot-reloaded the page repeatedly, which broke the upload flow until retried.

## Findings
### F1 [medium] Refused statement on a protected table (`users`) is not audited
- Where: /admin/sql, then /admin/audit?action=sql.rejected
- Steps: 1. In SQL — zapis type `UPDATE users SET is_admin = 1 WHERE id = 1`. 2. Click Podgląd. 3. Open Dziennik filtered by sql.rejected.
- Expected: Every rejected statement is audited (project docs say so; `DROP TABLE` and a two-statement input are logged with `mode: preview` and a reason).
- Actual: The UI shows "Brak uprawnień: ta tabela jest poza zakresem konsoli administratora." but the filter shows only 3 entries (#4, #14, #15), none for `users`. The most security-relevant refusal (privilege escalation attempt) leaves no trace. (Guess: the scope check runs before the audit call.)
- Evidence: .qa/screens/2026-10-16/admin-7.png, .qa/screens/2026-10-16/admin-22.png
- Suggestion: Audit scope refusals too, with the table name in the Tabela column.

### F2 [low] Protected-table message does not name the table or list allowed ones
- Where: /admin/sql
- Actual: "Brak uprawnień: ta tabela jest poza zakresem konsoli administratora." The red box shows the statement but not which table is blocked, and the hint line only says "tylko na tabelach treści".
- Suggestion: Name the table ("Tabela users jest chroniona") and link or list the writable tables.

### F3 [low] Series end date changes after editing/deleting an occurrence
- Where: /wydarzenia/15
- Steps: 1. Create a weekly series from 20.10.2026 until 14.11.2026. Page showed "co tydzień do 14.11.2026". 2. Edit the 2nd occurrence with "To i następne" (new time, place). 3. Delete the 3rd occurrence with "Tylko to" and restore it.
- Expected: The series end stays what the user entered (14.11) or the text says what it means.
- Actual: It now says "co tydzień do 10.11.2026" (the date of the last occurrence), even though the user typed 14.11.
- Evidence: .qa/screens/2026-10-16/admin-10.png (before), admin-15.png (after)
- Suggestion: Keep the entered end date, or show the last occurrence date consistently.

### F4 [low] Audit "Tabela" column holds event ids and `series:N`
- Where: /admin/audit
- Actual: For `event.*` rows the Tabela column shows "15", "series:2", "14" etc., which reads as a table name. Overview "Wiersze" is "–" for these.
- Suggestion: Rename the column to "Cel" or show "events #15" with a link to the event.

### F5 [low] Uploaded file list order is reversed
- Where: /wydarzenia/15, "Dodaj pliki"
- Actual: After choosing qa-admin-a.txt then qa-admin-b.txt, the status list shows b first, then a, both "wysyłanie…". No retry button and no explanation that the Discord bot must pick them up (expected in the sandbox, as there is no bot).
- Suggestion: Keep selection order; add a hint such as "Czekam na bota; zwykle trwa kilka sekund" after some time.

### F6 [low] No admin tab or link in advanced-mode tab bar and /wydarzenia has no index page
- Where: /wydarzenia (404), event pages
- Actual: `/wydarzenia` returns 404 in advanced mode; only /wydarzenia/nowe and /wydarzenia/<id> exist. Events are reachable only from /plan. (CLAUDE.md mentions `/wydarzenia` as an entry point.)
- Suggestion: Add a list page or redirect to /plan.

### F7 [low] Delete confirmation does not distinguish the more destructive "To i następne"
- Where: /wydarzenia/<id>, Usuń
- Actual: Inline question "Usunąć to wydarzenie? Tylko to / To i następne / Anuluj". Both buttons look identical, and "To i następne" deletes a whole tail of the series with no count ("usunie 3 wydarzenia"). Restore exists per occurrence, so it is recoverable but slow.
- Evidence: .qa/screens/2026-10-16/admin-13.png
- Suggestion: Show the number of affected occurrences; offer restore for the whole tail.

### F8 [low] Breadcrumb truncated, audit count looks off by one
- Where: /admin/audit/9 header; /admin/audit
- Actual: The breadcrumb collapses to "Ad… » Dzien… » Wpis: #…" at 1280 px. The unfiltered Dziennik says "30 wpisów" while ids run to 31 and #25 is absent from the list (guess: filtered out, e.g. another persona's entry type; not verified).
- Evidence: .qa/screens/2026-10-16/admin-5.png, admin-20.png

### F9 [idea] Preview of a no-op UPDATE says "1 wiersz zostanie zmieniony"
- Where: /admin/sql
- Actual: `UPDATE subjects SET ects = ects WHERE code='ASD'` previews "1 wiersz zostanie zmieniony" and "Pokazano wiersze 0 – 0 (1 łącznie)". Audit shows 1 changed row. Wording "dopasowany" would be more accurate than "zmieniony". Not a bug.

### F10 [idea] Sandbox: dev server hot-reloads pages during use
- Where: any page, notably /wydarzenia/15
- Actual: Console shows repeated "[Fast Refresh] rebuilding" and "HMR connected" about every 10 s; the page reloaded while the file chooser was open, so the first two upload attempts failed with "Execution context was destroyed" and the selected files were lost. It worked on the third try. Probably caused by the sandbox running `next dev` with another process touching files, not the app itself.

## What worked well
- Przegląd shows counts, the two admins (Adam Starosta, Ula Kuratorka) and the recent audit log with a link to the full log.
- SQL write: the Wykonaj button stays disabled until Podgląd, and after editing the text; the yellow banner explains that changes are written to the DB and the log. Success message links to the audit entry (#9) which shows statement, table, rows and `previewAffected`.
- `UPDATE class_sessions SET uid = uid` (126 rows) asks for the typed table name; "class" keeps Wykonaj disabled. (I did not execute it.)
- Weekly series created with 4 occurrences (20.10, 27.10, 3.11, 10.11); "To i następne" applied time and place to the 2nd and following ones; "Tylko to" deleted a single occurrence; the deleted page shows "Wydarzenie usunięte" and Przywróć; restore worked and was audited (event.delete, event.restore).
- Upload of 2 small files: rows show "wysyłanie…" and an `event.upload` audit entry (2 rows). Upload limits are stated on the page.
- Dziennik: Wszyscy/Admini toggle (13 admin entries), action filter with descriptive labels, clear-filters link, and the entry detail page with JSON details.

## Not tested / blocked
- Executing the 126-row UPDATE and the typed-confirmation success path.
- Retry option for failed uploads (no bot, rows never reach "failed"); status refresh when the bot finishes.
- Series "To i następne" delete, editing the first occurrence, and "Admin" dropdown filter in Dziennik.
- Simple mode (/s/...) versions of the event pages.
- Screenshots: .qa/screens/2026-10-16/admin-1.png through admin-23.png.
