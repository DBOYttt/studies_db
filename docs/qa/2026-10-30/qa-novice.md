# qa-novice — Pan Zenon — 2026-10-30

Summary: I reached all five goals by clicking only. The simple mode is mostly clear, but I never got a direct answer to "when is my next class", the PDF preview stayed on "Loading preview…", and after adding the event the form just reset with no confirmation. The dev server was slow (many clicks needed a second try), which I note separately because a beginner would think the site is broken.

## Goals

1. Next class: reached, but only partly (see F1). I clicked "Timetable" and saw the whole week for all groups. I only found the next classes by looking at the date headings. The "Next classes" box on a subject page (for example Bazy danych: "Fri 30 Oct 12:00–13:30 Projekt") answered the question better, but only per subject.
2. Notes for "Bazy danych": reached. I clicked the subject in the left list, then the "Notatki" button. That showed 2 files. I clicked "normalizacja.pdf" and a "File preview" side panel opened (see F2).
3. Lab group: reached. Timetable, then "Pick yours", then I chose "Gr. 2" next to "Bazy danych · Laboratorium", then clicked "Save" (twice, on purpose). The status said "Group saved." (see F4).
4. Kolokwium reminder: reached. Start, "+ Add event", empty submit, then Title "Kolokwium" and date 03/11/2026. Afterwards "Kolokwium Tue 3 Nov" appeared in "Upcoming events" (see F5).
5. Back to Start: reached. The "Start" link and the "StudiesDB" logo at the top left worked from every page.

## Findings

### F1 [medium] No obvious answer to "when is my next class"
- Where: /s (Start) and /s/plan
- Steps: 1. Sign in. 2. Look at Start: "Upcoming events" lists events (Konsultacje, Kolokwium) but no classes. 3. Click "Timetable".
- Expected: a line like "Your next class: ..." as soon as I open the app or the timetable.
- Actual: "Upcoming events" says nothing about lectures or labs; I thought it meant my classes. The timetable shows the whole week for all groups ("Showing all groups."). The hour grid has no highlight for "now". The timetable opens on Mon 26 Oct, so most of what I saw was already past.
- Evidence: .qa/screens/2026-10-30/novice-1.png
- Suggestion: add a "Next class" card on Start (after you pick a group). Highlight today and mark past classes as faded. Rename "Upcoming events" to "Upcoming tests and events" so it is not mistaken for classes.

### F2 [medium] PDF preview stays on "Loading preview…"
- Where: /s/subjects/BD?tag=7&file=10 (normalizacja.pdf)
- Steps: 1. Click "normalizacja.pdf". 2. Wait about 15 seconds.
- Expected: the document appears.
- Actual: the right-hand panel "File preview" showed only "Loading preview…" with the Download and Full screen buttons. No error and no hint to try the Download button. Guess: the dev server was still compiling (the "Compiling" badge was visible), but I can't be sure.
- Evidence: .qa/screens/2026-10-30/novice-3.png, novice-4.png
- Suggestion: after about 10 seconds show "Preview didn't load. Use Download."

### F3 [medium] The slow server makes clicks look like they did nothing
- Where: all links (Timetable, Pick yours, Start, + Add event)
- Steps: click a link, then nothing for 5 to 15 seconds. Several times I had to click again. The "Compiling…" badge of the dev tools was visible at the bottom left.
- Actual: no loading indicator in the page. One click on "Timetable" from the preview panel was lost.
- Suggestion: a thin progress bar at the top when a page is loading. This is probably a dev-mode artefact (guess), so low priority in production.

### F4 [low] Wording and feedback on the My groups page
- Where: /s/plan?tab=groups
- The first block on the page is "Import from UniTime … choose Export → iCalendar and copy the link". As a beginner I didn't know what to do with it, and the thing I wanted (my group) was further down. Labels like "Bazy danych · Laboratorium" are OK, but "All groups (not picked)" is odd.
- The confirmation "Group saved." appeared only in a status line. In my full-page screenshot I could not see it, so I wasn't sure the click had worked. The Save button moved no focus and showed no tick.
- The page text says "Pick your groups in the My groups tab", but the tab is "My groups" and the link in the week view is "Pick yours". It works, but the name differs.
- Evidence: .qa/screens/2026-10-30/novice-5.png
- Suggestion: put the group dropdowns first and the import below under "Advanced: import from UniTime". Show a green banner "Saved" near the Save button for a few seconds. Explain "Gr." once ("Gr. = group").

### F5 [medium] After "Add event" the form resets with no confirmation
- Where: /s/wydarzenia/nowe
- Steps: 1. Click "Add event" with nothing filled in: the browser says "Please fill in this field." (good). 2. Fill in Title "Kolokwium" and Date 03/11/2026 (typed 03112026 into the dd/mm/yyyy field). 3. Click "Add event". The button turns grey for a few seconds, then the form reappears empty on the same address.
- Expected: a message like "Event added" and a jump to the event or the timetable.
- Actual: an empty form, so I thought it had failed. I only knew it worked after going to Start and seeing "Kolokwium Tue 3 Nov". If I had pressed the button again I would have created a duplicate (not tested).
- Evidence: .qa/screens/2026-10-30/novice-8.png, novice-9.png, novice-10.png
- Suggestion: after saving, go to the event page or the week with a "Event added" message.

### F6 [low] "Add event" does not say it is a reminder, and "next Tuesday" is ambiguous
- Where: /s/wydarzenia/nowe
- I was looking for a word like "Reminder" or "Remind me". The form is called "Add event", with "Type: Test". I guessed that "Test" means kolokwium (it is, but the word differs from the Polish name; the label "Test" is the English UI word). "Subject" defaulting to "No subject" is fine, but I would not know that picking one would put it on the timetable. There is no hint such as "Choose a subject so it shows on the class".
- Suggestion: title the page "Add event (test, exam, trip…)" with a one-line hint. Add "Test (kolokwium)" to the Type option.

### F7 [idea] Notes are hidden behind a filter named "Notatki"
- Where: /s/subjects/BD
- The subject page opens with all 5 files in a flat list. The "Type" row "Kolokwium / Notatki / Projekt" has no explanation. "Notatki" gave me 2 files, but one was an .sql lab and the other a lecture PDF, so "notes" is a loose label. It was still the thing I clicked, as the button name matched what I wanted.
- Suggestion: none needed beyond a short caption under "Type".

## What worked well
- The Start page shows the subject cards with file counts. Clicking "Bazy danych" in the left menu was obvious.
- Empty required field gives a clear browser message ("Please fill in this field.") and the red stars mark required fields.
- The "Next classes" box on the subject page is a good, readable answer.
- The "Start" link in the left menu and the breadcrumb worked from every page.
- The timetable "(today)" label is helpful.

## Not tested / blocked
- Typed a really wrong date format: the date field is a native dd/mm/yyyy control, so I could not type a wrong format; I only typed digits, which were accepted.
- Pressing the browser back button in the middle of a form, and double-clicking "Add event".
- Whether the saved group changes the week timetable (I did not return to the Week tab after saving).
- Full screen preview of the PDF, text file previews.

Screenshots: /Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-30/novice-1.png to novice-10.png
