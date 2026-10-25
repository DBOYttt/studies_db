# qa-student — Ola Studentka — 2026-10-25

Summary: All eight tasks were doable in simple mode. The big gaps are on the start page, which has no "today / this week" classes, and in how the entry quiz and "Hidden classes" are handled. The "Hidden classes" link throws the student into advanced mode, "Not this week" has no undo where you skip it, and quiz and test bars overlap in narrow columns. The dev server also restarted and hot-reloaded many times during the run, so a few of my clicks were lost; I report those only where I could reproduce the cause.

## Task log
| # | Task | Result | Steps (approx.) |
|---|---|---|---|
| 1 | Today / this week on the start page | Not possible from Start; Timetable has it | 1 (Start), then 2 more to Timetable |
| 2 | My groups (ASD lab Gr. 1, ASD Ćwiczenia Gr. 2) | Done; the plan filters correctly | about 8 (the first attempt lost a select to a reload) |
| 3 | Materials, preview and download | Done (BD, PDF preview in a side panel, download works) | 4 |
| 4 | Add Test (kolokwium) next week with place and note | Done; shows in the plan, on Start and on the event page | 5 |
| 5 | Edit time, link a post, files under Materials | Done, but slow (about 10 s for the link) | 8 |
| 6 | Reminders 24 h, reload | Done; the setting persists | 3 |
| 7 | Search a word from file text | Done ("Dijkstra" and "złożoność"; the ASCII spelling misses it, see F7) | 2 |
| 8 | Advanced and back | Done | 2 (the first click on Simple seemed to hang; see "Not tested") |
| extra | Entry quiz on, skip a week, undo | Done, but undo is only on the subject page | 8 |
| extra | "+ Test" on a class session | Done, form is prefilled | 4 |
| extra | Exam event (SK, 20 Jan 2027) | Done (event 14) | 4 |

Console: no app errors on any page I used. The only error was a `favicon.ico` 404 on the first page. After the dev server restart I saw six `ERR_EMPTY_RESPONSE` / `ERR_CONNECTION_REFUSED` resource errors, caused by that restart. There were font-preload warnings on most pages.

## Findings
### F1 [medium] Start page does not answer "what classes do I have today / this week"
- Where: `/s`
- Steps: 1. Log in. 2. Look at Start.
- Expected: today's and this week's classes, at least for my groups.
- Actual: Start shows the subject list, "Upcoming events" (only events, not classes) and "Recently added" files. Classes appear only on Timetable. Today is Sunday and the only thing the week view showed for today was an event (Konsultacje).
- Evidence: `.qa/screens/2026-10-25-ux/student-1.png`, `.qa/screens/2026-10-25-ux/student-2.png`
- Suggestion: add a "Today" and "This week" block to Start, filtered by My groups.

### F2 [medium] "Hidden classes: 13 — fill in My groups" link opens advanced mode
- Where: `/s/plan` filter bar
- Steps: 1. Set My groups. 2. Open the week plan. 3. Click "Hidden classes: 13 — fill in My groups".
- Expected: the simple My groups tab (`/s/plan?tab=groups`).
- Actual: it goes to `/plan?tab=groups`, the advanced UI, and the mode toggle shows Advanced. A simple-mode student is dropped into the phpMyAdmin-style UI without having asked for it.
- Evidence: `.qa/screens/2026-10-25-ux/student-7.png`
- Suggestion: link to `/s/plan?tab=groups`.

### F3 [medium] The note about hidden classes contradicts the behaviour and reads oddly
- Where: My groups tab text and the filter bar on `/s/plan`
- Steps: 1. Pick only ASD lab Gr. 1 and ASD Ćwiczenia Gr. 2 and save. 2. Open the week.
- Expected: the tab says "Lectures and classes you haven't picked a group for stay visible". So AM2, BD, SK, SO and JA classes should still show.
- Actual: all AM2 Ćwiczenia, BD Laboratorium, SK Laboratorium, SO Laboratorium and JA Ćwiczenia sessions are hidden (13 hidden). Only lectures, the Projekt and my two picked groups remain. The bar says "Hidden classes: 13 — fill in My groups", but I had already filled in my groups; the real meaning is "you have not picked a group for these". The Sunday event stays visible. Saving also gave no confirmation message (see F9).
- Evidence: `.qa/screens/2026-10-25-ux/student-3.png`, `.qa/screens/2026-10-25-ux/student-6.png`
- Suggestion: either show unpicked classes, or fix the text. Reword the bar, for example "13 classes hidden: pick a group for AM2, BD, SK, SO, JA". Say once that choosing any group hides the other groups of that class.

### F4 [medium] "Not this week" has no undo where you do it
- Where: class details panel on `/s/plan`; undo lives on `/s/subjects/<code>`, under "Entry quiz every session" and "Skipped dates"
- Steps: 1. Open an ASD Laboratorium Gr. 1 session in week 44. 2. Click "Not this week". 3. Try to get it back.
- Expected: a "Quiz skipped · Undo" line in the panel, or a skipped marker on the bar.
- Actual: the quiz block just vanishes from the panel and the bar. The undo exists only at the bottom of the subject page ("Skipped dates → Undo Tue 27 Oct"), which I found only by scrolling a subject page. Undo worked.
- Evidence: `.qa/screens/2026-10-25-ux/student-14.png`, `.qa/screens/2026-10-25-ux/student-19.png`
- Suggestion: keep a "Quiz skipped this week · Undo" row in the panel. Also add an undo or confirm state for the click.

### F5 [medium] Entry quiz bar and Test bar overlap each other and the class text in narrow columns
- Where: week 44, Tuesday 27 Oct, ASD Laboratorium Gr. 1 (10:00), next to the Kolokwium event
- Steps: 1. Turn on entry quizzes for ASD Ćwiczenia Gr. 2 and let a lab session have both a quiz and a test. 2. Look at Tuesday.
- Expected: the card can be read.
- Actual: the "ENTRY QUIZ" bar sits on top of the lecturer and room lines and the TEST bar is squeezed under it; the card is clipped and unreadable. Two events in the same slot also make the card very narrow.
- Evidence: `.qa/screens/2026-10-25-ux/student-22.png`, `.qa/screens/2026-10-25-ux/student-23.png`
- Suggestion: grow the card's min-height to fit stacked bars, or collapse both into one "Quiz + Test" bar.

### F6 [low] Entry quiz controls are far down the subject page
- Where: `/s/subjects/ASD`, `/s/subjects/AM2`
- Steps: 1. Open a subject page. 2. Look for how to turn on a quiz.
- Actual: "Entry quiz every session" sits after Files, Next classes and the class list and before Lecturers. Nothing on the timetable panel links to it for a class without a quiz.
- Suggestion: add "Turn on entry quiz" to the class details panel, or link to the section.

### F7 [low] Search ignores Polish diacritics only for file names, not text
- Where: `/s/search?q=…`
- Steps: 1. Search "złożoność": 2 files, with a hit in `zakres-egzaminu.txt` text. 2. Search "zlozonosc".
- Expected: the same two files.
- Actual: only `wyklad01-zlozonosc.pdf` (name match). `zakres-egzaminu.txt` (text match) is missing.
- Evidence: observed in the page snapshots; no screenshot of the ASCII search.
- Suggestion: collation or a folded search column. Students often type without diacritics.

### F8 [idea] Simple search results show no snippet; advanced shows highlighted snippets
- Where: `/s/search?q=Dijkstra` vs `/search?q=złożoność`
- Actual: simple lists the file with no hint why it matched; advanced shows the highlighted text.
- Evidence: `.qa/screens/2026-10-25-ux/student-32.png`, `.qa/screens/2026-10-25-ux/student-34.png`
- Suggestion: add the snippet to the simple result.

### F9 [low] No visible confirmation for several saves
- Where: My groups "Save", Reminders checkbox, "Not this week", "Link post"
- Actual: nothing says "Saved". After the Reminders checkbox I could only tell by reloading. "Link" greys out and takes about 10 s in this dev build before the file shows under Materials.
- Evidence: `.qa/screens/2026-10-25-ux/student-29.png`, `.qa/screens/2026-10-25-ux/student-30.png`
- Suggestion: add a toast or inline "Saved" and a clearer pending state.

### F10 [low] Event type is called "Test" while the task and the files say "kolokwium"
- Where: `/s/wydarzenia/nowe`
- Actual: the type list is Test, Exam, Trip, Extra class, Other. The title I wrote said "Kolokwium z SQL" and the type said "Test". This matches the glossary but may confuse a student looking for "Kolokwium".
- Suggestion: none required; the glossary maps it (a guess: UI English, content Polish).

### F11 [low] Class details panel narrows the week grid and hides Fri/Sat columns
- Where: `/s/plan`, with the panel open
- Actual: with the panel open the Friday column is cut off at the right edge (horizontal overflow).
- Evidence: `.qa/screens/2026-10-25-ux/student-13.png`
- Suggestion: scroll the grid or lay the panel below on narrow desktops.

## What worked well
- Setting My groups is quick and the plan then shows my two groups and all lectures. Reloading kept the choice.
- The Test event page shows the details (when, subject, place, note, added by, history). It appears in the week plan, on Start and in "Upcoming events".
- "+ Test" on a class session prefills subject, class, group, session, date, time and place. This is the nicest flow in the run.
- Skipping the entry quiz for a week left the next week's quiz intact, and "Undo" on the subject page restored it.
- Material preview (PDF side panel) and download work. Linking a post gave the file under Materials with a history entry ("Post linked").
- The reminder checkbox persists after reload.
- The Simple/Advanced toggle and `/mode?to=simple&next=…` map pages correctly.

## Not tested / blocked
- The dev server was restarted and hot-reloaded repeatedly. This lost a select in My groups, a typed event title and a form submit (the edit form fell back to a native GET with the data in the URL when hydration had not finished). I could not tell whether this is an app bug or a dev-build effect, so I did not file it.
- The first click on "Simple" in the advanced UI did nothing for over 20 s right after a server restart. I used the `/mode` URL to get back. I did not retry.
- The AM2 Wykład entry quiz disappeared and reappeared while I worked. Another persona was likely editing it, so I did not file it.
- The Discord reminder DM, the Discord post of events, file upload to events and the "Delete" of events were not tested.
- Screenshots are in `.qa/screens/2026-10-25-ux/student-1.png` to `student-34.png`.
