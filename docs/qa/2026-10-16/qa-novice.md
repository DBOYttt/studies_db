# qa-novice — Pan Zenon — 2026-10-16

Summary: All five goals were reached in the simple mode. The plan is understandable but never says "your next class" on the screen a beginner lands on, and the "Moje grupy" save gives no confirmation. The sandbox was unstable at the start (DB-connection errors, logged out mid-run), which cost a lot of time; after that it worked.

## Findings

### F1 [medium] "Plan zajęć" showed "Nie udało się połączyć z bazą danych" and the session was dropped
- Where: /s/plan, /s/plan?tab=groups (first ~3 minutes of the run)
- Steps: 1. Log in. 2. Click "Plan zajęć". 3. Click "Moje grupy". 4. Click "Bazy danych" in the left list.
- Expected: the plan, then the subject page.
- Actual: red alert "Nie udało się wczytać planu: Nie udało się połączyć z bazą danych." / "Nie udało się wczytać zajęć: ...". Clicks on a subject did nothing for ~30 s, then I landed on /login-info ("Aby wejść, wpisz /link na serwerze Discord rocznika") with no explanation that I was logged out. A new login link fixed it. The console also showed ERR_INCOMPLETE_CHUNKED_ENCODING and the dev server was recompiling. Cause is a guess: sandbox DB/server restarted by another persona.
- Evidence: .qa/screens/2026-10-16/novice-1.png, novice-2.png
- Suggestion: the error text is not useful to a beginner; say "Spróbuj za chwilę" plus a retry button. When the session is gone, show "Sesja wygasła, poproś bota o nowy link /link" instead of the bare login-info page.

### F2 [medium] No obvious "next class" answer (goal 1)
- Where: /s (Start), /s/plan
- Steps: 1. Click "Plan zajęć". 
- Expected: my next class at the top.
- Actual: a full-week grid for all groups of all subjects (about 20 buttons per week; "Tydzień 42 · 12 paź – 17 paź 2026"). I had to read the grid myself, and on Friday evening the current week had only past days, so I had to click "Następny ›". Nothing is highlighted as "next". The text "Najbliższe zajęcia" exists only inside a subject page (e.g. Bazy danych), and there it lists Gr. 1 AND Gr. 2 labs even though I had saved Gr. 2.
- Evidence: .qa/screens/2026-10-16/novice-3.png, novice-5.png
- Suggestion: put a "Najbliższe zajęcia" card on Start / top of the plan, filtered by Moje grupy. Filter the subject-page list by the chosen group too.

### F3 [medium] "Moje grupy": no confirmation after "Zapisz", and 7 dropdowns all say "Wszystkie" (goal 3)
- Where: /s/plan?tab=groups
- Steps: 1. In "Bazy danych · Laboratorium" choose "Gr. 2". 2. Click "Zapisz" (I clicked it twice, as a beginner would).
- Expected: a message "Zapisano".
- Actual: the page jumped to the "Tydzień" tab with no message. I only knew it was saved after coming back and seeing "Gr. 2" selected (it was). Double click was harmless. The word "Wszystkie" is unclear (all groups? I am in none?). The list says "Algorytmy i struktury danych · Laboratorium" etc., which is long for someone who just knows "BD gr 2".
- Evidence: .qa/screens/2026-10-16/novice-4.png
- Suggestion: show "Zapisano" and keep the user on the tab; rename "Wszystkie" to "Nie wybrano / pokaż wszystkie"; add a short example.

### F4 [medium] Event form: first submit seemed to vanish, and the page is partly English (goal 4)
- Where: /s/wydarzenia/nowe ("Dodaj wydarzenie")
- Steps: 1. Click "Dodaj wydarzenie" with everything empty. 2. Type a title, try typing the date by keys, pick "BD · Bazy danych", click "Dodaj wydarzenie". 3. Fix the date, click again.
- Expected: Polish validation messages; the event is saved.
- Actual: empty submit gave the browser bubble "Please fill in this field." (English; likely the headless browser's locale, so a guess). My keyboard typing in the date box left the field half filled ("dd/mm/102026"), submit was silently blocked with no message near the field. A later submit after filling title+date worked once (event 23, "Kolokwium we wtorek", "20 października 2026, cały dzień"). One earlier submit seemed to reset the whole form (title and subject gone) without saving and without any message; the event did not appear on Start (possibly a dev-server reload, guess). Also the date field uses dd/mm/yyyy segments; typing "20.10.2026" is rejected by the control with no hint of the format.
- Evidence: .qa/screens/2026-10-16/novice-7.png, novice-8.png, novice-9.png, novice-11.png
- Suggestion: add visible Polish error text under fields, a format hint ("dd.mm.rrrr") or a calendar/quick pick ("najbliższy wtorek"), and show a "Dodano" banner.

### F5 [low] Event detail page has leftover jargon
- Where: /s/wydarzenia/23
- Actual: "Post na Discordzie: w przygotowaniu" and "Powiąż posty" / "Brak powiązanych postów." mean nothing to a beginner; "Choose files No file chosen" is English. A "Kolokwium" event also has a "Dodaj pliki" section that I did not expect.
- Evidence: .qa/screens/2026-10-16/novice-11.png
- Suggestion: hide or explain these; Polish label for the file button.

### F6 [idea] Notes are called "Notatki" only as a hidden filter (goal 2)
- Where: /s/subjects/BD
- Actual: I found notes by taking the label literally: "Rodzaj" -> "Notatki" (2 files: joiny.sql, normalizacja.pdf). Worked, and "Podgląd" opened a side panel with the PDF. But "Rodzaj" is not a word I would look for; the page lists all 5 files anyway under "Pliki (5)". Two rows of chips "Zajęcia" and "Rodzaj" both contain "Projekt", which looked duplicated. Also clicking the file name or "Podgląd" gave no feedback for a few seconds (dev compile).
- Evidence: .qa/screens/2026-10-16/novice-6.png
- Suggestion: rename "Rodzaj" to "Typ materiału"; show a spinner while the preview loads.

## Goals
1. Next class: reached, but only by reading the weekly grid and a subject page. Partial in terms of ease (F2).
2. Notes for Bazy danych: done (Bazy danych -> Notatki -> normalizacja.pdf, preview opened).
3. Lab group: done (BD Laboratorium Gr. 2, verified persisted), see F3.
4. Kolokwium reminder next Tuesday: done (20.10.2026, event 23) after a failed attempt, see F4.
5. Back to start: done; the sidebar "Start" and the "StudiesDB" logo both work. The breadcrumb "Start" is also there.

## What worked well
- Simple mode is clean; the left subject list and "Start" link are always visible.
- "Plan zajęć" intro text explains "Moje grupy"; the double click on Zapisz did no harm.
- The subject page has "Najbliższe zajęcia", "Prowadzący", and PDF preview in a side panel.

## Not tested / blocked
- Browser back button in the middle of the form, opening a wrong subject on purpose: not done.
- Search box, "Gotowe zestawienia", "Ostatnio dodane", advanced mode: not opened.
- Reminder checkboxes ("24 h przed", "1 h przed"): not used.
- Duplicate event check: one possibly-lost earlier submit was not verified in the DB.
