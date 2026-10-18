# qa-student — Ola Studentka — 2026-10-16

Summary: All 8 tasks were completed in simple mode. The core flows (Moje grupy, file preview and download, event add/edit/link, reminders, full-text search, mode switch) work. The rough spots are that the start page does not show "today / this week" classes, simple-mode links that jump into the advanced UI, and a lost group selection I could not reproduce. Browser console showed 0 errors from the app in every task. The only errors were ERR_CONNECTION_REFUSED during a sandbox server restart, and a 404 for favicon.ico.

## Task results
| # | Task | Done | Steps (approx.) | Notes |
|---|---|---|---|---|
| 1 | Today / this week on start page | Partly | 3 | The start page has no classes today/this week; I had to open Plan zajęć (F1) |
| 2 | Moje grupy | Yes | 6 | Plan shows only ASD Lab Gr. 2 plus lectures; hidden note says 14 (F2, F3) |
| 3 | Materials, preview, download | Yes | 4 | PDF preview rendered, download saved the file |
| 4 | Add kolokwium next week | Yes | 3 | Appears in plan week 43, on the start page, and the event page shows place, note and subject |
| 5 | Edit time and link post | Yes | 6 | Time changed 10:00 to 12:00 (history shows "zmienione: początek, koniec"). Linked post's files show under Materiały (F6) |
| 6 | Przypomnienia 24 h | Yes | 2 | Persists after reload; no save confirmation (F5) |
| 7 | Search for a word in file text ("Dijkstra") | Yes | 2 | Found zakres-egzaminu.txt (F7) |
| 8 | Advanced and back | Yes | 2 | Search query carried over in both directions |

## Findings
### F1 [medium] Start page does not show today's or this week's classes
- Where: /s
- Steps: 1. Log in. 2. Look at the start page for "what do I have today / this week".
- Expected: A "Dziś" / "Ten tydzień" block (the first thing a student wants).
- Actual: The start page shows subjects, "Nadchodzące wydarzenia" (events only) and "Ostatnio dodane". Classes appear only in Plan zajęć (/s/plan).
- Evidence: .qa/screens/2026-10-16/student-1.png was taken after the plan page hit a transient error (see Not tested); the start-page content comes from the accessibility snapshot.
- Suggestion: Add a today / this-week block of classes on the start page, filtered by Moje grupy.

### F2 [medium] Links in the simple plan drop the user into the advanced UI
- Where: /s/plan, the "zmień" link and "Ukryte zajęcia: 14 — uzupełnij Moje grupy" (both point to /plan?tab=groups)
- Steps: 1. Set Moje grupy. 2. Open the simple plan. 3. Click the hidden-classes note.
- Expected: Go to /s/plan?tab=groups.
- Actual: The link opens /plan?tab=groups, the phpMyAdmin-style advanced page, while the mode cookie is still simple and the top bar offers no mode toggle. Confusing for a student.
- Evidence: .qa/screens/2026-10-16/student-2.png
- Suggestion: Make these links mode-aware (/s/plan?tab=groups in simple mode).

### F3 [low] Hidden-classes note wording
- Where: /s/plan with Moje grupy set
- Actual: "Ukryte zajęcia: 14 — uzupełnij Moje grupy". The number is understandable, but "uzupełnij" suggests the setup is incomplete when the student has intentionally chosen groups. I had set only 2 of 7 group choices, so the note is arguably correct, but a student with all groups chosen may still see it (not checked).
- Suggestion: Word it as "Ukryto N zajęć innych grup" with a "pokaż wszystkie" link.

### F4 [low] Subject page "Najbliższe zajęcia" ignores Moje grupy
- Where: /s/subjects/ASD
- Actual: With ASD Laboratorium = Gr. 2 saved, the upcoming classes list shows "Laboratorium, Gr. 1" (wtorek 20.10). The plan itself filters correctly.
- Evidence: .qa/screens/2026-10-16/student-3.png
- Suggestion: Apply the same group filter, or label it as all groups.

### F5 [low] No save confirmation for Moje grupy and reminders
- Where: /s/plan?tab=groups
- Actual: Clicking "Zapisz" jumps to the week view with no message. Ticking "24 h przed" shows no "Zapisano" feedback. It does persist after reload.
- Suggestion: Add a toast or inline "Zapisano".

### F6 [low] Group selection not saved on first attempt (not reproduced reliably)
- Where: /s/plan?tab=groups
- Steps: 1. Pick ASD Laboratorium Gr. 2 and ASD Ćwiczenia Gr. 1. 2. Zapisz. 3. Later (after a session re-login) reopen the tab.
- Actual: Only the lab group was saved; Ćwiczenia was back to "Wszystkie". Repeating the same selection and save worked. Possibly caused by the dev server restarting or hot-reloading at the time (guess); I did not observe an error message.
- Suggestion: Check that saving groups is atomic and shows an error on failure.

### F7 [idea] Simple search results have no text snippet
- Where: /s/search?q=Dijkstra
- Actual: The result is correct (zakres-egzaminu.txt), but the word is in the file text, so the student cannot see why it matched. The advanced search (/search) shows a highlighted fragment.
- Evidence: .qa/screens/2026-10-16/student-5.png (simple), .qa/screens/2026-10-16/student-6.png (advanced)
- Suggestion: Show the fragment in simple mode too.

### F8 [low] Create form and edit form differ
- Where: /s/wydarzenia/nowe vs /s/wydarzenia/12/edytuj
- Actual: The edit form has a "Zajęcia" (Wykład/Laboratorium/Ćwiczenia) field that appears once a subject is set; the create form lacks it.
- Suggestion: Offer the same field on creation.

### F9 [idea] Post linking is fragile under dev hot reload
- Where: /s/wydarzenia/12, "Powiąż posty"
- Actual: Search results for a post disappeared several times because the page reloaded (the dev server was doing continuous Fast Refresh in the console). It worked once the reloads stopped. Probably only a dev/sandbox artefact (guess).

## What worked well
- Moje grupy: the plan correctly showed only chosen groups plus lectures and the "Filtr: Moje grupy" label.
- File preview (PDF) with zoom and full screen, and the download.
- Event creation: the redirect goes to the event page with all details; "Historia" lists changes precisely.
- Event appears in plan week 43 and under "Nadchodzące wydarzenia" on the start page.
- Linking a post makes its files appear under Materiały.
- Reminders and groups persist after reload.
- Mode switch keeps the page context (search with the same query).

## Not tested / blocked
- First plan load (/s/plan) showed "Nie udało się połączyć z bazą danych" while the sandbox server restarted; the coordinator confirmed it was a restart, not an app bug.
- I did not check that the Discord post for the event is created ("w przygotowaniu" was shown; Discord is out of scope).
- Did not delete or edit other personas' events.
- Screenshot of the linked-materials view: .qa/screens/2026-10-16/student-4.png (full page).
