# Audits 2026-10-25: security, performance, user experience

Requested by the user on 2026-10-25: update Next.js, fix the known vulnerabilities, then run a safety, a performance
and a user-experience audit, plan the fixes and carry them out without asking for permission, verifying each
assumption first.

Branch: `chore/security-audits` (from `feat/event-bars`, which carries the timetable footer bars).

## 0. Dependency vulnerabilities (done before the audits)

`pnpm audit` on 2026-10-25 reported 6 advisories, all confirmed against the installed versions:

| Package | Path | Severity | Fix |
|---|---|---|---|
| next 16.4.0 | apps/web | 2 critical (RCE in image optimisation with SVG; RCE in `use cache` typed arrays), 1 high (Server Actions DoS) | `next` ^16.4.3 |
| undici 6.27 | bot → discord.js | 1 high, 1 moderate (DoS) | override `undici` ≥ 6.29.1 |
| esbuild ≤ 0.24.2 | db → drizzle-kit → @esbuild-kit | moderate (dev server request leak; dev-only) | override `esbuild` ^0.25.0 |

After the change: `pnpm audit` reports no known vulnerabilities; `drizzle-kit check` and `generate` still work; the four
typechecks and `next build` pass; unit and e2e suites run as the gate.

## 1. Safety audit

Read-only reviewers, each writing a report under `docs/audits/2026-10-25/`:
- `security-web.md`: `sql-console-security-reviewer` over `apps/web` and `packages/db`. Covers auth on every
  page, route handler and server action; RO/RW pool separation; file serving and uploads (path containment, size,
  type, content-disposition); the admin console guards; CSRF and origin checks on server actions; security headers
  (CSP, frame-ancestors, nosniff, referrer policy) and cookies; secrets in logs; whether `next/image` or `use cache`
  is used at all (the patched RCE surfaces).
- `security-bot.md`: `discord-bot-reviewer` for the bot and worker. Covers admin role re-checks, `custom_id`
  tampering, banned users, mention injection (`allowedMentions`), file ingestion limits, `soffice`/`pdftotext`
  invocation (argument injection, timeouts, resource limits), the UniTime fetch (SSRF, size, timeouts) and token
  handling.
- `security-runtime.md`: `qa-security-auditor` against the QA sandbox `:3200` only, low-volume and non-destructive.

## 2. Performance audit

One agent writes `performance.md`, working against a production build served from the QA sandbox database (port
3300, `NEXT_DIST_DIR=.next-perf`, env as in `apps/web/scripts/qa-serve.mjs`). It never touches `:3000`, `:3100`, or
the `studies` / `studies_test` databases. It covers:
- route bundle sizes from `next build` and the heaviest client components;
- server response time (TTFB, p50/p95 over 20 requests) for the main pages in both modes;
- `EXPLAIN` for the hot queries (week plan, search, file lists, subject page, admin audit), plus missing indexes;
- N+1 patterns and per-request work in `lib/*-queries.ts`;
- worker and bot polling cost (query rate per minute when idle) and the `bot_requests` locking read with no index
  (parked finding);
- Lighthouse-style metrics (LCP, CLS, TBT) via Playwright performance timing if Lighthouse isn't available.

## 3. User-experience audit

The QA personas (`/qa-run`) against the sandbox `:3200`: `qa-curator`, `qa-novice`, `qa-mobile`, `qa-a11y` and
`qa-student`, run in parallel. The runs and reports go in `docs/qa/2026-10-25-ux/` with a `SUMMARY.md`. The round 1b
personas were never completed (usage limit), so this run also covers the English copy, and it is the first QA pass
over the timetable assessments (Test bars, entry quizzes, exams).

## 4. Fix plan and execution

All findings are consolidated into `docs/audits/2026-10-25/FINDINGS.md`. Each finding is verified against the code
before it gets a fix: a reproduction, a failing test, or a file and line that shows it. Unverified findings are listed
as rejected, with the reason. Fixes are grouped into tasks (security, performance, UX) and carried out TDD with a
review per group; afterwards the full suites, lint, check:lang, typecheck, e2e and `pnpm audit` are re-run.
Rulings are made without asking and recorded in `FINDINGS.md`. Destructive or outward-facing actions are out of
scope unless the fix needs them: no Discord changes, no production deploy, and no edits to the dev DB.
