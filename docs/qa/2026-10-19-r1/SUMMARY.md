# QA re-run 2026-10-19-r1 (after round 1 fixes): summary

Personas: `qa-chaos`, `qa-security-auditor` (sandbox :3200, in parallel).

| Persona | Critical | High | Medium | Low | Idea | Report |
|---|---|---|---|---|---|---|
| Chaos | 0 | 0 | 1 | 4 | 1 | [qa-chaos](qa-chaos.md) |
| Security auditor | 0 | 0 | 0 | 4 | 0 | [qa-security-auditor](qa-security-auditor.md) |

## Round 1 findings re-checked

| Finding (2026-10-16) | Result |
|---|---|
| H1 concurrent event creation 500 | fixed (two near-simultaneous creates both saved) |
| M1 two tabs editing one event | fixed (CONFLICT, input kept) |
| M2 edit of an event deleted elsewhere | fixed (banner, input kept, no 404) |
| Form emptied on a refused save | fixed |
| M17 admin console grant refusals not audited / misleading | fixed (named table/column, `sql.rejected` in Dziennik) |
| M19 SQL errors leak user/IP/schema | fixed |
| L22 upload without Origin | fixed (403; browser uploads still work) |

## New or remaining

- **Medium (chaos F2):** saving a form after logging out in another tab crashes the page and loses the input (no data change). → round 3 (forms and feedback).
- Low: Polish "Nie znaleziono wydarzenia." under the English deleted banner (chaos F1); upload to a deleted event only shows that message (F3); English native file picker (F4); `/s/wydarzenia` 404 (F5, round 2). Idea: Moje grupy save confirmation (F6, round 3).
- Low hardening (security): `SELECT user(), database()` shows the RO user/schema (F1); `/api/sql` and `/auth/logout` don't check Origin (F2); the 95 MB total is only pre-checked at 96 MB declared (F3, the stream counter enforces it); Dziennik doesn't show the source (F4).
