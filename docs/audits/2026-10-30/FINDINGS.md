# Audit findings (2026-10-30)

Scope: the whole repo, with a focus on everything merged since the last audit (b78ea64..73e0c3f): the iCal group import, admin panel round 2 and the follow-ups batch.

Sources (all read-only, no DB tests run by the reviewers):
- [security-web.md](security-web.md): `sql-console-security-reviewer` (opus); W1–W5.
- [security-bot.md](security-bot.md): `discord-bot-reviewer` (opus); B1–B6.
- [security-runtime.md](security-runtime.md): runtime and supply chain, including `pnpm audit` (0 advisories); R1–R12.
- [performance.md](performance.md): with EXPLAIN on `studies_qa_test`; P1–P13.
- [correctness.md](correctness.md): spec compliance and logic of b78ea64..main; C1–C11.
- [QA SUMMARY](../../qa/2026-10-30/SUMMARY.md): 8 personas on the sandbox; U1–U15.

**Headline:** nothing critical or high. No auth or authz bypass was found, by code reading or by the attacker persona. The 2026-10-25 fixes held, except `reminder_log` pruning (P11), which is still open. Nothing has been fixed yet; this is the list to choose from.

## Proposed fix groups (by priority)

| # | Group | Findings | Why first |
|---|---|---|---|
| G1 | **iCal link leak and import hardening** | U1 (GET fallback puts the link in URLs and logs), W1/C3 (hostile calendar CPU: cap events and occurrences), C5 (mislabelled errors), C6 (more than 100 changes), C7, C8, B6 (shared/DB rate limit), W2 (3 MB action limit → route handler), W3 (feed hosts opt-in) | The spec promises the link is never logged; U1 breaks that. Users import a private link. |
| G2 | **RO console info leak** | U2 (`SHOW GRANTS` shows the `studies_ro` hash: deny it in the console statement filter, or give the account no password login from the web host) | Any student can see it; small fix. |
| G3 | **Admin queue robustness** | C2/B1 (a stuck `running` request blocks everything: retry, a stale-run reaper, a web cancel for stale running rows), W4 (lock release on failure), C4 (lock name per DB), B2, B3, U11 (cancelled shown as failed), P3 (Sync page loads full reports every 3 s) | One DB blip turns off the web admin until the bot restarts. |
| G4 | **Admin edit correctness** | C1 (stale form reverts another admin's change: compare against the values the form was opened with), C9, U9 (assign creates a group silently, no unassign, broken layout), U10 (DELETE preview ignores cascades) | Silent data loss on concurrent edits. |
| G5 | **Production runtime hardening** | R1 (apps as MariaDB root → `studies_app` / `studies_worker`), R2 (soffice: separate uid, hardened profile), R3 (symlinks in storage), R4–R9 (env per service, bot non-root, compose hardening, network split, pinning, ignore files), R10–R12 | Deploy-only. It needs a migration and a compose change plus a careful upgrade note. |
| G6 | **Performance** | P1 (separate pool for fixed queries vs the user console), P2 (Upcoming events full scan), P4, P5, P6, P7, P8, P9, P10, P11 (prune `reminder_log`), P12, P13 | P1 and P2 hit every student page load. |
| G7 | **Student UX: today and confirmations** | U3 (today/next class on Start, scroll to today, List from now), U4 (events index page, "see all"), U5 (save confirmations), U6 (friendly 404 / races), U7, U8, U12 (tap targets), U13, U14, U15 (a11y), QA lows | Largest visible effect; mostly UI work, so the taste skills apply. |
| G8 | **Bot and docs leftovers** | B4 (digest thread parent check), B5 (rename the Polish digest thread), C10 (docs drift: spec mediumtext, `UNITIME_IMPORT_HOSTS` in prod docs, 3 MB limit in CLAUDE.md), C11 (tests for C1, C2, C5–C8), security F2 (series count as one event in the hourly limit), W5 | Small; can ride along with other groups. |

## Not verified / needs a live check
- **Preview "Loading…" hang:** reported by 4 personas. Re-checked on a quiet sandbox, where the PDF loaded in about 3 s, so it was dev-server load. A preview timeout fallback (curator E5) is still worth adding under G7.
- **R2's linked-content path:** inferred, not reproduced.
- **Stack traces in a production build** (security F3, last round's F4): not checked.
- **Bot items that need a live server:**
  - whether mysql2 returns MariaDB `JSON` payloads already parsed;
  - real `/setup` duration against the 60 s "not responding" warning;
  - `plan.agh.edu.pl` redirect behaviour;
  - sending in a locked digest thread.
- **Chaos U8 (lost stale-tab save):** cause unknown, needs a repro.
