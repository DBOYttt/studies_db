# Security audit: bot (2026-10-30)

Reviewer: `discord-bot-reviewer` (opus). This file was saved by the controller, because the agent is read-only.

Scope: `apps/bot`, with a focus on `b78ea64..main`. Static reading plus `typecheck`; no tests were run.

Counts: critical 0 · important 0 · minor 6

## Findings

### B1. A stuck `running` admin request blocks the web admin until the bot restarts (minor)
- **Where:** `apps/bot/src/admin-requests.ts:160-177` and `:192-199`, plus `packages/db/src/bot-requests.ts:178-186`.
- **Problem:** `storeDone` tries twice in a row with no pause, and the failure path tries once. Only the boot recovery clears the row.
- **Scenario:** MariaDB restarts as a long `/setup` ends. Both writes fail, so the row stays `running`. Every setup, dry run or resync then gets "The bot is already working on a request."
- **Fix:** retry with a pause (1 s, 5 s, 30 s). In the poller, when the lock is free, fail admin rows left `running`.

### B2. A requester whose id is not a Discord id gets a raw Discord error (minor)
- **Where:** `apps/bot/src/admin-requests.ts:114-124`.
- **Scenario:** `seed-admin` queues a setup. The REST call fails with code 50035, and the stored message is "Setup failed: Invalid Form Body…". It stays refused, so this is not a security problem.
- **Fix:** test the id against `/^\d{17,20}$/` first and answer `NOT_MEMBER_MESSAGE`, as `reminders.ts:151` does.

### B3. A deleted admin role reads as "no longer an admin" (minor)
- **Where:** `apps/bot/src/admin-requests.ts:127-130`.
- **Scenario:** the pinned role is deleted in Discord. Every web admin who queues a request is told they are no longer an admin, their `is_admin` is cleared, and nothing points to a Discord `/setup`.
- **Fix:** if `guild.roles.fetch(roleId)` comes back empty, answer `NO_ROLE_MESSAGE` and leave the flag alone.

### B4. The digest posts to the stored thread without checking its forum (minor)
- **Where:** `apps/bot/src/reminders.ts:357-363`.
- **Scenario:** `/setup` makes a new `#wydarzenia` and the old forum is kept. The digest goes on posting, and unarchiving, in the old forum's thread.
- **Fix:** also require `c.parentId === forumId`; otherwise create a new thread.

### B5. The digest thread keeps its Polish name on existing servers (minor)
- **Where:** `apps/bot/src/reminders.ts:35`.
- **Problem:** `📅 Reminders` is only used when a thread is created. The stored thread stays `📅 Przypomnienia`, against the English-UI rule.
- **Fix:** rename it once, guarded by a setting, or note it in `docs/deploy.md`.

### B6. Import rate limit is per process (minor)
- **Where:** `apps/bot/src/ui/student.ts:366` and `apps/web/lib/group-import-actions.ts:58`.
- **Problem:** the bot and the web each allow 6 per 10 min, so a user gets 12, the count resets on restart, and there is no overall cap on calls to `plan.agh.edu.pl`.
- **Fix:** keep the count in the DB, or add an overall per-process cap.

## Checked and found fine
- **Admin requests:**
  - The payload is checked; `isAdmin` is required and `isBanned` refused. A missing pinned role refuses the request.
  - The member is force-fetched, with codes 10007 and 10013 mapped. The guild comes from `DISCORD_GUILD_ID`.
  - The claim uses SKIP LOCKED inside `withSetupLock`, and the boot catch-up takes the lock before the poller starts.
  - `studies_rw` cannot write `bot_requests`, `users` or `bot_settings`.
  - Text caps: 200 / 500 / 60 000 (`mediumtext`).
  - A run interrupted by shutdown is failed at boot.
- **Group import:**
  - The button parser is strict. The modal is shown before any I/O, and the submit is deferred privately. Banned users are refused.
  - The URL guard: https, no userinfo or port, an allowlisted host, ≤ 500 chars. Redirects only to the same host. 15 s and 2 MiB.
  - The URL is never logged or echoed. Names are escaped and clipped, and at most 100 pairs are saved.
- **Reminders:** the snowflake guard, the entry quiz date kept in memory and in the setting, unarchive before send.
- **Holdovers from 2026-10-25:**
  - M1, M2, L1, L2, L3 and I1 all held.
  - The invite permissions match the README. Only the Guilds, GuildMessages and MessageContent intents are requested, and `allowedMentions` is empty everywhere.

## Needs a live server to judge
- Whether mysql2 returns MariaDB `JSON` payloads already parsed.
- How long a web-run `/setup` really takes on a large server, against the 60 s "not responding" warning, which also fires during the boot catch-up.
- How `plan.agh.edu.pl` handles redirects and content-type in practice.
- Sending in a locked digest thread without Manage Threads.
