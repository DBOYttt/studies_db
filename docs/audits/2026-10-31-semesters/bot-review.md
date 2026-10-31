# Bot review — semesters branch (discord-bot-reviewer, opus)

No Critical/High. 2 Medium, 5 Low.

- M1 My groups / entry-quiz pickers show name only; same-named subjects in different semesters look identical (prefix only >25). Fix: prefix whenever >1 semester present or names collide. (parts.ts:36-43, student.ts:586,723,541)
- M2 SEMESTER_RE exact/case-sensitive: `SEMESTR 3`, `Semestr  3` → duplicate category + silent semester-1 import. Fix: /^\s*semestr\s+(\d+)\s*$/i for adoption + import; warn when a forum's category isn't a recognised Semestr N. (plan.ts:71,551,689-697)
- L1 later semester category not positioned (createCategory has no position). Spec §2 vs CLAUDE.md disagree.
- L2 import warning advice "/subject edit" doesn't move the forum.
- L3 My groups >75 subjects cut silently (no "more" line).
- L4 My groups select values are positions, not subject ids (shift on concurrent subject creation; harmless).
- L5 stale per-semester lines in /plan status after every feed fails.

Checked fine: 50 cap counting, idempotent re-runs, slash choices, modal limits, select limits, /plan length, no URL leak, auto-created subjects get the right category.
