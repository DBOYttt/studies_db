# qa-admin — Adam Starosta (admin) — 2026-10-31

Summary: The new semester features work: the Timetable feeds card validates, masks and audits links, the write SQL console cannot read `unitime_feeds` or write `class_sessions.feed_semester`/`source`, and the audit page lists and filters `plan.feed_set`/`plan.feed_clear`. The usual admin flows (SQL preview/run/typed confirmation, weekly series edit/delete, restore, uploads) also work. I found no critical or high issues. The few findings are small wording and consistency gaps, plus an unexplained audit time mismatch. Testing was hampered by the dev server's constant Fast Refresh reloads.

Screenshots: they were saved by the browser server to `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-31/admin-<n>.png` (the main checkout, not the worktree). Numbers 1-32 are in that folder.

## Findings
### F1 [medium] (guess) Audit log timestamps do not match real time
- Where: /admin/audit, /admin/audit/29
- Steps: 1. Save a semester feed at about 02:05:50 CET (the card's "Updated" column shows 02:05:50). 2. Open the audit entry for `plan.feed_set`.
- Expected: The same time.
- Actual: Entry #29 says 01:50:54 CET (15 min earlier). My SQL run at about 02:24 CET is #56 and shows 01:55:26 (about 29 min earlier). The later `plan.feed_clear` entry shows 02:30:32, which is correct. So entries from the same session have inconsistent clocks.
- Evidence: .qa/screens/2026-10-31/admin-13.png, admin-14.png, admin-16.png. I did not find the cause; it may be a sandbox clock artefact.
- Suggestion: Check that `admin_audit.created_at` always comes from the same clock (DB `NOW()` vs the app).

### F2 [low] Clearing a feed: the confirmation does not say what it removes
- Where: /admin/sync, Timetable feeds card, Clear on semester 1
- Steps: 1. Click Clear. 2. Read the prompt.
- Expected: A warning that the semester's imported sessions are deleted at the next sync, which is hard to undo.
- Actual: "Clear the semester 1 feeds?" with Confirm clear / Cancel. After confirming the row simply returns to "Not set"; I saw no "cleared, sync requested" message because the row's status goes away with it.
- Evidence: .qa/screens/2026-10-31/admin-19.png, admin-20.png
- Suggestion: Add the consequence to the prompt, and show a success status for the clear (for example in the card status line).

### F3 [low] SQL console refusal for protected tables is vague
- Where: /admin/sql
- Steps: 1. Preview `UPDATE users SET is_admin = 1 WHERE id = 1`. 2. Preview `SELECT * FROM unitime_feeds`.
- Expected: A message that says the table is protected.
- Actual: "Table `users` is outside the console's scope." It does not say which tables are allowed. The column refusals ("Column `feed_semester` of `class_sessions` can't be changed from the console.") are clearer.
- Evidence: .qa/screens/2026-10-31/admin-9.png
- Suggestion: "`users` is not editable from this console. Allowed: content tables (see the Designer)" or a link to the list.

### F4 [low] The write-SQL preview says "Showing rows 0 – 0 (1 total)"
- Where: /admin/sql after previewing `UPDATE subjects SET ects = ects WHERE code = 'ASD'`
- Expected: "Showing rows 1 – 1 (1 total)".
- Actual: "0 – 0".
- Evidence: .qa/screens/2026-10-31/admin-10.png

### F5 [low] Audit Action filter does not offer event.*, class_mark.*, reminders.* actions
- Where: /admin/audit, Action dropdown
- Actual: The dropdown has 19 admin-type actions, including the new `plan.feed_set` and `plan.feed_clear`, but the log itself contains Event added, Entry quiz turned on, Reminders changed and so on, which cannot be filtered by action (only by user).
- Suggestion: Add the student-facing actions to the list, or say that the list is admin-only.

### F6 [low] Every refused SQL statement logs a browser console error
- Where: /admin/sql
- Actual: Each refusal adds a console error (an HTTP 4xx from the API). The UI itself handles it well; this is only noise.

### F7 [idea] Upload status list gives no hint why it is stuck
- Where: event page /s/wydarzenia/36, "Add files"
- Actual: Two files show "qa-admin-a.txt · sending…" and "qa-admin-b.txt · sending…". There is no time, no "waiting for the bot" text, and no retry or cancel (retry is only for failed uploads, which I could not produce without a bot). A user could wait forever on a queued upload.
- Evidence: .qa/screens/2026-10-31/admin-31.png
- Suggestion: Show "queued 12 min ago" and a note after a few minutes.

### F8 [idea] (environment) Dev-server reloads lose form state
- Where: whole sandbox (Next dev with constant "Compiling" and Fast Refresh)
- Actual: Pages reloaded by themselves many times, losing a half-filled feed form, the open "Confirm clear" prompt and a file chooser. Navigations also timed out twice at 60 s. I think this is the shared dev server under load and not an app bug, but it made a few checks flaky (see "Not tested").

## What worked well
- Timetable feeds card: set, then masked display (`plan.agh.edu.pl/…#74e1cd`), "Saving requests a timetable sync", the Timetable card shows "A sync is requested…". The form closes itself after success. Field errors appear under the input with `aria-invalid`: "Only links on plan.agh.edu.pl are allowed." for another host and "The link must start with https://." for http.
- Audit entry #29 (`plan.feed_set`, target Semester 1) has only host details (`classHost`, `examHost: null`, `source: web`), with no link or fingerprint. `plan.feed_clear` also appears and the filter finds it.
- SQL console refused: `SELECT * FROM unitime_feeds`, the same with a schema prefix, a backtick-quoted subquery inside an UPDATE of `subjects`, `UPDATE class_sessions SET feed_semester`, the same hidden after a comment, `SET \`source\``, and `INSERT INTO class_sessions (feed_semester)`. Refused statements are audited as "SQL rejected".
- UPDATE on 1 row: Preview says "1 row will be changed", Run gives "Saved … Audit log entry #56 →". The UPDATE on all 147 `class_sessions` rows asks for the typed table name and Run stays disabled with a wrong value.
- Overview shows the admins (3) and the latest audit entries; Admins-only user filter and entry detail page work.
- Weekly series (every week, from 3 Nov until 28 Nov): 4 occurrences. "This and following" on the 2nd changed 17 Nov too. "Delete: Only this one / This and following / Cancel" is a clear confirmation. The plan weeks show the series and the deleted occurrence is gone. "Restore" brought it back with "Event restored."
- Admin Subjects list is ordered by semester, then code; the Semester select offers 1-7.

## Not tested / blocked
- Feed link with a port or credentials, the optional exam link and "remove exam": the page reloaded before I could read the result (the http and other-host refusals did work).
- Upload retry: nothing fails without a bot.
- Deleting and restoring a whole event (not an occurrence) in the advanced UI; I used the simple UI.
- Whether a sync later clears or replaces sessions (no worker in the sandbox).
- Left behind in the sandbox: events 36-39 "QA admin seria tygodniowa" (39 deleted), 2 queued uploads on event 36, a feed row for none (semester 1 cleared again), and my SQL no-op on ASD.
