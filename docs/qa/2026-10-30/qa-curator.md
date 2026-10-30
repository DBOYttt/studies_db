# qa-curator — Ula Kuratorka — 2026-10-30

This file was saved by the controller from the agent's returned report.

Screenshots are in `.qa/screens/2026-10-30/`:
- simple mode: `curator-s-<screen>-<1440|375>-<light|dark>.png`;
- advanced mode: `curator-a-<screen>-…`.

**Summary:** the visual system is coherent. It uses Geist, one blue accent (`#235a81`) that matches the design reference, and a dark mode that holds up. The real problems are:
- a few layout bugs in the new admin pages;
- places where simple and advanced mode disagree;
- plain empty and 404 states;
- timetable, preview and event flows that cost students extra steps.

Every screen was swept in both modes at 1440 px and 375 px, light and dark. Not every cell was read closely.

## Errors

### E1 [medium] Admin subject page: "Assign a lecturer" labels overlap and the lecturer select collapses
- **Where:** `/admin/subjects/ASD`, left column.
- **Actual:**
  - The "Lecturer" label runs into "Class type" ("LecturClass type").
  - The select is about 25 px wide.
  - Three fields are squeezed into one row.
- **Evidence:** `curator-a-admin-subject-1440-light.png`, `-dark.png`.
- **Fix:**
  - Stack the fields, or give the select `flex: 1` plus a minimum width.
  - Each class card already has its own assign form, so this box duplicates them. Remove the box or make it the only one.

### E2 [medium] Date and time picker icons are almost invisible in dark mode
- **Where:** Add event, in both modes.
- **Actual:** dark grey indicators on a near-black field.
- **Evidence:** `curator-s-eventform-1440-dark.png`.
- **Fix:** `::-webkit-calendar-picker-indicator { filter: invert(1) }` under the dark scheme.

### E3 [medium] Simple and advanced search count differently for the same query
- **Where:** `/s/search?q=kolokwium` reads "4 files, 3 topics"; `/search?q=kolokwium` reads "2 files, 3 topics".
- **Actual:**
  - Simple counts files that were found only through a topic title.
  - Simple prints "3 topics" but shows none.
  - The link text runs on with no separator: "…3 topics Show topics in Advanced".
- **Evidence:** `curator-s-search-1440-light.png`, `curator-a-search-1440-dark.png`.
- **Fix:** use one counting rule. In simple, drop the topic count or show the topics.

### E4 [medium] The Advanced timetable List view starts in the past
- **Where:** `/plan?tab=list`.
- **Actual:** rows start at 2026-10-19. With 129 rows at 25 per page, today is far down.
- **Evidence:** `curator-a-list-1440-dark.png`.
- **Fix:** default to `starts_at >= now`.

### E5 [medium] Preview stuck on "Loading preview…"
- **Where:** `/s/subjects/ASD?file=9` and `?file=7`.
- **Actual:** it stayed loading for 15 s or more, while the dev server was being rebuilt (`ERR_CONNECTION_RESET` and `ERR_CONNECTION_REFUSED` on `/files/9/preview`). Later loads rendered fine, so this is not a confirmed bug.
- **Still worth fixing:** `FilePreview` / `PdfViewer` have no timeout. After about 10 s they should show "Could not load the preview. Download instead."

### E6 [low] Long unbreakable audit targets overflow the table
- **Where:** `/admin` and `/admin/audit`.
- **Fix:** `overflow-wrap: anywhere`, or truncate with a `title`.

### E7 [low] Mobile advanced and admin: key content sits off-screen with no hint
- **Tab row:** cut mid-word, with no fade or arrow.
- **Breadcrumb:** collapses to an icon plus one letter.
- **`/admin/users`:** the Block button is off-screen.
- **Audit:** the Target column is off-screen.
- **`/admin/lecturers`:** emails break mid-word.
- **Search:** the Snippet column is cut off.
- **Fix:** rows as cards on mobile, an overflow fade on the tab row, `overflow-wrap: anywhere` on emails.

### E8 [low] Timetable overlap truncates blocks
- **Where:** Tue 12:00, where an event sits beside a lab.
- **Fix:** show the full text in a `title` tooltip, or drop the second line when the block is narrow.

### E9 [low] Focus ring on the "File preview" heading
- **Actual:** the heading takes programmatic focus and shows a boxed outline.
- **Fix:** give the focused heading `outline: none`, or focus the container instead.

### E10 [low] Advanced preview toolbar: "Next" and the zoom "−" button touch

### E11 [low] Inconsistent naming
- "Designer", "Data map" and "Schema" name the same diagram page.
- Simple-only pages: "Recently added" and "Ready-made reports".
- "Uncategorized" for a class value.
- "Go" buttons.
- A cryptic "latest 0" badge on Sync.
- "Add files" is both a heading and a button.
- "Link posts" / "Unlink" is jargon.
- The upload limit sentence is hard to read.

### E12 [low] The simple/advanced split hides features
- The advanced subject page has no chips, Next classes, Entry quiz or Lecturers.
- The simple preview has no "Open in Discord".
- Simple has no List view.

### E13 [low] SQL result details
- Rows are numbered from 0.
- Timestamps are raw ISO.
- The query is printed twice.
- `History (0)…` is clipped.

### E14 [low] Plain stock Next.js 404 page, with no nav or back link

### E15 [low] Import form wording
- The bold label "or upload a .ics file" starts with "or".
- The file input is unstyled.
- One Preview button serves both inputs.
- Enter in the link field showed nothing in one try.
- The invalid-host error is clear.

### E16 [low] Sync page button hierarchy
- "Run setup" is the primary button, although the text says to preview first.
- "Reload to see the result" has no refresh.
- "Forum: Not created" doesn't link to Sync.

### E17 [low] Dark mode: the near-black background and the nav panel barely separate

## Usefulness ideas
- **Start:**
  - Add "Today / next class".
  - Put Recently added above the subject cards on mobile.
  - Use a compact subject list on mobile.
  - Remove the duplicate h1.
- **Timetable:**
  - Auto-scroll to today and add a "now" line.
  - Add a day/agenda list for mobile.
  - Make the "Pick yours" banner lead with one-click import.
- **My groups / import:**
  - "How do I get this link?" with a screenshot.
  - A paste button.
  - The detected-group count after Preview.
  - A shorter explainer.
  - A muted default for "All groups".
- **Subject page:**
  - Move Next classes and the nearest test above Files.
  - Square the chips.
  - "Back to files" on mobile preview.
  - An actionable empty state.
- **Search:** include events, add subject filter chips, a better empty state.
- **Event form:**
  - Default the date to today and prefill the subject.
  - Starts and Ends side by side.
  - A quieter Delete with confirmation.
  - A quick-add form.
- **Recently added:** group by day, a subject filter, highlight new items.
- **Reports:** link the cells, remember the last report, default to "Tests and exams in the next 30 days".
- **Advanced start:**
  - Collapse the SQL block and add a Today strip.
  - Shortcuts to Recently added and Reports.
  - A text label for the Admin entry.
- **Admin:**
  - A "needs attention" strip.
  - Readable audit targets.
  - "Not created" as an action.
  - Default ECTS and an uppercased code.
  - A textarea for the class note.
  - An unassign action for lecturers.
  - User role filter and sort.
  - A lecturer's classes on their page.
- **Simple "Admin panel" link:** it silently switches to advanced; say so or offer "Back to simple".

## What worked well
- The design system is consistent, and dark mode is solid on content screens.
- Timetable badges and today's highlight.
- Real empty states.
- The mobile nav drawer, reports and event form at 375 px.
- The preview panel.
- Clear import validation errors.

## Not tested / blocked
- A successful UniTime import.
- Form submissions; the persona stayed read-only.
- SQL editor error states.
- E5, which is unconfirmed because of dev reloads.
- Lecturer detail dark and 375 px, and admin/audit/[id].
- Keyboard and screen-reader checks.

## Top 5 by expected impact
1. **Make the timetable useful on a phone** (E4, E8): an agenda view from today, auto-scroll and a now line.
2. **Align simple and advanced search and navigation** (E3, E11, E12).
3. **Fix the admin "Assign a lecturer" layout bug** (E1) and link "Forum: Not created" to Sync.
4. **Rework the subject page hierarchy**, with a mobile "Back to files" and a preview timeout fallback.
5. **Add an admin "needs attention" strip** and mobile-friendly admin tables (E6, E7).
