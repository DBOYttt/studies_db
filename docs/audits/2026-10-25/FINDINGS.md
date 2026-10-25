# Audit findings and fix plan (2026-10-25)

Sources:
- [security-web.md](security-web.md)
- [security-bot.md](security-bot.md)
- [security-runtime.md](security-runtime.md)
- [performance.md](performance.md)
- [UX SUMMARY](../../qa/2026-10-25-ux/SUMMARY.md)

Every finding below was verified before it was planned, either by a reviewer's file:line trace or by a runtime
reproduction, and the controller spot-checked the security ones. Findings that were not verified are listed under
"Not fixed" with the reason.

Execution: one fix task per group, run in order on branch `chore/security-audits`. Each task is test-first and
gets its own review. A whole-branch review and the full gate run at the end: unit, e2e, typecheck, lint, check:lang
and `pnpm audit`.

## Rulings (made without asking; cost if wrong in brackets)

- R1 **CSP:**
  - `script-src 'self' 'unsafe-inline'`, with no nonce, because Next's inline bootstrap scripts need it. `'unsafe-eval'` is allowed in dev only.
  - `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `img-src 'self' data: blob:`, `worker-src 'self' blob:`.
  - [A weaker XSS backstop than a nonce CSP; it can be tightened later.]
- R2 **HSTS:** sent only in production (`max-age=31536000`), because the dev and e2e servers run on plain HTTP. [None.]
- R3 **Discord attachment limit:** 50 MiB per file and 500 MiB per user per hour. Larger files are skipped with a log line, not stored. [A huge legitimate file would not be mirrored.]
- R4 **Thread rename:** the bot skips renaming an event post when it renamed that post less than 10 minutes ago (kept in memory). The next upsert renames it. [The title can lag for up to 10 minutes.]
- R5 **`/search` on Discord:** stays public. User text is escaped, including masked links. [None.]
- R6 **Banned admins:** they are refused on every Discord admin path. [A banned admin needs another admin to unban them.]
- R7 **Worker container:** runs as a non-root user with `mem_limit` and `pids_limit` in compose. `soffice`/`pdftotext` get a minimal environment. Network isolation of conversions is deferred: it needs a separate container. [A residual risk, documented.]
- R8 **UX ideas** marked "Deferred (product decision)" in the UX summary are not built in this round.
- R9 **Search folding (D45):** done with a diacritic-folded query and a migration only if it fits a custom migration (never `drizzle-kit push`). Otherwise it is deferred. [None.]
- R10 **QA sandbox reloads:** `qa-serve.mjs` sets a larger on-demand entries buffer, via env read in `next.config.ts`, in dev only. [None.]

## Fix groups

| Task | Findings | Summary |
|---|---|---|
| T1 Web security | web M1 (column grants), L1, L2, L3, I1, I2, I3 (purge only); runtime F1, F2 | Deny `studies_rw` the Discord link columns (`subjects.discord_channel_id`, `topics.discord_thread_id`, `tags.discord_tag_id`). Origin check on `/auth/callback` and `/auth/logout`. Global security headers (R1, R2), `poweredByHeader: false`, `images.unoptimized`. Topic soft-delete filter in `v_materials` (custom migration) and `lib/http-files.ts`. `application/octet-stream` for risky original MIME types. The worker purges expired sessions and login tokens daily. |
| T2 Bot and worker security | bot M1, M2, M3, L1, L2, L3, L4, I1; web M1 (bot side) | Rename skip (R4). Attachment limits (R3). Minimal env for child processes, non-root container and compose limits (R7). Banned admins refused (R6). Escape helper for masked links, headings and lists. `resolveInStorage` in `/setup`. iCal UNTIL and occurrence caps, no cross-host redirects. Guild check on interactions. `forumOf` requires the configured guild. L5 is documented in `docs/deploy.md`. |
| T3 Performance | perf H1, M1–M5, L1, L4, L5, L6, L7 | `next/dynamic` for CodeMirror, React Flow and dagre per tab. Index `bot_requests(kind, target, status, id)` and audit indexes. Admin audit query as a LEFT JOIN. Drop the unused count. 60 s cache for nav and view counts and the subject-card aggregates. File routes select only the columns they use, add a sha256 ETag, and send immutable caching for originals. Prune `bot_requests`/`jobs` older than 30 days. Index-friendly `finalizeStuckMaterials`. Cache headers for the pdf.js worker. Fewer duplicate event-page queries. |
| T4 Timetable bars and panel | UX D1, D2, D37 (bars), D3, D4, D7, D22, D25, D10 | Bars fit by height and width, merge into one bar when they don't fit, and clip inside the block. The "(today)" overflow fix. The panel slides over the grid instead of squeezing it. Undo after "Not this week". Panel heading, aria and copy. Legend entries for Test and Entry quiz. |
| T5 Accessibility | UX D16–D21, D23, D24 | Skip link. `role="status"` success messages. Required-field markers and `aria-describedby`. Day names on blocks and day groups. Focus moves into the preview. Focus returns to the trigger when tabbing out of the popover. `aria-disabled` submit. `lang="pl"` on content. |
| T6 Copy, defaults and flows | UX D5, D6, D8, D9, D11, D12, D29, D31–D33, D36, D44, D47, D50 | My groups links stay in simple mode and the copy matches the filter. The default week skips a finished week. Start shows upcoming events first. A "Showing all groups" prompt. "Add test" heading and a prefilled title. Session picker placed first. Class row on the event page. Terminology fixes, plus "Akcje" added to the language check. Quiz conflict message. Discord status line only on failure. `mark` padding. |
| T7 Mobile, icons, admin and small fixes | UX D13, D15, D14 (labels and counts), D27, D28, D30, D34, D35 (Structure), D41, D43, D45 (R9), D49; R10 | Phosphor icons for event kinds. Audit table readability. Mobile wrapping, crumbs and PDF toolbar. Mode switch label. `scroll-margin`. SQL editor min-height. Structure page fixes. Delete confirmation on its own row. Favicon. Search folding and snippets in simple mode. QA buffer. |

## Not fixed

- **UX not reproduced or wrong:** D38 (dev environment), D39 (already opens a new tab), D40 (behaves as designed), D42 (not reproduced).
- **UX by design:** D46 (glossary: kolokwium is shown as "Test") and D52 (weekends appear only when they have sessions).
- **UX product ideas** under "Deferred (product decision)" in the UX summary (R8).
- **Security info:**
  - web I4: the read console exposing `@@version` is accepted, since it is admin-reachable read-only metadata.
  - bot I2: banned users are still ingested from Discord, by design.
  - bot I3: `last_error` holds paths only.
  - bot I4: a SIGKILL leaves `soffice` processes behind. This is operational and noted in the deploy docs.
  - bot I5: Manage Server is allowed to run `/setup`, by design.
- **Security still to verify:** the runtime F4 dev stack frames. They appeared on `next dev`; the final gate checks a production build (`next start`) for the same request.
- **Performance:** L2, L3, L8 and L9 are acceptable at this data size and are noted for later.
