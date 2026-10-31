# qa-novice — Pan Zenon (novice) — 2026-10-31

Summary: I reached all five goals, but only because I kept retrying. The dev server was recompiling the whole time (the "Compiling…" badge, Fast Refresh in the console), so many clicks and form changes were lost. The semester switcher is the weak spot. Picking "5" silently empties most of the screen, and only Search explains why. Getting back with "All" is easy once you notice it.

Screenshots were saved to `/Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-31/novice-1.png` through `novice-24.png`. The tool resolves the path against the main checkout, not the worktree.

## Goals
1. Next class: managed. Start shows a "Next class" card ("Mon 2 Nov, 08:00–09:30 Algorytmy i struktury danych Wykład A-1 101"). I understood it at once. It says "Showing all groups.", so I wasn't sure it was mine.
2. Notes for "Bazy danych": managed. I clicked the subject, then the "Notatki" chip under "Type" (a good match for "notes"). I opened `normalizacja.pdf` with "Preview" and the side panel opened. Clicking the file name did nothing visible for me (see the note on dropped clicks under Not tested).
3. Lab group: managed. I went Timetable, then "Pick yours", then the My groups tab, and chose "Gr. 2" for "Bazy danych · Laboratorium". I got "Groups saved." and a "Filter: My groups" chip. I first picked the wrong row by mistake: "Analiza matematyczna 2 · Ćwiczenia" ended up on Gr. 2. That is a typical beginner mistake, and the list of 9 near-identical rows invites it.
4. Kolokwium reminder: managed. Timetable, then "Add event". I tried submitting empty and got "Please fill in this field." on Title, which is clear. The date is a picker, so I could not type a wrong format. The event is saved as "Tue 3 Nov 2026, all day" and appears on the timetable. The word "reminder" never appears; I guessed "Add event" was the right thing.
5. Back to Start: managed. Both the "Start" menu item and the "StudiesDB" logo work.

## Findings
### F1 [medium] Choosing a semester gives no on-page explanation, so things "vanish"
- Where: top bar "Semester All 1 3 5 7", then Start (`/s`), Timetable (`/s/plan`), the left "Subjects" list.
- Steps: 1. On an event page, click "5". 2. Click "Start". 3. Click "Timetable".
- Expected: a visible note such as "Showing semester 5 only. Show all".
- Actual: the left list shrinks to the single entry "Uczenie maszynowe". Start shows only one subject card. The timetable loses nearly all classes. The only clue is a small highlighted "5". The Timetable filter chip says "Filter: My groups change" and does not mention the semester. As a newcomer I would think my subjects were deleted.
- Evidence: `.qa/screens/2026-10-31/novice-19.png`, `novice-20.png`.
- Suggestion: show a banner or chip on Start, Timetable and the events list ("Semester 5 only · Show all"), like the one Search already has. Put the semester in the Filter chip as well.

### F2 [medium] Start mixes filtered and unfiltered content under semester 5
- Where: `/s` with "5" selected.
- Actual: "Next class" still shows "Algorytmy i struktury danych" (semester 1), while "Subjects" shows only semester 5 and "Upcoming events" is filtered. "Next class" and "Recently added" ignore the filter, so the page contradicts itself.
- Evidence: `.qa/screens/2026-10-31/novice-19.png`.
- Suggestion: either filter every block, or label the unfiltered ones ("all semesters").

### F3 [low] The switcher label is cryptic
- Where: the top bar.
- Actual: "Semester All 1 3 5 7". I understood "Semester", but the bare numbers 1, 3, 5, 7 do not say whether they mean semesters or something else, and there is no tooltip. Only odd semesters are offered, and I wondered where 2 and 4 went (a guess: those semesters have no subjects).
- Suggestion: use "Sem. 1", add a tooltip such as "Show only subjects of this semester", or use an explicit "Semester: [All ▾]".

### F4 [medium] The Search empty state leads with the wrong message
- Where: `/s/search?q=Bazy+danych` with "5" selected.
- Actual: "0 files" and "Nothing found. Try another word." come first. The explanation "Showing semester 5 only. Show all semesters" is a small line underneath. I would have retyped the word first.
- Evidence: `.qa/screens/2026-10-31/novice-21.png`.
- Suggestion: put the semester hint inside the empty box, for example "Nothing found in semester 5. Search all semesters".

### F5 [low] "Show all semesters" mangles the query in the URL and was slow
- Where: the link at the bottom of Search.
- Actual: the link target is `/semester?to=all&next=%2Fs%2Fsearch%3Fq%3DBazy%2520danych`. The query was `Bazy+danych` and came back as `Bazy%20danych` (double-encoded, harmless here). The click took more than 20 s and timed out in my tool. This may be dev-server load (a guess).
- Suggestion: check that `next` encoding survives a query that contains special characters.

### F6 [low] Recovery is possible but not obvious
- The bar shows "All" as a link, and clicking it restored everything (`novice-23.png`). Search has a dedicated recovery link, but Start, Timetable and the subject list do not. This ties into F1.

### F7 [low] My groups: nine similar rows, and no confirmation on the same tab
- Where: `/s/plan?tab=groups`.
- Actual: I changed the wrong row by accident. After "Save" the page jumped to the Week tab with "Groups saved.", so I could not check my choice without going back.
- Suggestion: keep the user on My groups after saving, or use a sticky group header per subject. A "Your lab group" shortcut for the subject page would help goal 3.

### F8 [idea] Add event is not labelled as a reminder
- The task says "add a reminder that there is a kolokwium". Type defaults to "Test", which matches, but a newcomer looks for "reminder". The "Reminders" box on My groups ("A Discord direct message before events of your groups.") is a different thing, which is confusing.
- Suggestion: on the form add a hint such as "Everyone sees this on the timetable".

### F9 [low] The "Repeat" and "Starts/Ends" optional fields are fine, but "Without a time the event lasts all day." appears below Ends and not next to Starts.

## What worked well
- Required fields are starred, and the browser message "Please fill in this field." focuses the field.
- "Groups saved." and "Event saved." give clear feedback.
- The Start "Next class" card answers goal 1 within seconds.
- The "Notatki" chip and the Preview side panel work well.
- The Search semester hint exists (see F4 for wording).
- "All" in the switcher restores everything.

## Not tested / blocked
- Many clicks and form changes were lost or delayed because the dev server was recompiling (the "Compiling…" badge, the page reloading under me, "Saving…" hanging for 30 s). I treat this as an environment issue, not an app bug. The first click on the Bazy danych card on Start and on a file name did nothing, and on some selects my choice was wiped by a reload. It may also point to hydration lag, which I can't tell apart.
- I did not test the browser Back button in the middle of a form, the advanced mode, the semester switcher on a phone, or a semester without subjects.
- The final click on "7" was interrupted by a navigation, so I did not look at semester 7.
