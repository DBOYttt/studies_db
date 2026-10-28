# Security audit: web and db (2026-10-25)

Reviewer: sql-console-security-reviewer (static reading, branch `chore/security-audits`, Next 16.4.3).

Counts: Critical 0 · High 0 · Medium 1 · Low 3 · Info 4

## Findings

### M1. The RW console can point the bot at any Discord forum (Medium, Verified)
- **Evidence:**
  - `packages/db/src/constants.ts:147-148` lists `subjects` as a content table.
  - `packages/db/src/readwrite-user.ts:84` grants unrestricted UPDATE on it.
  - Catch-up (`apps/bot/src/catchup.ts:35-55`) ingests whatever forum `discord_channel_id` points to.
  - `eventForumCheck` (`apps/bot/src/events/posts.ts:210-219`) accepts any forum that has a matching `subjects` row.
  - `forumOf` checks only that the channel is a forum, not which guild it belongs to.
- **Exploit:** a hijacked admin session (or a rogue admin) runs `UPDATE subjects SET discord_channel_id='<private forum>'`. On the next catch-up or `/resync`, that forum's threads and attachments are copied into `materials`/`topics`, where every student can read them. Event posts for that subject also go into that forum. `topics.discord_thread_id` and `tags.discord_tag_id` are writable the same way, but the bot-owner check in `threadOf` limits the damage.
- **Fix:**
  - Deny those columns to `studies_rw`, in the same way as `MATERIAL_FILE_COLUMNS`.
  - In both `forumOf` helpers, also require the channel's guild to be the configured guild.

### L1. Login CSRF and forced logout (Low, Verified)
- **Evidence:** `apps/web/app/auth/callback/route.ts:70` and `apps/web/app/auth/logout/route.ts:7` never call `isCrossOrigin`.
- **Exploit:** a cross-site auto-submitting form POSTs the attacker's own token, which signs the victim in as the attacker. A cross-site POST to `/auth/logout` clears the victim's session.
- **Fix:** reject cross-origin POSTs on both routes.

### L2. No security headers (Low, Verified)
- **Evidence:** `apps/web/next.config.ts` has no `headers()` and `poweredByHeader` is not set. Only `/auth/callback` and the file routes set their own headers.
- **Fix:** set these headers globally, and set `poweredByHeader: false`:
  - `frame-ancestors 'none'` / `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - HSTS (in production)
  - a CSP starting at `default-src 'self'`

### L3. `v_materials` shows files from soft-deleted topics (Low, Verified)
- **Evidence:** `packages/db/migrations/0001_views_fulltext.sql:9` filters only `m.deleted_at`, while `v_files` also filters the topic. `lib/http-files.ts` has the same gap. A console `UPDATE topics SET deleted_at=…` therefore leaves the topic's files listed and downloadable.
- **Fix:** join `topics` with `deleted_at IS NULL` in both places.

### Info
- **I1:** `/_next/image` is enabled and reachable without auth, but nothing uses `next/image` or `use cache`. Set `images: { unoptimized: true }`.
- **I2:** The `original` variant sends the uploader's MIME type. It is safe with `attachment` plus `nosniff`, but forcing `application/octet-stream` for HTML, SVG and JS would be more robust.
- **I3:** Sessions last a fixed 30 days with no idle timeout. The cookie is `sid` rather than `__Host-sid`, and expired `sessions`/`login_tokens` rows are never purged.
- **I4:** The RO console can read `@@version`, `@@hostname` and `@@datadir`, a minor information leak.

## Checked and found sound
- **Auth gates:** all 30 pages and every route handler call `requireUser()`/`requireAdmin()`. The exceptions are `auth/*`, `mode` and `login-info`, which are public on purpose. All 20 server actions authenticate and type-check their arguments, and restore actions require admin.
- **Bans:** `getSessionUser` filters out banned users, `setBanned` deletes their sessions, and the upload route re-checks the user.
- **Session cookie:** HttpOnly, Secure in production, SameSite=Lax.
- **Login tokens:** 256-bit, stored as sha256 hashes, valid 15 minutes and consumed atomically. GET only shows a confirmation page. `safeLoginNext`, `safeNext` and `modeTarget` close the open-redirect cases tried.
- **RO SQL pool:** `multipleStatements:false`, a statement time limit, a KILL watchdog, and the connection is destroyed after each query. Grants are SELECT on `PUBLIC_VIEWS` only, with MAX_STATEMENT_TIME and MAX_USER_CONNECTIONS limits. The table browser and CSV export allowlist identifiers.
- **RW console:**
  - The MariaDB grants are the real boundary.
  - The classifier rejects executable comments, multiple statements, INTO/OUTFILE/LOAD and SLEEP/BENCHMARK/GET_LOCK.
  - Previews roll back.
  - Tokens are HMAC-signed, single-use and bound to the user, and Origin is checked.
  - Every run or rejection is audited.
- **Views:** none expose secrets. `PUBLIC_VIEWS` matches the live views.
- **File serving:** `resolveInStorage` contains every path. Preview variants force safe MIME types, SVG gets a sandbox CSP, and nosniff is set.
- **Uploads:** names are server-generated UUIDs. Size, count, body and hourly limits are enforced, and the route checks Origin.
- **XSS:** no `dangerouslySetInnerHTML`, `safeExternalUrl` guards platform links, and pdf.js is past CVE-2024-4367.
- **CSV:** cells starting with formula characters are prefixed.
- **Secrets:** no `NEXT_PUBLIC_*` variables, `.env` is gitignored, and DB error messages are sanitised.
