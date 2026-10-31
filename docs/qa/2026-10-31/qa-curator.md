# qa-curator — Ula Kuratorka, 2026-10-31

The agent returned this report inline, and the controller saved it here. This is a condensed copy: every finding is kept, and the long usefulness section is shortened. It covered every screen in both modes, in light and dark themes, at 1440 and 375 px. The 114 screenshots are `.qa/screens/2026-10-31/curator-*.png`.

## Errors

- **E1 [medium] The semester filter only partly applies on simple Start and Reports.** With semester 3 chosen, Start still shows Next class/Today and Recently added from semester 1. Reports lists all subjects while the sidebar shows one. Nothing on screen says these blocks are unfiltered. Fix: filter them, or label them "all semesters".
- **E2 [medium] The empty-state line doesn't say what is empty.**
  - "Showing semester 2 only. Show all semesters" sits under the unchanged "Pick a subject…" text, and the sidebar keeps a bare "SUBJECTS" heading.
  - On search, the line sits below the "Nothing found" box.
  - Fix: "No subjects in semester 2." with the action in the same box; on search, say how many results are in other semesters; hide the empty sidebar heading.
- **E3 [low] Switcher layout and targets.**
  - A chosen semester with no subjects inserts an extra segment, so the bar shifts.
  - Segments are about 20×22 px, under the 24 px minimum.
  - "All", when inactive, doesn't look like a link.
  - The Suspense fallback is null, so the switcher can briefly be missing.
- **E4 [low]** The default timetable week changes with the filter (All opens W44, semester 7 opens W45) with no note.
- **E5 [medium] Timetable feeds and Timetable status cards disagree.** After a feed is saved, the Timetable card still says "Never synced." with the generic waiting text. Fix: "Sync requested at HH:MM, waiting for the worker".
- **E6 [low] Feeds card copy.**
  - The jargon ("env feed", "keep theirs") and the unexplained `#74e1cd` fingerprint need plain wording.
  - "Not set" is in monospace, and an empty exam cell shows "—" where a set row would show "Not set".
  - The Class feed column x position moves with the row's buttons.
  - No hint names the allowed host until a save fails.
  - The card heights don't match.
- **E7 [low, unconfirmed]** Pressing Enter right after opening a feed row closed it without saving; probably a hydration race or Fast Refresh.
- **E8 [medium] The phone top bar's Simple/Advanced toggle crowds out the page title**, which gets truncated (pre-existing).
- **E9 [medium] Simple and advanced search counts disagree** ("4 files" vs "2 files, 3 topics"), and snippets show raw markdown (pre-existing).
- **E10 [low]** The timetable hides today's column when it is empty, and there is no today highlight (pre-existing).
- **E11 [low]** The sidebar highlights the wrong item on the events list and event pages, and there is no Events nav entry (pre-existing).
- **E12 [low]** Naming differs between modes (Start/Subjects, Designer/Schema/Data map, Type/Class) (pre-existing).
- **E13 [low]** The advanced tree sorts subjects alphabetically while the other lists sort by semester then name, and truncation differs between modes.
- **E14 [low]** On phones, the Start "Next class" layout is squeezed, and the half-moon glyph has no meaning (pre-existing).
- **E15 [low]** On advanced phone screens, the SQL block, clipped tabs, Designer fit and tall audit rows push content down (pre-existing).
- **E16 [low]** On admin pages, Overview badges wrap, there is an opaque "8" target, and "SQL rejected" rows show no reason (pre-existing).
- **E17 [low]** Smaller items: the Columns list is clipped without an ellipsis, the Designer `v_subjects` card lacks semester and ects, checkboxes are white in dark mode, and the Reports grid fills three of four columns (pre-existing).

## Top 5 (curator)
1. Make the semester filter coherent (E1–E3).
2. Fix the timetable's main job: today's column, a phone day view, a groups prompt (E4, E10).
3. Free the phone top bar (E8).
4. Make events findable and readable (E11, events list ideas).
5. Clarify the Timetable feeds card (E5–E7).

E9 is a correctness bug and should come before 4 and 5.

## Ideas (condensed)
- **Start:** a first-run "Pick your groups" prompt, and Recently added before the subject grid on phones.
- **Timetable:** a phone day view, a link from a block to the subject's materials, and a legend toggle.
- **Subjects:** compact class and type filters on phones, file counts on chips, and the label "Material type".
- **Search:** a subject chip on each hit, snippets without markdown, and matching counts.
- **Event form:** prefill from context, the title first, and optional markers on fields.
- **Events list:** grouped by week, series collapsed, kind as text, a subject filter, and a nav entry.
- **Recent and Reports:** Recent grouped by date; Reports follows the semester filter, with a per-semester report.
- **Advanced:** semester examples in the SQL console, and semester and ects on the Designer card.
- **Admin:** a Timetable health card on Overview, per-semester last import on the feeds card, and the rejection reason in the audit log.

## Worked well
Dark mode has no contrast faults. The switcher fits both shells, and its phone row has 44 px targets. The advanced grid shows the SQL with the semester. The feeds card reuses existing patterns, and its field error and hint are clear. The simple and advanced structures match well.
