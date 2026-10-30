# qa-chaos — Szybki Szymon — 2026-10-30

Summary: No data was duplicated or corrupted in any scenario; double submit, delete, refresh and session end all ended in a consistent state, and the stale-edit case shows a clear message. The main problems are poor feedback and navigation. After a double-clicked delete the user lands on a bare 404, a stale upload to a deleted event replaces the page with a 404, and the mode switch link points to the wrong page after Back. A stale two-tab My groups save was also lost without any hint (cause unknown). Many saves and loads took 5-40 s because the sandbox runs `next dev` ("Compiling" badge, several personas at once), so some "stuck form" impressions may be a dev-server artifact.

## Findings
### F1 [medium] Double-clicked "Yes, delete" ends on a bare 404 page
- Where: `/s/wydarzenia/30`
- Steps: 1. Open an event, click Delete. 2. Double-click "Yes, delete" quickly.
- Expected: The event is deleted once and you go to the timetable (as with a single click, which redirects to `/s/plan`).
- Actual: The button greys out for about 30 s (dev server). The event page then re-renders as "404 This page could not be found." with no explanation and no link back. The data was correct: the event is gone and the history shows one deletion. A single click on another event (id 31 and 33) redirected to `/s/plan` correctly.
- Evidence: `.qa/screens/2026-10-30/chaos-3.png` (pending), `.qa/screens/2026-10-30/chaos-4.png` (404)
- Suggestion: After a delete, treat "already deleted" as success and redirect to the timetable. Do not rely on the page re-rendering.

### F2 [medium] Upload from a stale tab to a deleted event: page turns into a plain 404
- Where: `/s/wydarzenia/33`, `POST /api/wydarzenia/33/pliki`
- Steps: 1. Open event A in tabs 1 and 2. 2. Delete it in tab 1. 3. In tab 2 click "Add files" and pick a file.
- Expected: A message like "This event was deleted, the file was not sent".
- Actual: The POST returns 404 and the tab shows the generic Next.js 404. No upload row is shown and the user is not told why.
- Evidence: `.qa/screens/2026-10-30/chaos-7.png`; network: `[POST] /api/wydarzenia/33/pliki => [404]`, then `[GET] /s/wydarzenia/33 => [404]`
- Suggestion: Show the same inline notice the edit page has, or at least a 404 that says the event was deleted.

### F3 [medium] Mode switch link is wrong after browser Back (hydration mismatch)
- Where: `/wydarzenia/nowe`, reached with Back from `/wydarzenia/41`
- Steps: 1. In advanced mode, submit "Add event" (redirects to `/wydarzenia/41`). 2. Go to the timetable, then press Back twice to return to `/wydarzenia/nowe`. 3. Click "Simple" in the top bar.
- Expected: Go to `/s/wydarzenia/nowe`.
- Actual: Console error "A tree hydrated but some attributes of the server rendered HTML didn't match": the client wants `next=%2Fwydarzenia%2Fnowe`, the HTML has `next=%2Fwydarzenia%2F41`. React does not patch it, so the click goes to `/s/wydarzenia/41`, not the form.
- Evidence: console log shows the diff `href=/mode?to=simple&next=%2Fwydarzenia%2Fnowe` against `.../41`. `.qa/screens/2026-10-30/chaos-10.png`
- Suggestion: Do not read the path from the server render (or use the cached RSC payload) when building the `ModeSwitch` href. Compute it on the client from `usePathname`, or add `suppressHydrationWarning` plus a client fix-up.

### F4 [medium] Two-tab My groups: the later save from the stale tab was lost (cause not known)
- Where: `/s/plan?tab=groups`
- Steps: 1. Open My groups in tabs 1 and 2 (the value is Gr. 3). 2. In tab 2 pick Gr. 2 without saving. 3. In tab 1 pick Gr. 1 and Save. 4. In tab 2 click Save. 5. Reload.
- Expected: Last write wins (Gr. 2), or a notice that the data changed.
- Actual: After reload the class shows Gr. 1, so tab 2's Save changed nothing and said nothing. I saw the same in my first try (the later save did not apply). A normal single-tab pick of Gr. 2 and Save works (confirmed after reload). I don't know why the stale save is dropped. Guess: the action only writes rows that differ from the page's initial state, or the select is reset. Please check the code.
- Evidence: `.playwright-mcp` snapshots `page-2026-10-29T23-47-18-453Z.yml` (Gr. 1 selected) and `page-2026-10-29T23-47-44-144Z.yml` (single tab, Gr. 2 selected)
- Suggestion: Make the result explicit. Either last write wins or show "Your groups were changed in another tab, reload".

### F5 [low] Session ends: redirect to `/login-info` with no explanation and the form is lost
- Where: any form after logging out in another tab
- Steps: 1. Fill "Add event" (title "After logout") in tab 2. 2. Sign out in tab 1. 3. Click "Add event" in tab 2.
- Actual: A redirect to `/login-info` ("type /link on your Discord server"). The typed data is lost and nothing says the session expired. The event was not created. Also checked: Back after sign out returns to `/login-info`, so no cached protected page. A stale page that is clicked (Next week) redirects to `/login-info` after a few seconds.
- Evidence: `.qa/screens/2026-10-30/chaos-8.png`
- Suggestion: Say "Your session has ended". Optionally keep the form text in the browser.

### F6 [low] After saving an event the form can stay on screen for a long time
- Where: `/s/wydarzenia/nowe`, `/s/wydarzenia/31/edytuj`
- Actual: After "Add event" or "Save", the page stayed on the form (empty form after add, old values after edit) for 10-40 s before the redirect. The button looks greyed out but there is no spinner or text. A user would think it failed and click again (they would create a duplicate when the first double click did not yet redirect). No duplicates were created in my tests (ids 30 and 31 were created once each). Likely a dev-server compile delay.
- Evidence: `.qa/screens/2026-10-30/chaos-1.png` and `chaos-2.png`
- Suggestion: Show "Saving…" in the button when pending. Check whether it is slow with a production build.

### F7 [low] `/s/wydarzenia` gives a 404
- Where: `/s/wydarzenia`, `/wydarzenia`
- Actual: Only `nowe` and `[id]` exist, so hand-trimming the URL gives a 404. Also, the edit page for a deleted event shows the old data with a good red message "This event was deleted. Your changes weren't saved." (see What worked well).
- Suggestion: Redirect the index to the timetable.

### F8 [idea] Concurrent event edits: last write wins with no warning
- Where: `/s/wydarzenia/31/edytuj` in two tabs
- Actual: Tab B saved "Tab B title / Place B", then tab A (opened before) saved "Tab A title / Place A". The page shows A. Both changes are in the History ("changed: title, place"), so nothing is lost, but A silently overwrote B.
- Suggestion: Optional "changed since you opened this form" check (a version or updated_at field).

## What worked well
- Double submit of "Add event" (simple and advanced): exactly one event each. The advanced form redirected to the new event page.
- Double-click on "Sign in" creates one working session.
- Stale edit of a deleted event: red notice "This event was deleted. Your changes weren't saved." with a link back.
- Back after submit: the form comes back empty, so no accidental resubmit. Back after sign out lands on `/login-info`.
- Refresh during upload: after reload the file is listed as "chaos_big.bin · sending…", state consistent. (The Discord bot does not run in the sandbox, so it never changed to done.)
- Fast week navigation (Next/Next/Previous/Next) and Simple/Advanced switching kept the week (`week=2026-W46`) and showed no wrong data or flicker.
- My groups: single-tab save works; a double-click on Save gave no error.

## Not tested / blocked
- Page left open for a very long time (not simulated beyond a new login; I only used a logout and a new login).
- Refresh in the middle of a real upload progress (the 3 MB file finished before I could reload; I reloaded straight after choosing it).
- Double-submit of the delete on an event with files; "Try again" on failed uploads (no bot to produce failures).
- Series events (repeat) in two tabs.
- Console: besides F3, only font preload warnings and the Fast Refresh log. Network: only the expected 404s from F2.
