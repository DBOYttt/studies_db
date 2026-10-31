# qa-chaos — Szybki Szymon — 2026-10-31

Summary: The semester switcher held up under tampered `?sem=` values, two tabs, Back and mid-form switches. The cookie/URL precedence is predictable. I found no data corruption, no duplicates from double submits, and the conflict and stale-delete handling is sound. The issues are small: a `?sem=` override is lost on the next click, the Today link points to a different week than the page shows, and a subject outside the chosen semester shows no hint. The sandbox was very slow for most of the run (load average about 25, page loads of 10-60 s, one `ERR_CONNECTION_REFUSED`), so a few "stuck" clicks were load, not bugs.

## Findings
### F1 [low] A `?sem=` override is dropped by the first internal link
- Where: `/s/wydarzenia?sem=5`, then click Timetable in the sidebar.
- Steps: 1. Cookie is 1. 2. Open `/s/wydarzenia?sem=5` (switcher and list show 5; the sidebar also follows 5). 3. Click "Timetable".
- Expected: either stay on 5, or make clear that `?sem` is for this page only.
- Actual: `/s/plan` opens on semester 1 (the cookie). Nav links, Previous/Next/Today and the events pager (`?page=2`) carry no `sem`. Mode switch (`/mode`) and the switcher links do keep `sem` and week.
- Evidence: .qa/screens/2026-10-31/chaos-3.png (sem 5), chaos-4.png (after click, sem 1).
- Suggestion: this is probably by design. A shared `?sem=` link would then only work for its first page, so document it or carry `sem` in the links.

### F2 [low] Back does not restore the previous semester
- Where: `/s/plan`, switcher.
- Steps: 1. Click 3, then 5 in the switcher. 2. Press Back.
- Expected (user's view): the page for 3, or at least the 3 highlight.
- Actual: the URL goes back to `/s/plan` but the page still shows 5, because the cookie wins and the `/semester` redirect entries are replaced. Forward/Back therefore cannot walk through semesters, and the page matches the cookie, not the history entry. No crash and the data is consistent.
- Evidence: .qa/screens/2026-10-31/chaos-5.png.
- Suggestion: accept it, or put `sem` in the URL after the switch.

### F3 [low] "Today" opens a different week than the page shows
- Where: `/s/plan` on a Saturday (today is 31 Oct 2026), any semester.
- Steps: 1. Open `/s/plan`; the heading says "Week 45 · 2–6 Nov". 2. Look at Previous / Today / Next: they are `?week=2026-W44`, `W44`, `W46`. 3. Click Today.
- Expected: Today leads to the shown week, or the default view is the current week.
- Actual: the default shows week 45 (next week, weekend rule) but Today goes to W44, so "Today" moves back a week. Previous and Today are the same link. It also changed with the data: sem 1 showed W44 with a Sunday column, sem 3/5/7 showed W45.
- Suggestion: not a semester bug, but the default week should depend on the date, not on which semester has weekend sessions.

### F4 [idea] A subject outside the chosen semester shows no hint
- Where: `/semester?to=2&next=/s/subjects/UM`.
- Actual: semester 2 (no subjects) is accepted and shown in the switcher. The sidebar list is empty and the page shows subject UM, which is semester 5, with no note. `to=8` is ignored silently.
- Evidence: .qa/screens/2026-10-31/chaos-12.png.
- Suggestion: add a "Filtered to semester 2, this subject is in 5" line, or an empty-state in the sidebar.

### F5 [idea] Saved My groups apply across the semester filter, which can empty the week view
- Where: `/s/plan?tab=groups`.
- Steps: 1. In semester 7 pick Gr. 1 for Seminarium dyplomowe, and Save in one tab while another tab switches to 1. 2. Open the week view in semester 1.
- Actual: the save worked (reopened with `sem=7`: Gr. 1 selected). Semester 1 now shows "Filter: My groups, 15 classes hidden: pick a group for AM2, ASD, SK…". That follows the documented rule (saved groups are not filtered), but it looks like the semester filter broke the timetable.
- Evidence: .qa/screens/2026-10-31/chaos-9.png.
- Suggestion: say in the hint that groups are picked per class and apply in every semester.

### F6 [low] `/favicon.ico` is a 404 (console error on every page)
- Where: any page; console: `Failed to load resource: 404 /favicon.ico`. `icon.svg` exists.
- Suggestion: add a favicon link or route.

### F7 [low] Add-event form came back blank on `/nowe` after a submit (unconfirmed)
- Where: `/s/wydarzenia/nowe`, one click on "Add event" while the server was very slow.
- Actual: no redirect for more than 20 s; the form was later empty at `/s/wydarzenia/nowe`. The event was created exactly once (checked on the list, page 1, `sem=all`). Probably the dev server recompiling or reloading under load. I could not reproduce it, so treat it as a guess.
- Evidence: .qa/screens/2026-10-31/chaos-10.png.

## Scenario results
1. Double submit: a double-click on "Add event" (id 31) created one event. A double-click on "Yes, delete" sent a single delete and landed on `/s/plan`; no error and no duplicate. The delete confirm is a two-step control, which helps.
2. Back button: after Back to the used login-token page, "Sign in" shows `login-info?error=expired` and the existing session stays valid. Back after the semester switches: see F2. Back after submit on the event form was not run separately because of the slow server.
3. Refresh in the middle of an upload ("Dodaj pliki"): not tested, the sandbox was too slow to do it meaningfully. After saving My groups the state was consistent on reload.
4. Two tabs, event: both tabs opened edit for event 31; tab B saved (title and place), tab A then got "Someone changed this event while you were editing. Your changes weren't saved — reload to see the current version." The data is B's. Good. My groups: see F5; the last Save wins and the stored value was correct.
5. Stale page: event deleted in tab B; the edit form still open in tab A got "Event not found." on Save and wrote nothing (chaos-8.png). Upload to a deleted event not tested.
6. Session ends: Sign out in tab A, then Save in tab B went to `/login-info?expired=1` without a stack trace. `/semester?...` while logged out goes to `/login-info`. A second login worked. Replaying a used token gives `?error=expired` and keeps the session.
7. Fast navigation: Simple to Advanced and back with `sem` and `week` in the URL, and switching the semester in between, kept both values. No flicker or wrong data seen. On first paint with the cookie set, the top bar switcher was briefly missing in one screenshot (chaos-1.png, taken during hydration); it was present after load.

## Semester switcher
- Tampered values: `?sem=99`, `?sem=1&sem=5`, `?sem=%27%20OR%201=1--`, `?sem=1e0`, `/semester?to=0&next=//evil.com`, `/semester?to=8`. All rendered a normal page, no 500 and no external redirect (`next=//evil.com` went to `/s`); an invalid value is ignored.
- Two tabs, cookie 1 in tab A and `?sem=5` in tab B: each shows its own semester, and the sidebar follows `?sem` in tab B too. After a navigation in B it shows the cookie (F1).
- Switching while paging weeks: the switcher link keeps `week` in `next`, so the same week opens in the new semester.
- Event add with the semester changed in another tab mid-form: the event was saved with the chosen subject (UM, semester 5) even though the filter was 7; it shows in "All" and not under 7, as expected.
- Server load: the browser MCP timed out on several navigations and the dev server dropped one connection (`ERR_INCOMPLETE_CHUNKED_ENCODING` on `main-app.js`, `ERR_CONNECTION_REFUSED` on `icon.svg`). I believe this came from the other personas' load and a dev recompile ("Compiling..." was visible in chaos-12.png), not from the app.

## Console and network
- Errors seen: `/favicon.ico` 404 (F6); the two load errors above; one React hydration warning caused by the test browser (`caret-color` style on the search input), which I do not count as an app bug.
- Failed requests: none other than the above. The two POSTs for the edit and delete returned 200.

## What worked well
- The conflict message on concurrent edits, the "Event not found." message after a delete, and the expired-session redirect are clear and lose nothing.
- `/semester` rejects bad `next` values and bad `to` values safely.
- `sem` and `week` survive the mode switch and the switcher.

## Not tested / blocked
- Upload refresh and upload to a deleted event ("Dodaj pliki"), Back after submitting the event form, a page left open for a very long time (I only simulated it with a second login), My groups with two tabs saving different classes at the same time, and the advanced grid under rapid semester switches (the server was too slow).
- Test data left behind: event "chaos back test" (25 Nov, subject-less). Event 31 was deleted by me.

Screenshots: /Users/andrzejnazim/Documents/projects/studies_db/studies_db/.qa/screens/2026-10-31/chaos-1.png to chaos-12.png, console log chaos-console.txt.
