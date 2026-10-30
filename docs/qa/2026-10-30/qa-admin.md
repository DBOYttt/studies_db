# qa-admin — Adam Starosta (admin) — 2026-10-30

Summary: The admin flows work and are well guarded: the overview, SQL write (preview, run, typed confirmation above 100 rows, refusal of protected tables), event series edit/delete/restore, uploads and the audit filters. The new round-2 pages (Subjects, Lecturers, Users, Sync) mostly behave as intended. The weak spots are changes that are hard to undo from the UI (lecturer assignment silently creates groups and classes, there is no unassign or delete), a few misleading status labels, and the SQL write console losing its state when the dev server recompiles.

Caveat: the sandbox runs `next dev`, and during the run it kept recompiling ("Compiling…", Fast Refresh rebuilding). Several pages hard-reloaded in the middle of an action. That hit the SQL console (F1) and a form (F9). I treat those as dev-server noise unless stated otherwise.

## Findings

### F1 [medium] SQL write: page reloads mid-preview/run and the result disappears (dev server; run result invisible)
- Where: /admin/sql
- Steps: 1. Type a statement. 2. Preview, then Run (or just Preview). 3. The dev server recompiles ("Compiling…").
- Expected: the result panel ("Saved: UPDATE on subjects, rows changed: 1. Audit log entry #N") stays visible.
- Actual: the page did a full reload. Editor and result were empty and the button stayed on "Running…" or "Previewing…". The statement WAS executed (audit #31 for `UPDATE subjects ... code = 'SK'`, #35 for the 129-row `class_sessions` update). Nothing on screen said so, so an admin could Run again. Preview of `DELETE FROM subjects` never returned for the same reason, so that preview was not verified. On a quiet server the result banner did appear (a later DELETE showed "Saved: DELETE on class_groups, rows changed: 1." with a link to "Audit log entry #56"). Evidence: `.qa/screens/2026-10-30/admin-4.png`, `admin-8.png`, `admin-29.png`.
- Suggestion: keep the Run state and result in the URL/sessionStorage, or at least show "Last run: …" from the audit log after a reload. Re-running a write after a lost response is the real risk.

### F2 [medium] Lecturer assignment silently creates groups and classes; there is no way to undo it in the UI
- Where: /admin/subjects/SK, "Assign a lecturer" (top form and per-class forms)
- Steps: 1. Pick "dr hab. Anna Nowak", class type Wykład, group 99. 2. Assign.
- Expected: a warning that group 99 does not exist, or a refusal.
- Actual: group "Gr. 99" was created on a lecture that has "no groups", Anna Nowak was assigned, and the message was "Assigned the lecturer to SK / Wykład, Gr. 99." It does not name the lecturer. The help text only says "A class type the subject does not have yet is created." The page has no Remove or Unassign control and no delete group or class. I had to clean up with SQL write (`DELETE FROM class_groups WHERE number = 99`). Evidence: `admin-27.png`.
- Suggestion: confirm when a new class or group would be created ("Creates group 99 on SK / Wykład"), name the lecturer in the success message, and add Unassign (and delete empty group/class).

### F3 [medium] Admin SQL DELETE preview undercounts cascades
- Where: /admin/sql
- Steps: 1. `DELETE FROM class_groups WHERE number = 99`. 2. Preview, then Run.
- Expected: a note that dependent rows (class_lecturers) will go too.
- Actual: "1 row will be changed" and "rows changed: 1", while the sidebar view counts show class_groups 16 to 15 and class_lecturers 19 to 18 (two rows gone). The typed confirmation only triggers above 100 rows, so a cascading DELETE on one subject row (which takes classes, groups, sessions) would get no extra warning. Not executed, because the DELETE FROM subjects preview was blocked by F1. Evidence: `admin-28.png`, `admin-29.png`.
- Suggestion: in the preview, count FK-cascade rows (or at least say "may also delete dependent rows") and require the typed confirmation for DELETE on subjects, classes, events, event_series regardless of row count.

### F4 [medium] Cancelled bot request is shown as "failed" in red
- Where: /admin/sync, "Bot requests" table
- Steps: 1. Run setup, Confirm setup. 2. Click Cancel on the queued request.
- Expected: status "cancelled".
- Actual: Status "failed" (red), Result "Cancelled." Evidence: `admin-39.png`.
- Suggestion: show a neutral "cancelled" status. Also, while a request is only queued the panel header says "A request is in progress", and all three buttons are disabled; "queued" would be more accurate.

### F5 [low] Event history says "Files added" while the files are still "sending…"
- Where: /wydarzenia/36 (History) and Audit entry #49 ("Files added", Rows 2)
- Steps: 1. Add files with two small files. 2. Reload.
- Expected: History/audit show the upload as queued or pending until the bot has sent them.
- Actual: History "Files added" is shown immediately, while both files stay "· sending…" (no bot in the sandbox). There is no time hint ("waiting for the bot since 3 min"), no cancel or remove, and the list order is reversed (b before a). The retry option only exists for failed rows, so I could not exercise it. Evidence: `admin-20.png`.
- Suggestion: name the audit action "Files queued", show elapsed time, and say after a while that the bot is not responding (as the Sync page does).

### F6 [low] Restore of a deleted event gives no confirmation message
- Where: /wydarzenia/36 after Delete, Only this one, then Restore
- Actual: the "This event was deleted" banner and the Restore button just disappear. Only the History list shows "Event restored". Evidence: `admin-19.png`.
- Suggestion: show a "Event restored." status line like the "Changes saved." one after an edit.

### F7 [low] Series delete/edit: choices without consequences
- Where: /wydarzenia/36, Delete
- Actual: the prompt "Delete this event? Only this one / This and following / Cancel" does not say how many events "This and following" removes (here 2 of 4). The series line reads "every week until 23 Nov 2026" although I entered 27 Nov (it shows the last occurrence). Evidence: `admin-16.png`.
- Suggestion: add counts ("This and following (2 events)") and label it "last occurrence" or keep the entered date.

### F8 [low] Audit filter "Action" lists only admin actions; event/class_mark/reminder actions cannot be filtered
- Where: /admin/audit
- Actual: the Action dropdown has sql.*, subject.*, lecturer.*, user.*, plan.sync, bot.*. The log also contains event.add, event.delete, event.restore, event.upload, class_mark.*, reminders.update and event.link, none of which can be selected. "Admins only" and by-name filters work; the `?user=&action=sql.execute` URL works. Detail of a rejected SQL entry (#37) shows `"reason": "permission"` and `"errno": 1142` as raw JSON, but not the user-facing message. Evidence: `admin-21.png`, `admin-22.png`, `admin-23.png`.
- Suggestion: add the event.* and class_mark.* actions to the dropdown. On the detail page, show the rejection reason in words.

### F9 [low] Forms submit as GET before hydration and put values in the URL
- Where: /admin/lecturers "Add lecturer" (also presumably the other new admin forms)
- Steps: 1. Load the page right after a recompile. 2. Fill the form fast and click Add lecturer.
- Actual: the browser did a plain GET to `/admin/lecturers?title=&name=Anna+Nowak&email=anna.nowak%40example.edu&room=&officeHours=`; the form emptied and nothing was saved. After waiting a few seconds the same submit worked and showed "A lecturer with this email address already exists." Probably dev-only, but the same would happen on a slow connection.
- Suggestion: give the forms `method="post"` so the fallback cannot leak values, or disable submit until hydrated.

### F10 [low] SQL write: confusing wording and layout details
- Where: /admin/sql, /admin/subjects/SK, /admin/sync, /admin/users
- Actual:
  - The refusal for a protected table reads only "Table `users` is outside the console's scope." It does not say which tables are allowed, or point to the Users tab for is_admin. The attempt was audited as "SQL rejected" (#37). Evidence: `admin-9.png`.
  - Previews show a green "Showing rows 0 – 0 (1 total)" and "Edit in SQL console" / "Export CSV" links, which are read-only table controls. For the 129-row UPDATE it shows "Showing rows 0 – 24 (50 total)" next to "129 rows will be changed" (the preview sample is capped at 50, not labelled). Evidence: `admin-3.png`, `admin-7.png`.
  - In "Assign a lecturer" the Lecturer select collapses to a few pixels and its label overlaps "Class type". Evidence: `admin-26.png`/`admin-27.png`.
  - "Confirm setup" inline prompt squeezes the description into a narrow column. Evidence: `admin-35.png`.
  - Adding a subject with code `am2` gives "A subject with this code or channel already exists." (code is upper-cased silently; "or channel" is confusing for a web form). Evidence: `admin-25.png`.
- Suggestion: fix the wording and layouts.

### F11 [idea] Other things an admin could do by accident
- Users tab lets an admin block another admin (Marta Starościna has a Block button, with a confirmation "They are signed out of the website"). A warning for admins and a "last admin" guard would be wise. Evidence: `admin-33.png`.
- "Sync timetable" can be clicked repeatedly: the second click was accepted, while a bot request type blocks further requests. The Sync page does not refresh by itself ("Reload to see the result").
- `/wydarzenia` and `/s/wydarzenia` return 404 (the docs describe them as entry points; events live under /plan and the subject pages). A list of all events with a filter for deleted ones would help the admin who must find an event to restore. Restore is only reachable by URL or the audit log.
- Audit details JSON for events shows `"startsAt": "2026-11-02T18:00:00.000Z"` for 18:00 local time (Europe/Warsaw is UTC+1 in November), while the page shows 18:00. Guess: times are stored as wall time and labelled Z; harmless on screen but misleading in the log.

## What worked well
- Overview (/admin): status counters, "Latest audit log entries" (10 rows, human labels, links to targets) and "Admins" (3) are all present. Evidence: `admin-1.png`.
- SQL write: Preview and Run only enabled in the right order; `UPDATE subjects SET ects = ects WHERE code = 'SK'` previewed "1 row will be changed" and was audited (#31, details `kind: update, previewAffected: 1`). The 129-row statement asks "This change affects 129 rows. To confirm, type the table name class_sessions"; Run stays disabled with `class_session` and becomes enabled with the exact name. Executed one was audited (#35, rows 129). `users` is refused and audited as SQL rejected.
- Weekly series: created Mon 2 Nov to 23 Nov (4 occurrences); editing the 2nd with "This and following" changed 9, 16 and 23 Nov and left 2 Nov alone; deleting one with "Only this one" left the others; the plan weeks W45 to W48 showed the right events. Restore worked and History lists every step.
- Uploads: two small files were accepted immediately and listed as "sending…", surviving a reload.
- Audit filters (Everyone, Admins only, per user, per action) and entry details work; an unknown entry id gives a 404.
- Users: Block asks for confirmation; Subjects: duplicate code and Lecturers: duplicate email give clear errors; Sync: Run setup asks for confirmation, queued requests can be cancelled, and after 60 s the page says "The bot is not responding. Is it running?".

## Not tested / blocked
- Preview of an unfiltered `DELETE FROM subjects` or a DELETE on events/event_series (hard delete warning): the dev server reloaded the page each time (F1).
- Retry for failed uploads and the real upload result (needs the bot); the oversize file limit.
- Subject edit/save, class save, Add subject (success), Add lecturer (success), lecturer edit, Block/Unblock confirm (cancelled only, so as not to disturb other personas), Preview changes and Fetch from Discord.
- Admin-only Restore of entry quizzes on the subject page.
- Screenshots are in `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-30/` (admin-1.png to admin-40.png).
