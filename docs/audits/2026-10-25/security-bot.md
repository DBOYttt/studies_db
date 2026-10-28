# Security audit: bot and worker (2026-10-25)

Reviewer: discord-bot-reviewer (static reading, branch `chore/security-audits`).

Counts: Critical 0 · High 0 · Medium 3 · Low 5 · Info 5

## Findings

### M1. A thread rename can stall the event poller (Medium, Verified)
- **Where:** `apps/bot/src/events/posts.ts:294`, `apps/bot/src/events/worker.ts` (drain loop).
- **Cause:** Discord allows about 2 thread renames per 10 minutes. When that limit is hit, `@discordjs/rest` 2.6.3 waits out `retry_after` and retries. It never throws, so the `.catch` on `setName` never runs.
- **Impact:** the poller handles one request at a time, so every event post, archive and web upload queues behind the stuck rename. Any non-banned student can trigger this by editing an event's title a few times.
- **Fix:** do one of the following:
  - fail fast on that rename (REST `rejectOnRateLimit`);
  - race `setName` against a 5 s timeout;
  - skip renames when the last one was less than 10 minutes ago.

### M2. Discord ingestion has no size or volume limit (Medium, Verified)
- **Where:** `apps/bot/src/ingest.ts:96-101`.
- **Cause:** `a.size` is never checked and the byte counter is never capped.
- **Impact:** large files (up to 500 MiB each with Nitro, 10 per message) can fill the shared `STORAGE_DIR` and queue heavy `soffice` jobs.
- **Fix:**
  - refuse attachments over a limit;
  - abort the hashing stream once the counted bytes pass it;
  - add a per-user hourly quota.

### M3. `soffice` and `pdftotext` are not sandboxed (Medium, Suspected)
- **Where:** `apps/worker/src/exec.ts:12`, `apps/worker/Containerfile`, `compose.yaml`.
- **Cause:**
  - `spawn` passes on the whole environment, including `DATABASE_URL`.
  - The worker image has no `USER`, so it runs as root.
  - The worker service has no memory or pids limit and full network access.
- **Impact:** a hostile document could read the environment through a known LibreOffice bug (CVE-2024-12425/12426 class). A zip bomb could exhaust memory.
- **Fix:**
  - run the tools with a minimal environment (`PATH`, `HOME=<tmp>`, `LANG`);
  - add `USER node` to the image;
  - set `mem_limit` and `pids_limit` in compose, or `prlimit` on the tools;
  - run conversions without network.

### L1. A banned admin keeps every Discord admin power (Low, Verified)
- **Where:** `apps/bot/src/commands/router.ts:192-203` and `apps/bot/src/ui/admin.ts:707-713` check the role but not the ban. `ui/admin.ts:494` only stops a user from banning themselves.
- **Impact:** a banned user who still holds the admin role can `/unban` themselves and get web access back.
- **Fix:** refuse banned users on the admin paths, or at least block self-unban.

### L2. User text can put links in the bot's own messages (Low, Verified)
- **Cause:** `escapeMarkdown` leaves masked links (`[text](url)`) and headings as they are by default.
- **Where:** event posts (`events/posts.ts:101-104, 131-139`), the digest (`reminders.ts:97-127`) and `/search`, whose reply is public and repeats the query (`commands/student.ts:62`, `commands/router.ts:432`).
- **Impact:** for example, `[Notes](https://phish)` appears as a link posted by the bot.
- **Fix:** one escape helper that also handles masked links, headings and lists; make `/search` replies private.

### L3. `/setup` builds file paths without the storage check (Low, Verified)
- **Where:** `apps/bot/src/setup/apply.ts:169` uses `join(storageDir, f.storagePath)`.
- **Impact:** not exploitable today, because `studies_rw` cannot write `storage_path`. If it ever could, a crafted path could make the bot post a local file.
- **Fix:** use `resolveInStorage`.

### L4. The iCal parser can be made to run away (Low, Verified)
- **Where:** `packages/db/src/unitime/ics.ts:255-270`, and the `redirect: 'follow'` option in `apps/worker/src/plan-sync.ts:44`.
- **Impact:** a rule with UNTIL far in the future expands to millions of occurrences. Redirects can send the fetch to internal or plain-HTTP hosts. The feed URL comes only from env, so this needs a hostile or compromised feed.
- **Fix:**
  - cap UNTIL at the start date plus 1 year, and occurrences at about 500;
  - do not follow redirects, or only to the same host.

### L5. The admin role is created at the bottom of the role list (Low, Verified)
- **Where:** `apps/bot/src/setup/discord.ts:275`.
- **Impact:** anyone with Manage Roles can give themselves the role, and with it bot admin, web admin and the read-write SQL console.
- **Fix:** have `/setup` warn about this, and document it.

### Info
- **I1:** Nothing checks that an interaction comes from `DISCORD_GUILD_ID`. Commands are registered only in that server, but a guild check would be extra protection.
- **I2:** Banned users are still ingested from Discord and can use `/search`. This is by design: a ban only blocks the website.
- **I3:** `jobs.last_error` keeps up to 2000 characters of `soffice` error output. It contains file paths only.
- **I4:** If the worker is killed with SIGKILL, the detached `soffice` processes and `/tmp/soffice-*` folders are left behind.
- **I5:** Manage Server is enough to run `/setup`, which gives the caller the admin role. This is by design.

## Checked and found sound
- **Admin checks:** every admin command, button, select and modal re-checks the role id stored in `bot_settings`. With no stored id, nobody is admin. Admin writes are audited.
- **Banned users** are refused in panel actions, events, entry quizzes, `/link` and the login button.
- **No pings:** `allowedMentions: { parse: [] }` is set on the client and on each payload.
- **Tampered `custom_id`s:** strict parsers, clamped pages, and server-side re-checks of class, group and topic ids.
- **Event threads:** the bot edits only threads it owns.
- **Web uploads:** paths must match `uploads/<name>` and pass `resolveInStorage` and `lstat`. Storage paths come from the sha256 with an extension whitelist.
- **Worker processes:** no shell and absolute paths, a fixed input file name, a profile per run, SIGKILL of the whole process group on timeout, output caps, temp cleanup, jobs fenced by attempt count.
- **UniTime fetch:** URL from env only, 30 s timeout, 5 MiB cap, content-type check, URL removed from error messages.
- **Secrets:** tokens are not logged, the login DM has no link preview, and `.containerignore` excludes `.env`.

## Needs a live server to confirm
- Whether Discord rejects forged `custom_id`s on its side.
- The real wait time on the rename limit.
- The LibreOffice version in the built image and its link-update defaults.
- Whether the bot is set to "Public Bot".
- Upload limits for the server's boost tier.
