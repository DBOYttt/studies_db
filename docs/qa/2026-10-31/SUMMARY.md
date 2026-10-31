# QA run 2026-10-31: semesters branch (feat/semesters)

The sandbox was `:3200` / `studies_qa_test`, built from `.worktrees/semesters` (seed subjects in semesters 1, 3, 5 and 7). All eight personas ran in parallel. The two code reviewers' reports are in `docs/audits/2026-10-31-semesters/`.

| Persona | Critical | High | Medium | Low | Idea | Report |
|---|---|---|---|---|---|---|
| student | 0 | 0 | 2 | 5 | 1 | [qa-student.md](qa-student.md) |
| novice | 0 | 0 | 3 | 5 | 1 | [qa-novice.md](qa-novice.md) |
| admin | 0 | 0 | 1 | 5 | 2 | [qa-admin.md](qa-admin.md) |
| mobile | 0 | 0 | 3 | 4 | 2 | [qa-mobile.md](qa-mobile.md) |
| a11y | 0 | 0 | 2 | 5 | 2 | [qa-a11y.md](qa-a11y.md) |
| chaos | 0 | 0 | 0 | 5 | 2 | [qa-chaos.md](qa-chaos.md) |
| curator | 0 | 0 | 5 | 12 | many | [qa-curator.md](qa-curator.md) |
| security-auditor | 0 | 0 | 0 | 2 | 0 | [qa-security-auditor.md](qa-security-auditor.md) |

There are no critical or high findings. The security auditor found no bypass and no feed URL leak.

## Findings, deduplicated (Disposition = what this branch does)

### Medium
| # | Finding | Personas | Disposition |
|---|---|---|---|
| Q1 | The semester filter only partly applies on Start (Today/Next class, Recently added) and Reports, and nothing on screen says so | novice, student F2, mobile F6, curator E1 | **Fix:** filter Today/Next class, Recently added and Reports by semester; subject-less events still show |
| Q2 | The empty state doesn't say what is empty; on search it sits below the "Nothing found" box; the sidebar keeps an empty heading | novice, curator E2 | **Fix:** "No subjects in semester N." with the action in the same box; merged into the search empty box; empty heading hidden |
| Q3 | The timetable filter chip mentions only My groups, not the semester | novice | **Fix:** the chip also names the semester |
| Q4 | Switching semester resets focus with no announcement; the semester links are named only "1", "3"… | a11y F1, F3 | **Fix:** each link is named "Semester N" (the visible text stays N), and the page title carries "· Semester N" while a semester is filtered |
| Q5 | The phone select navigates on change (WCAG 3.2.2) | a11y F2 | **Parked:** it is labelled as a filter, as is common for this pattern, and has a noscript button |
| Q6 | The Timetable feeds card and the Timetable status card disagree after a save ("Never synced.") | curator E5 | **Fix:** show "Sync requested at HH:MM, waiting for the worker" while a request is pending |
| Q7 | Audit timestamps look 15–30 min off for some entries | admin | **Investigate:** fix if this branch caused it, otherwise park with the cause |
| Q8 | The phone top bar's mode toggle crowds out titles | curator E8 | **Parked:** existed before this branch (G8 / UX backlog) |
| Q9 | Simple and advanced search counts disagree; snippets show markdown | curator E9 | **Parked:** existed before this branch |

### Low (semester or feeds related: fixed)
- **Q10:** the phone select is 40 px wide, and the "Show all semesters" link is about 18 px tall (mobile F1, F2). **Fix:** 44 px.
- **Q11:** a mode switch from `/s?sem=2` drops `sem` (mobile F3). **Fix:** `modeTarget` keeps `sem` on its fallbacks too.
- **Q12:** the switcher shifts when a chosen semester has no subjects; segments are under 24 px; inactive "All" doesn't look like a link (curator E3). **Fix.**
- **Q13:** the feeds card copy: jargon, the fingerprint is unexplained, "Not set"/"—" are inconsistent, the column shifts, there is no allowed-host hint; the clear confirmation doesn't say the sessions go; there is no success message after a clear (curator E6, admin). **Fix.**
- **Q14:** the edit button's `aria-label` doesn't contain its visible text "Set"/"Close" (a11y F5). **Fix.**
- **Q15:** the advanced nav tree sorts subjects alphabetically while the other lists sort by semester (curator E13). **Fix:** sort by semester, then name.

### Low (parked: existed before this branch, or by design)
- **Q16:** a `?sem=` override is lost on the first internal link (chaos). This is by design: `?sem` is a one-page override and the cookie is the persistent choice. It is documented in CLAUDE.md.
- **Q17:** the default timetable week changes with the filter (curator E4). This follows the opening-week rule applied to the filtered sessions.
- **Q18:** Upcoming events is capped at 5 (student F1). By design.
- **Q19:** the 404 body for a refused Server Action shows node_modules paths in next dev only (security). Dev only.
- **Q20:** the feed fingerprint is an unsalted 24-bit hash (security). It only lets an admin confirm a guessed URL. Accepted.
- **Others that existed before this branch** are kept for the backlog:
  - student: the subject page ignores My groups, no confirmation after an event save, the sidebar highlight on Events, the PDF toolbar glyph;
  - a11y F4, F6, F7, F8;
  - mobile F4, F5, F7–F9;
  - chaos: "Today" lands on W44 vs W45, the favicon 404;
  - admin: the SQL refusal doesn't list the allowed tables, "rows 0 – 0", the Action filter lacks event/quiz actions, console errors on refusals;
  - curator E10–E12, E14, E16, E17.

## Curator top 5
1. Make the semester filter coherent: Q1–Q3, Q12 (**done in this branch**).
2. The timetable's main job: today's column, a phone day view, a groups prompt (backlog).
3. Free the phone top bar (backlog).
4. Make events findable: a nav entry, grouping by week (backlog).
5. Clarify the feeds card: Q6, Q13 (**done in this branch**).

Raised by two or more personas: Q1 (four personas) and the filter explanation (Q2/Q3).

## Not tested or blocked
- The sandbox ran `next dev` and was heavily loaded (load average about 25). Several personas lost form input to hot reloads or timeouts, and two forms came back blank after a submit (mobile F7, chaos) and could not be reproduced.
- Not tested in this run:
  - the a11y persona could not reach the feeds card as a non-admin;
  - nobody tested a feed link with a port or credentials, or exam link removal, in the browser (unit tests cover them);
  - the Today card on a weekday (the run date was a Saturday).
