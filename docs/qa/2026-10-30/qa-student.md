# qa-student — Ola Studentka — 2026-10-30

Summary: All eight tasks can be done in simple mode and the data ended up correct (groups, event, edit, linked post, reminder, search, mode switch). The new "Import from UniTime" block handles the invalid URL, a non-allowlisted host, a lookalike host, a non-calendar file and an empty calendar with clear messages. The two things that hurt most: the start page never shows today's classes, and the page often reloaded or hydrated slowly (dev server), so forms were lost or fell back to a plain GET (which puts the typed iCal link into the URL).

Steps per task (browser calls; many extra ones came from page reloads, see F5):
1. Start page, today/this week: done, 3 steps, but only partly (see F1).
2. My groups: done, ~6 steps. BD Laboratorium Gr. 2 + ASD Ćwiczenia Gr. 1 saved, the week now shows only those groups plus lectures. Note makes sense (F6).
3. Materials BD, PDF preview, download: done, 4 steps. Preview panel works, download gave the file.
4. Add kolokwium (BD, 4 Nov, place, note): done, ~8 steps (two lost to reloads). In the plan and on its page; not on the start page (F2).
5. Edit time 10:00 -> 12:00 and link post "Kolokwium SQL gr 2": done, ~8 steps. Its file appears under Materials, history shows both changes.
6. Reminders 24 h: done, 2 steps; still checked after a reload.
7. Search "Dijkstra" (word only in file text): done, 2 steps. Hit with highlighted snippet.
8. Advanced and back: done, 2 clicks. The equivalent page is kept (`/search?q=…` and back to `/s/search?q=…`).

Console after each task: no errors except `favicon.ico` 404 (F7). Only font-preload warnings otherwise.

## Findings
### F1 [medium] Start page does not show what classes I have today or this week
- Where: `/s`
- Steps: 1. Log in. 2. Look at the start page.
- Expected: "Today" and "this week" classes (the task: find out what classes you have today and this week).
- Actual: Start shows "Upcoming events" (kolokwia, consultations, ...) and a subject grid. No class sessions at all. I had to go to Timetable (`/s/plan`) and read the week grid. On Fri 30 Oct (today) the grid has 4 classes + 1 event, none of which is on Start.
- Evidence: `.qa/screens/2026-10-30/student-9.png` (timetable), start page snapshot.
- Suggestion: A "Today" list (and maybe "Rest of the week") of the student's classes on Start, honouring My groups.

### F2 [medium] New event does not appear on the start page; the list has no "see all"
- Where: `/s`, "Upcoming events"
- Steps: 1. Add Kolokwium z SQL for Wed 4 Nov. 2. Open Start.
- Expected: The event is visible on Start (the task expects it).
- Actual: The list is capped at 5 events ordered by date (30 Oct to 2 Nov), so a kolokwium next week is not there and there is no "all events" link. A student cannot tell whether the add worked from Start.
- Evidence: Start snapshot (5 items, last "QA admin weekly series Mon 2 Nov"). The event is in the plan (W45 Wed 4 Nov 10:00) and at `/s/wydarzenia/38`.
- Suggestion: Add a "All events" / "Show more" link, or show the user's own newly added events and tests first.

### F3 [medium] Pre-hydration submit of the import form falls back to GET and puts the iCal link in the URL
- Where: `/s/plan?tab=groups`, Import from UniTime form
- Steps: 1. Open the My groups tab. 2. Type a link (or choose a file) and press Preview/Enter before the page is fully hydrated (slow dev server).
- Expected: Nothing is sent in the URL; or the button stays disabled until ready.
- Actual: The browser did a plain GET and landed on `/s/plan?url=http%3A%2F%2Fplan.agh.edu.pl.evil.example%2Fcal.ics&file=` and `/s/plan?url=&file=student-empty.ics`, showing the week view and no message. A real personal UniTime link (it is a secret token) would end up in the address bar, history and logs.
- Evidence: URLs above, seen three times.
- Suggestion: Give the form `method="post"` (or no GET fallback) and make the Preview button disabled until hydrated. Guess: only happens on a slow first load, but it is easy to hit.

### F4 [low] Import: error wording differs by case, and "subject not in Studies DB" is misleading
- Where: Import from UniTime
- Observed messages: invalid text `not a url` is blocked by the browser ("Please enter a URL."); `https://example.com/cal.ics` -> "Only links from plan.agh.edu.pl can be imported."; `http://plan.agh.edu.pl.evil.example/cal.ics` -> "Use an https:// link from plan.agh.edu.pl." (the scheme error wins over the host error); text file -> "That is not a UniTime calendar (.ics)."; empty calendar -> "This calendar has no classes yet. UniTime may not have published your timetable; try again later or pick your groups below."
- Problem: A calendar with "Bazy danych · CWL 1" is shown as "Bazy danych · CWL 1: subject not in Studies DB", although Bazy danych is in Studies DB (the name just differs from the stored UniTime name). A student would read this as a bug. Also, the lookalike host gets the scheme message, which hides that the host is wrong too (minor).
- Evidence: `.qa/screens/2026-10-30/student-24.png`, `student-23.png`, `student-4.png`.
- Suggestion: Say "no subject with this UniTime name" or "name not recognised", and mention both scheme and host in one message.
- Not tested: a successful match (my test calendar used names that are not in the sandbox), and a real link on plan.agh.edu.pl (no outbound requests from the sandbox). The rate limit (6 per 10 min) was not hit.

### F5 [medium] Dev server reloads the page repeatedly (guess: Fast Refresh / compiling while other personas browse)
- Where: everywhere, most on forms
- Steps: Work normally for a minute.
- Actual: Many full reloads ("Fast Refresh ... performing full reload", `ERR_CONNECTION_RESET` for a webpack chunk, "Compiling..." badge). I lost typed form content three times (import link, add-event form, subject select reset to "No subject" after fields were filled), and the first Preview clicks silently did nothing. Server actions (import preview, add event) sometimes took 20+ s with "Reading…" / disabled button and no progress text. Probably a sandbox-only effect (dev mode, several personas) but a student would see it as a flaky site.
- Evidence: console logs under `.playwright-mcp/`.
- Suggestion: Run the sandbox with a production build for QA, or ignore these results for timing.

### F6 [low] Hidden-classes note is truncated and a bit terse
- Where: `/s/plan` after saving groups
- Actual: "Filter: My groups change  11 classes hidden: pick a group for AM2, ASD, SK…" The list ends with an ellipsis, so I cannot see all subjects; "ASD" is named although I picked ASD Ćwiczenia (the ASD Laboratorium is still unpicked), which may confuse. The text does make sense overall (hidden = classes left on "All groups").
- Evidence: `.qa/screens/2026-10-30/student-9.png`
- Suggestion: Name the class too ("ASD Laboratorium") or link "change" to the unpicked ones; show the full list on hover/expand.

### F7 [low] favicon.ico returns 404 (console error)
- Where: every page
- Actual: `Failed to load resource: 404 /favicon.ico` is the only console error in the whole run.
- Suggestion: Add a favicon.

### F8 [low] No visible confirmation after saving groups or toggling a reminder
- Where: `/s/plan?tab=groups`
- Actual: After Save and after ticking "24 h before" the status area stayed empty in my screenshots (the values were saved: confirmed after a reload). I could not tell it worked without reloading. May have been hidden by a reload (see F5), so a guess.
- Suggestion: Show "Saved." next to Save and the checkbox.

### F9 [idea] Subject file list ignores My groups
- Where: `/s/subjects/BD`
- Actual: With BD Laboratorium Gr. 2 selected, the list still shows Gr. 1 files (joiny.sql, "Laboratorium, Gr. 1"), whereas the timetable hides the other groups. Maybe on purpose; a "only my groups" toggle would be nice.

### F10 [low] PDF preview toolbar cramped
- Where: file preview side panel at 1280 px
- Actual: "Next" and the zoom "−" control touch each other ("Next >" overlaps the minus button).
- Evidence: `.qa/screens/2026-10-30/student-11.png`

## What worked well
- Import validation: browser URL check, host allowlist, scheme check, bad file and empty calendar all end in clear plain English, nothing from the link echoed back.
- My groups saved and persisted; the week view filters correctly and the filter chip links back to the setup.
- Add/edit event: all fields (type, subject, class, date, times, place, note) kept; page shows When/Subject/Place/Added by/note, "Changes saved." and a History list ("changed: start, end").
- Link posts search and link: the post's file showed under Materials immediately with Preview and Download, "Post linked." and an Unlink button.
- Full text search finds a word only in the file body with a highlighted snippet, in both modes.
- Mode switch keeps the equivalent page and search query.
- Reminder setting persisted after a reload.

## Not tested / blocked
- Successful group import (matched path), real plan.agh.edu.pl link, import rate limit, Import then Save flow.
- Reminders actually delivered (needs Discord/bot).
- Upload of files to an event (Add files), deleting the event.
- Screenshots: `.qa/screens/2026-10-30/student-1.png` ... `student-24.png` (not all numbers kept). Side effects in the sandbox: my saved groups (BD Lab Gr. 2, ASD Ćwiczenia Gr. 1), reminder 24 h on, event #38 "Kolokwium z SQL" (linked to a BD post), and a file download in `.playwright-mcp/`.
