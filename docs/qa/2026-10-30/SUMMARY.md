# QA run 2026-10-30: summary

Sandbox: `:3200` on `studies_qa_test`, `next dev`, 8 personas in parallel. Code audits are in [../../audits/2026-10-30/FINDINGS.md](../../audits/2026-10-30/FINDINGS.md).

**Caveat:** with 8 browsers hitting one `next dev` server, recompiles and Fast Refresh reloads were constant. Findings that only reproduce under that load are flagged *(dev)*. The "Loading preview…" hang (novice F2, mobile F2, curator E5, a11y) was re-checked on a quiet sandbox afterwards: the PDF loaded in about 3 s. It is not a bug, but a timeout and fallback would still help.

## Personas

| Persona | Critical | High | Medium | Low | Idea | Report |
|---|---|---|---|---|---|---|
| student | 0 | 0 | 3 (+1 dev) | 5 | 2 | [qa-student.md](qa-student.md) |
| novice | 0 | 0 | 3 (+1 dev) | 2 | 1 | [qa-novice.md](qa-novice.md) |
| admin | 0 | 0 | 3 (+1 dev) | 6 | 1 | [qa-admin.md](qa-admin.md) |
| curator | 0 | 0 | 4 (+1 dev) | 12 | many | [qa-curator.md](qa-curator.md) |
| mobile | 0 | 0 | 3 (+1 dev) | 5 | 1 | [qa-mobile.md](qa-mobile.md) |
| a11y | 0 | 0 | 3 | 4 | 1 | [qa-a11y.md](qa-a11y.md) |
| chaos | 0 | 0 | 4 | 3 | 1 | [qa-chaos.md](qa-chaos.md) |
| security auditor | 0 | 0 | 1 | 2 | 1 | [qa-security-auditor.md](qa-security-auditor.md) |

The security auditor found no auth or authorization bypass. Every admin page and all 10 round-2 Server Actions return 404 for students and the banned user, and the iCal import guard holds. No scenario corrupted or duplicated data: chaos double submits created exactly one event.

## Deduplicated findings

### Medium
- **U1. Forms submit as GET before hydration** (student F3, admin F9).
  - The iCal import form then puts the private timetable link in the URL. From there it reaches browser history and server/proxy access logs, which breaks "the link is never stored or logged".
  - Admin forms leak their values the same way.
- **U2. `SHOW GRANTS` in the read console shows the `studies_ro` password hash** to any student (security F1).
- **U3. "What do I have today?" has no answer on Start** (student F1, novice F1).
  - Start lists events only. The week view opens on Monday and does not scroll to today on a phone (mobile F4).
  - The advanced List view starts in the past (curator E4).
- **U4. Upcoming events on Start is capped at 5 with no "see all"**, so a new event may not show (student F2). `/s/wydarzenia` and `/wydarzenia` are 404 (chaos F7, admin F11).
- **U5. No confirmation after saves** (novice F5, student F8, admin F6).
  - Add event, save groups, reminders and restore give no clear success message.
  - The event form can sit with no pending state (chaos F6).
- **U6. Bare 404 after races**:
  - double-clicking "Yes, delete" (chaos F1);
  - uploading from a stale tab to a deleted event (chaos F2).

  The stock 404 page has no nav (curator E14).
- **U7. Mode switch link wrong after Back** (hydration mismatch, chaos F3).
- **U8. Two-tab My groups: a stale tab's save was lost** with no message (chaos F4; cause unknown).
- **U9. Admin "Assign a lecturer"**:
  - silently creates a group on a class with none, and there is no unassign in the UI (admin F2);
  - the box's layout is broken, with overlapping labels and a 25 px select (curator E1).
- **U10. Admin SQL DELETE preview counts only direct rows**, not FK cascades (admin F3).
- **U11. A cancelled bot request shows as red "failed"** (admin F4).
- **U12. Tap targets far under 44 px on mobile**: top bar 19–32 px, PDF toolbar, event actions (mobile F1, F3, F6).
- **U13. Simple and advanced search count files differently**, and simple shows a topic count without the topics (curator E3).
- **U14. Dark-mode date/time picker icons are nearly invisible** (curator E2).
- **U15. a11y**:
  - focus lost after Cancel in the delete dialog;
  - the same `<title>` on every page;
  - form errors not tied to their field (a11y F1–F3).

### Low (grouped)
- **a11y:** Escape doesn't close the delete dialog; light muted text is 4.40:1; duplicate "Preview"/"Download" names; no `lang="pl"` on simple sidebar subjects.
- **Mobile/layout:** timetable overlap truncation; breadcrumb collapse; tab rows cut without a hint; admin tables off-screen at 375 px; long audit targets overflow.
- **Copy and consistency:** Designer / Data map / Schema naming; the "or upload" label; the "latest 0" badge; "Files added" while still sending; series delete doesn't say how many; audit Action filter misses `event.*`, `class_mark.*` and `reminders.*`.
- **Import wording:** messages differ by case, and "subject not in Studies DB" is misleading (student F4).
- **Security low:**
  - A series counts as one event in the hourly limit, up to 300 rows/h (security F2).
  - Dev-only stack traces; still to confirm on a prod build (security F3).
- **Other:** favicon 404; session expiry lands on `/login-info` with no message and loses the form.

### Ideas
- An agenda/day view from today for mobile.
- Search includes events.
- A "needs attention" strip on the admin overview.
- Default the event date to today and prefill the subject.
- A subject file list that respects My groups.
- Two-tab event edits are last-write-wins with no warning.

## Curator's top 5
1. Make the timetable useful on a phone: an agenda view from today, auto-scroll, a now line.
2. Align simple and advanced search and naming.
3. Fix the admin "Assign a lecturer" layout, and link "Forum: Not created" to Sync.
4. Rework the subject page hierarchy, with a mobile "Back to files" and a preview timeout fallback.
5. Add an admin "needs attention" strip and mobile-friendly admin tables.

## Blocked / not tested
- A successful UniTime import: no allowlisted test feed in the sandbox, and the persona's crafted calendar didn't match any seeded subjects.
- Failed-upload retry: needs the bot.
- The PDF viewer after it loaded on mobile.
- The keyboard file chooser.
- Series edits in two tabs.
- Saving admin subject, class and lecturer edits.
- Whether production builds leak stack traces.

## Test data left in the sandbox
- events 38, 39 and 42–49;
- 29 queued uploads on event 39;
- persona group picks and reminders.

`pnpm qa:sandbox` resets them.
