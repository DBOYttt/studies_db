# qa-chaos — Szybki Szymon — 2026-10-16

Summary: Double submit and double delete are safe (one event, one history row). Concurrent edits silently overwrite each other (last write wins), and acting on a deleted event ends in a bare 404. The plan page once failed with a DB connection error that went away on its own. The run was partly cut short by a usage limit and a session expiry: uploads and Moje grupy were not tested.

## Findings
### F1 [medium] Two tabs editing the same event: the second save silently overwrites the first
- Where: /s/wydarzenia/9/edytuj
- Steps: 1. Open the edit form in tab A and tab B. 2. In B set Tytuł "Tab B tytul" and Miejsce "Sala B", save. 3. In A (opened earlier) set Tytuł "Tab A tytul" and Notatka, then double-click Zapisz.
- Expected: a stale-edit warning, or only the fields A changed are saved.
- Actual: no warning. The event ended with A's title and note, and B's Miejsce was reset to empty (A's history row lists "tytuł, miejsce, notatka"). B's change is lost, even though A never touched the place field.
- Evidence: the history on /s/wydarzenia/9 has two "Zmieniono wydarzenie" rows. No screenshot.
- Suggestion: send a version/updated_at with the form and reject stale saves with a message, or write only the changed fields.

### F2 [medium] Saving an edit of an event deleted in another tab gives a bare 404
- Where: /s/wydarzenia/9/edytuj (stale tab) after deleting event 9 in another tab
- Steps: 1. Open the edit form in tab A. 2. Delete the event in tab B. 3. Change the title in A and click Zapisz.
- Expected: a clear message such as "To wydarzenie zostało usunięte".
- Actual: after a short wait the tab shows the generic "404: This page could not be found." and the typed edits are lost. The event stays deleted, which is correct. The Discord post status was not checked. I did not test upload to a deleted event.
- Evidence: .qa/screens/2026-10-16/chaos-2.png (taken after the 404 had loaded, so it may not show the form).
- Suggestion: friendly "event deleted" page or form error with a link to the plan.

### F3 [low] Plan page showed "Nie udało się wczytać planu: Nie udało się połączyć z bazą danych."
- Where: /s/plan
- Steps: open /s/plan right after the first login and the first event save. A reload shortly after gave the same error, and a third load worked. /plan in advanced mode returned ERR_EMPTY_RESPONSE at about the same time (the server log showed a restart and recompile; other personas were also active).
- Expected: the plan loads.
- Actual: red alert, along with the line "Plan nie był jeszcze synchronizowany", which is contradictory next to the error. It recovered without any action from me, so it is likely transient (a guess: dev-server restart or the read-only pool).
- Evidence: .qa/screens/2026-10-16/chaos-1.png
- Suggestion: retry once in the plan loader, and hide the "not yet synchronized" text when the load failed.

### F4 [low] Mode toggle missing on the new-event form after Back and resubmit
- Where: /s/wydarzenia/nowe after Back then clicking Dodaj wydarzenie with an empty form
- Actual: the top bar shows no Prosty/Zaawansowany toggle, and the empty submit shows no visible message. It is possibly the dev server mid-compile, so unconfirmed.
- Evidence: .qa/screens/2026-10-16/chaos-4.png

### F5 [idea] Form data lost when the session ends mid-form
- Where: /s/wydarzenia/nowe
- Steps: 1. Fill the form in tab A. 2. Log out in tab B. 3. Submit in A.
- Actual: A redirects to /login-info and the typed data is lost. No data is created, which is correct and safe. Cosmetic: a short "sesja wygasła" message would help.

## What worked well
- Double-click "Dodaj wydarzenie": exactly one event, one "Dodano wydarzenie" history row.
- Double-click "Zapisz" on edit: one history row.
- Double-click "Tak, usuń": the event was deleted once and the redirect to the plan was clean.
- Back after a successful submit shows a fresh empty form, so there was no accidental resubmit of the old data.
- Logout in one tab: the other tab is correctly refused (redirect to login). No event was created.
- The session expired after a long idle gap and redirected to /login-info cleanly.
- Plan week navigation (Następny twice) and switching to Zaawansowany kept the week (W44) without flicker or console errors.

## Not tested / blocked
- Upload ("Dodaj pliki"): refresh in the middle of an upload, and upload to a deleted event.
- Moje grupy: reload after saving, and two tabs.
- The browser tool has no way to set files from disk without a file chooser, and the run was interrupted by a usage limit.
- Rapid repeated mode switching beyond one switch.
- Back mid-form with a resubmit that has data (the form was empty after Back).
- Console errors: only the font preload warnings and Fast Refresh logs; the only error entry was the 404 in F2. No failed network requests were checked separately.
