# qa-student — Ola Studentka — 2026-10-31

Summary: All eight tasks worked. The semester switcher is easy to use. The chosen semester stuck across Start, Timetable, My groups, Events, Search, subject pages and the simple/advanced switch, and "All" restored everything. The main confusion: Start and the subject page are only partly filtered, and an event added for next week does not show on Start. The dev server was slow on first page loads (several 5 s timeouts) and the sandbox refused connections for a short time around 01:27. It was back within a minute.

Task results (steps counted as page loads or clicks):
1. Login and today / this week: done, 2 steps. Start shows Today ("No classes today." on a Saturday) and one "Next class". The rest of the week is only in Timetable (+1 click).
2. My groups: done, ~5 steps (Timetable, My groups tab, 2 selects, Save). The week view says "Filter: My groups ... 10 classes hidden: pick a group for AM2, SK, SO…". That makes sense, and the picks persisted after a reload.
3. Materials: done, 3 steps. ASD file preview (PDF viewer with page and zoom) and download both work.
4. Add event: done, ~9 steps. It appears in the timetable (Thu 5 Nov), in the Events list (id 30) and on its page (when, subject, place, note, history). It does not appear on Start (F1).
5. Edit time: done, 3 steps (the edit redirected to the event page). Linking a post: done, 3 steps. The post's two files appear under Materials with Preview and Download.
6. Reminders 24 h: done. The checkbox is still checked after a reload.
7. Search "Dijkstra" (word inside zakres-egzaminu.txt): done. The snippet is highlighted. With semester 3 chosen it says "Nothing found" plus "Showing semester 3 only. Show all semesters", and that link works.
8. Advanced and back: done. Semester 5 carried into advanced (Subjects grid shows `WHERE s.semester = 5`) and back.

Console: 0 errors throughout. Only warnings about unused preloaded fonts, plus the dev-mode noise.

## Findings
### F1 [medium] A new event for next week does not show on Start
- Where: `/s` "Upcoming events"
- Steps: 1. Add a kolokwium for Thu 5 Nov (event 30). 2. Open Start.
- Expected: the event I just added appears on Start (the task asks for this).
- Actual: Start lists only the 5 earliest events (1 Nov, 1 Nov, 2 Nov, 3 Nov, 4 Nov), so the Thu 5 Nov event is cut off. It is present in Timetable, in `/s/wydarzenia` and on its own page.
- Evidence: `.qa/screens/2026-10-31/student-11.png`, `student-12.png`
- Suggestion: raise the cap or show "+N more" with a link. Also consider a highlight for events I added.

### F2 [medium] Start mixes filtered and unfiltered blocks when a semester is chosen
- Where: `/s` with semester 3
- Steps: 1. Choose semester 3. 2. Look at Start.
- Expected: it is clear which blocks follow the filter.
- Actual: Subjects, the sidebar and Upcoming events are filtered to semester 3 (only SYK). "Next class" still shows ASD (semester 1) and "Recently added" shows ASD, BD and SK files. This is documented as intended, but to a student it looks like the filter is broken.
- Suggestion: either filter these too, or add a small "all semesters" label to those blocks.

### F3 [low] Subject page "Next classes" ignores My groups
- Where: `/s/subjects/ASD`
- Steps: 1. Pick ASD Lab Gr. 2 and Ćwiczenia Gr. 1. 2. Open ASD.
- Expected: Next classes show only my groups, or say they show all.
- Actual: it lists "Laboratorium, Gr. 1" Tue 10:00 and Gr. 2. Start also says "Showing all groups" until picked, but not here.
- Suggestion: apply My groups or add a note.

### F4 [low] Add event form does not follow the semester filter, and saving does not redirect
- Where: `/s/wydarzenia/nowe`
- Steps: 1. Choose semester 1. 2. Open Add event.
- Expected (guess): the Subject picker prefers semester 1.
- Actual: the Subject list shows all 9 subjects (including SYK, UM, PD). That is arguably right. Separately, after saving a new event the form stays on `/s/wydarzenia/nowe` for several seconds ("Saving…"), then resets to an empty form with no success message or redirect. I only knew it worked by checking the list. Editing does redirect to the event page.
- Evidence: `student-7.png`, `student-8.png`
- Suggestion: redirect to the new event, or show a success notice.

### F5 [low] Sidebar highlights the wrong item on Events
- Where: `/s/wydarzenia`
- Actual: "Start" is highlighted in the left menu on the Events page. It is "Timetable" on Add event.
- Evidence: `student-9.png`

### F6 [low] Link-post search finds only same-subject posts (unclear)
- Where: event 30, "Link posts"
- Steps: 1. Search "Kolokwium".
- Actual: only "Kolokwium 1 — zadania z poprzednich lat (ASD)" is found. "Kolokwium SQL gr 2" (BD) is not. This may be intended (same subject only). If so, a hint would help.

### F7 [low] PDF toolbar glyph overlap
- Where: file preview pane, toolbar
- Actual: the "Next >" chevron overlaps the zoom "−" button at the pane's width (~345 px).
- Evidence: `student-6.png`

### F8 [idea] Lecturer, language: "Link posts" vs task wording "Powiąż posty"
- The UI says "Link posts", consistent with the English UI rule. No action needed.

## What worked well
- The switcher keeps the chosen semester across all pages, and `?next` redirects land on the right page. The advanced SQL shows the semester filter.
- Search shows "Showing semester N only. Show all semesters" when the filter hides results.
- Subject-less events (Spotkanie samorządu, Wyjazd) always show, as documented. They also show in semester 5, where no subject has events.
- My groups, the "classes hidden" note, reminders and saved groups survive a reload and a semester switch.
- Event history records add, change and link.

## Not tested / blocked
- Phone layout of the semester select (mobile persona's job).
- Whether saving My groups under a semester filter wipes picks of other semesters (I had no picks outside semester 1).
- Download of the original `.md`/`.txt` files; only the PDF download was tried.
- Whether the Today card shows classes on a weekday (the run date is a Saturday).
- A seeded kolokwium "z kopców" (event 1) disappeared and an untitled-subject "Kolokwium" on 3 Nov appeared during the run. This was probably another persona editing it, not a bug.
