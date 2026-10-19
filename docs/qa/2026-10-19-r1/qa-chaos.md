# qa-chaos — Szybki Szymon (chaos) — 2026-10-19-r1

Summary: Re-test of the four fixes. All four are fixed: the stale-edit conflict, the deleted-event banner, values kept after a refused save, and two near-simultaneous creates. Double submits, the Back button, reload during upload and fast week/mode switching caused no duplicates or bad data. One new problem: saving a form after logging out in another tab crashes the page ("This page couldn't load") and the typed values are lost.
Sandbox was the Next dev server (Fast Refresh recompiles caused some extra reloads and slow first clicks; this is not counted as a bug).

## Re-check of the fixes
| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Two tabs edit event 8; B saves, then A saves | FIXED. A stays on the form, keeps typed title "Chaos tab A" and place "Sala A". Red message: "Someone changed this event while you were editing. Your changes weren't saved — reload to see the current version." Saving again gives the same refusal. The event page shows B's data only, and history has one "Zmieniono" entry. | `.qa/screens/2026-10-19-r1/chaos-2.png` |
| 2 | Delete event in tab B, then save edit from stale tab A | FIXED. Banner "This event was deleted. Your changes weren't saved. Back to plan" and all typed values kept; no 404 page. The event URL itself is a 404 afterwards, as expected. See F1 for a second message under the form. | `chaos-3.png` |
| 3 | Refused save keeps input | FIXED. Event with end 10:00 before start 14:00: "Koniec musi być po początku." and title, date, times, place and note are all kept. An invalid date cannot be entered at all (native date input). | `chaos-1.png` |
| 4 | Create two events in two tabs back to back | FIXED. Both were saved (ids 10 and 11) and both appear in the plan for week W46. | plan W46 snapshot |

## Findings
### F1 [low] Deleted-event banner is followed by a second, Polish "Nie znaleziono wydarzenia."
- Where: `/s/wydarzenia/8/edytuj`
- Steps: 1. Open the edit form. 2. Delete the event in another tab. 3. Click Zapisz.
- Expected: one message.
- Actual: the new English banner at the top, plus the old Polish red box "Nie znaleziono wydarzenia." under the form. The two messages are redundant and use two languages (the English one is intended).
- Evidence: `.qa/screens/2026-10-19-r1/chaos-3.png`
- Suggestion: suppress the generic message when the banner is shown.

### F2 [medium] Saving after logout in another tab crashes the page and loses what was typed
- Where: `/s/wydarzenia/12/edytuj`, simple mode
- Steps: 1. Open the edit form in tab B. 2. Click "Wyloguj" in tab A. 3. Change the title in tab B and click Zapisz.
- Expected: a redirect to login or a "session ended" message, ideally keeping the typed values.
- Actual: the Next error page "This page couldn't load / Reload / Back" appears. The console shows `Error: An unexpected response was received from the server` (from fetchServerAction), and the tab ends up on `/login-info`. The typed title is lost. The data was not changed (event 12 still has its old title), so this is a UX issue, not a security one. The cause is probably that proxy.ts redirects the server-action POST when the cookie is gone (guess).
- Evidence: console error above; `chaos-6.png` (captured after the redirect, so it shows the login-info page).
- Suggestion: have server actions return a "session ended, log in again" state instead of a redirect response, or handle the unexpected response on the client.

### F3 [low] Upload after deleting the event only shows the generic "Nie znaleziono wydarzenia."
- Where: `/s/wydarzenia/11`
- Steps: 1. In tab B choose a file. 2. Delete the event in tab A. 3. Click "Dodaj pliki" in tab B.
- Expected: a clear message.
- Actual: the request `POST /api/wydarzenia/11/pliki` returns 404 (a console error, but no crash). The page says "Nie znaleziono wydarzenia." and the file name stays selected. The page still shows the deleted event with Edytuj/Usuń. Clicking Usuń then "Tak, usuń" gives the same message. No data was created.
- Evidence: `chaos-4.png`, `chaos-5.png`
- Suggestion: say "Wydarzenie zostało usunięte" and offer a link back to the plan, as the edit form now does.

### F4 [low] File picker label is in English
- Where: event page, "Dodaj pliki" section
- Actual: the native input text "Choose files chaos1.txt" appears next to the Polish button "Pliki do dodania".
- Evidence: `chaos-4.png`
- Suggestion: hide the native input text and show the file names in Polish.

### F5 [low] `/s/wydarzenia` (no id) returns 404
- Where: `http://localhost:3200/s/wydarzenia`
- Actual: 404, although the CLAUDE.md text mentions this path as the events page. Only `/s/wydarzenia/nowe` and `/s/wydarzenia/[id]` exist; events are reached from the plan.
- Suggestion: redirect to `/s/plan` (idea).

### F6 [idea] Saving Moje grupy gives no confirmation
- Where: `/s/plan?tab=groups`
- Actual: after Zapisz it redirects to `/s/plan` and the only feedback is the chip "Filtr: Moje grupy". Two tabs saved with different values: the last save wins for the same class (ASD Laboratorium ended as Gr. 3), and a class that tab A left on "Wszystkie" was not reset (BD Laboratorium stayed Gr. 2 from tab B). So the save merges per class. That is consistent but unexpected if the user meant "Wszystkie".

## Scenarios (1–7)
1. Double submit: double-click "Dodaj wydarzenie" created exactly one event (id 8, only one in the plan). Double-click "Zapisz" on the edit form gave one save and one history entry. Double-click "Tak, usuń" gave a normal redirect to the plan with no error. No duplicates.
2. Back button: after a successful create, Back shows an empty form (nothing preserved); a resubmit is blocked by required fields and nothing is created twice. Going back mid-form is harmless.
3. Reload: reload right after clicking "Dodaj pliki" (2 files, one 3 MB): the event page then lists both files as "wysyłanie…" with a "Dodano pliki" history entry, once, with no duplicates. The bot status was not observed, so I did not see them sent. Reload after saving Moje grupy showed the saved values.
4. Two tabs: see re-checks 1 and 4 and F6.
5. Stale page: see re-check 2, F1 and F3.
6. Session: see F2. After logout, a tab that had been reloaded by Fast Refresh went straight to `/login-info`, which is correct. Logging in again worked and the new link was one-time.
7. Fast navigation: clicking next/previous week quickly (W45, W46, W47, W46) and switching simple to advanced and back via the top bar and `/mode?...next=` kept the week and mapped the pages correctly. No flicker or wrong data seen. No console errors apart from the 404 above and the F2 error.

## What worked well
- The conflict message keeps every typed value and gives a clear next step.
- The server-side duplicate protection on double-clicks works for create, edit and delete.
- Mode switching preserves the week and the event page.

## Not tested / blocked
- Conflict, deleted banner and refused-save behaviour in advanced mode (`/wydarzenia/[id]/edytuj`).
- Whether the bot sends the uploads (no Discord by rule).
- A truly long-idle session (expiry); only simulated with logout and a new login.
- I placed two small fixture files in `.playwright-mcp/` for the upload tool (it only accepts paths inside the repo) and removed them afterwards.
- Test events left in the sandbox: ids 8 (deleted), 10, 11 (deleted), 12.
