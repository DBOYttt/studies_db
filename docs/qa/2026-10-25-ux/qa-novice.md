# qa-novice — Pan Zenon — 2026-10-25-ux

Summary: All four goals reached (timetable, finding a Test / Entry quiz, adding a test, downloading a file). The main blocks are easy to find, but a beginner is slowed by the timetable opening on an empty Sunday, a confusing "Test" button that actually opens a form called "Add event", and cramped Tuesday cells where the new Test / Entry quiz bars are cut off. During the run the dev server hot-reloaded several times, which closed the open class details panel; I treat that as environmental, not an app bug.

## Goals
1. Timetable this week: done. Start > "Timetable" shows "Week 43 · 19–25 Oct 2026". Today is Sun 25 Oct, so the only highlighted column ("Sun 25 Oct (today)") is empty. (F1, F2)
2. Test / Entry quiz: done, but only by luck. Week 44 shows dark bars "TEST Kolokwium 1 ..." and "ENTRY QUIZ Q1" under class blocks, and "Entry quiz Bring laptop, 5 questions on heaps" in a Tuesday ASD block. Nothing on the screen says what these bars are or that they are clickable. (F3, F4)
3. Add a test to a class: done. Click the BD "Wykład" block, then "+ Test", fill "Title", press "Add event". Left Title empty first: the browser says "Please fill in this field." (good). I then double-clicked "Add event": one event was created (/s/wydarzenia/9), no duplicate in the week view. (F5)
4. Download a file: done. Bazy danych > "Download" beside kolokwium-sql-przyklad.txt; the file downloaded. Preview and Download sit side by side and are easy to tell apart.

## Findings
### F1 [medium] Timetable opens on an empty "today" column, and the next class is not visible
- Where: /s/plan
- Steps: 1. Click "Timetable" in the left menu (today is Sunday).
- Expected: I see my next class.
- Actual: Mon–Fri of the past week with all past classes, plus an empty Sun column highlighted. Nothing says "next class: Mon 26 Oct 08:00". I had to guess to press "Next ›".
- Evidence: .qa/screens/2026-10-25-ux/novice-1.png
- Suggestion: Show "Next class: ..." above the grid, or jump to next week when the rest of this week has no classes.

### F2 [medium] Timetable shows all groups before I pick mine
- Where: /s/plan
- Actual: Every group's labs (Gr. 1, 2, 3) appear for me. The hint "Pick your groups in the My groups tab to see only your own classes." is small grey text. I did not know "My groups" mattered.
- Suggestion: A visible banner/button "Show only my groups" when no group is chosen. Calling it "Week" vs "My groups" tabs reads like two views of the same list.

### F3 [medium] "TEST" / "ENTRY QUIZ" bars are unexplained jargon
- Where: /s/plan?week=2026-W44, bars under class blocks.
- Actual: "ENTRY QUIZ" is a term I do not know; no legend. The same thing exists as a standalone "Kolokwium 1" block on Tuesday and as a "TEST Kolokwium 1 ..." bar on Monday, so I could not tell whether these are the same or two tests. (Both English "Test" and Polish "Kolokwium" are used.)
- Evidence: .qa/screens/2026-10-25-ux/novice-8.png
- Suggestion: A small legend ("Test = kolokwium / short written test, Entry quiz = quiz at the start of class"); keep one name.

### F4 [medium] Tuesday cells with an overlap are too narrow
- Where: /s/plan?week=2026-W44, Tue 27 Oct 10:00
- Actual: "Kolo..." block and ASD block shrink to ~70px; the bar reads "ENTRY QUIZ" cut off and the title "Kolok..." is truncated. Bars on Mon/Fri are readable.
- Evidence: .qa/screens/2026-10-25-ux/novice-4.png
- Suggestion: Stack overlapping items, or show full text on hover/tap.

### F5 [medium] Button "Test" opens a form called "Add event"
- Where: class details panel (button label "Test", with a "+"), then /s/wydarzenia/nowe?kind=kolokwium...
- Actual: I expected a "Test" page. The link's accessible name is "Add test" but the visible text is only "+ Test", next to "Subject". The form is titled "Add event" and the confirm button "Add event". Also the first Type option is "Test", the Title field is empty with no hint (e.g. "Test z ..."). It works, but I was not sure I was adding a test until I saw "Test" preselected in "Type".
- Evidence: .qa/screens/2026-10-25-ux/novice-3.png, novice-5.png
- Suggestion: Label "+ Add test"; page heading "Add test" when kind is preset; suggest a default title like "Test – Bazy danych".

### F6 [low] After saving, the page says "Discord post: being prepared" with no explanation
- Where: /s/wydarzenia/9
- Actual: I do not know what Discord has to do with my reminder. No "Saved" message either; I only knew from the new page.
- Evidence: .qa/screens/2026-10-25-ux/novice-7.png
- Suggestion: Plain wording ("It will also appear on the class Discord channel in a moment") and a "Saved" confirmation.

### F7 [low] Timetable footer: "The timetable has not been synced yet"
- Where: bottom of /s/plan
- Actual: Looks like an error, yet classes are shown. Unclear if I can trust the times.
- Suggestion: Explain who syncs it and how old the data is.

### F8 [idea] No Saturday column
- Where: /s/plan grid shows Mon–Fri and Sun, skipping Sat.
- Suggestion: Show Sat when it has events, or explain.

## What worked well
- Clear left menu ("Timetable", subjects with file counts) and a big "Week" heading with Previous / Today / Next.
- Required-field message "Please fill in this field." on the empty Title.
- Double-click on "Add event" did not create a duplicate.
- Class details panel with date, time, room, lecturer is easy to read.
- Download button and file names in the subject page are obvious; download works.

## Not tested / blocked
- Goals "tell the system my lab group" and "next Tuesday reminder as a kolokwium" were not part of this run's goals.
- Dev server hot reloads closed the class details panel several times, so a few clicks had to be repeated (not counted as a finding).
