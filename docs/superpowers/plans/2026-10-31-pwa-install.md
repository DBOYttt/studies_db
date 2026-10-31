# Installable app (PWA) and sliding sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Install app" button for Android and iOS, a way to sign the installed app in, and sessions that stay alive while used.

**Architecture:** A Next `app/manifest.ts` plus committed PNG icons makes the site installable (no service worker). A client button uses `beforeinstallprompt` on Chromium and an instructions dialog on iOS; pure detection/parsing lives in `lib/install-app.ts`. Sessions slide: `getSessionUser` renews the DB expiry once a day, the cookie lives 400 days, and the proxy re-sets an existing `sid` on navigations.

**Tech Stack:** Next 16 App Router, React 19, Tailwind 4, Drizzle/MariaDB, vitest, Playwright, sharp (icon generation, one-off).

**Spec:** `docs/superpowers/specs/2026-10-31-pwa-install-design.md`

## Global Constraints

- UI copy English; no Polish diacritics in UI source (`pnpm check:lang`).
- Theme colour `#235a81`; manifest name/short_name "Studies DB"; `start_url`/`scope` "/"; `display` "standalone".
- `SESSION_TTL_MS` stays 30 days (idle window); renewal at most once per 24 h; cookie `maxAge` 400 days (`SESSION_COOKIE_MAX_AGE_S = 400 * 24 * 3600`).
- The proxy reads no DB and never gates.
- No service worker unless the Chromium check in Task 4 proves it is needed.
- Commit as DBOYttt, `git -c commit.gpgsign=false`, no AI attribution.

## Review Focus

- A pasted link from another origin, or `/auth/callback` with `next=//evil` → rejected client-side, and the server's `safeLoginNext` still guards (Task 3 tests).
- A banned user's session must not be renewed and stays refused (Task 1 test).
- A fetch/RSC/Server Action request must not get a `Set-Cookie` from the proxy (Task 1 proxy test), so caching and action responses are unaffected.
- The manifest/icons must load without a cookie, otherwise Chrome never offers install (Task 2 proxy + e2e test).
- The button must render nothing on the server (no hydration mismatch) and nothing in standalone mode (Task 3 unit, Task 4 e2e).

---

### Task 1: Sliding sessions

**Files:**
- Modify: `packages/db/src/auth.ts` (`getSessionUser`), `apps/web/lib/session.ts` (`sessionCookieOptions`, new `SESSION_COOKIE_MAX_AGE_S`), `apps/web/proxy.ts`
- Test: `packages/db/test/auth.test.ts`, `apps/web/test/session.test.ts`, `apps/web/test/proxy.test.ts`

**Interfaces:**
- Produces: `SESSION_RENEW_AFTER_MS = 24 * 3600_000` exported from `auth.ts`; `SESSION_COOKIE_MAX_AGE_S` from `lib/session.ts`.

- [ ] Step 1: Tests (db). Replace "session expires after 30 days" with: unused session valid at `TTL−1`, refused at `TTL+1`. Add "renews when used": use at `now+2d` → row `expiresAt == now+2d+TTL`; use again at `now+2d+1h` → unchanged; refused at `now+2d+TTL+1` only if not used after. Add "banned session is not renewed": ban, call at `now+2d`, expiry unchanged.
- [ ] Step 2: Tests (web). `sessionCookieOptions().maxAge === 400*24*3600`. Proxy: GET `/sql` with `sid=abc` and `sec-fetch-mode: navigate` → `set-cookie` contains `sid=abc` and `Max-Age=34560000`, `HttpOnly`, `SameSite=lax`; same with `rsc: 1` header, or `sec-fetch-mode: cors`, or a POST → no `set-cookie`.
- [ ] Step 3: Run, see failures.
- [ ] Step 4: Implement. `getSessionUser` selects `sessions.expiresAt`; if `expiresAt < now + TTL − RENEW_AFTER` run `UPDATE sessions SET expires_at = now+TTL WHERE token_hash = ? AND expires_at > now` inside try/catch (`console.error('session renew failed', code)` only). Return shape unchanged. Proxy: when `sid` exists, `req.method === 'GET'`, no `rsc` header, and `sec-fetch-mode` is `navigate` or absent → `res.cookies.set('sid', value, sessionCookieOptions())` (import from a new import-free `lib/session-cookie.ts` holding `SESSION_COOKIE`, `SESSION_COOKIE_MAX_AGE_S`, `sessionCookieOptions`, re-exported by `lib/session.ts`, since the proxy must not import `next/headers`/DB code).
- [ ] Step 5: Tests pass; commit `feat: sliding sessions (renew daily, 400-day cookie)`.

### Task 2: Manifest, icons, metadata

**Files:**
- Create: `apps/web/app/manifest.ts`, `apps/web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apps/web/app/apple-icon.png`, `scripts/make-app-icons.mjs` (sharp, from `app/icon.svg`; maskable = artwork at 80 % on a full `#235a81` square; apple = 180 px, opaque)
- Modify: `apps/web/app/layout.tsx` (`appleWebApp`, `viewport.themeColor`), `apps/web/proxy.ts` matcher
- Test: `apps/web/test/manifest.test.ts`, `apps/web/test/proxy.test.ts`

- [ ] Step 1: Tests. `manifest()` equals the spec object (name, short_name, description, start_url, scope, display, colours, three icons with sizes/purpose). Proxy matcher skips `/manifest.webmanifest`, `/icons/icon-192.png`, `/apple-icon.png`, `/apple-icon.png?abc`; still matches `/iconsx` and `/icons` (no trailing file).
- [ ] Step 2: Fail, implement (matcher adds `manifest\.webmanifest$|icons/|apple-icon\.png$`), run the script once, pass.
- [ ] Step 3: Commit `feat(web): web app manifest and home-screen icons`.

### Task 3: Install detection and sign-in link parsing (pure)

**Files:**
- Create: `apps/web/lib/install-app.ts`
- Test: `apps/web/test/install-app.test.ts`

**Interfaces:**
- Produces: `type InstallEnv = { ua: string; maxTouchPoints: number; standalone: boolean; hasPrompt: boolean }`; `installMode(env): 'hidden' | 'prompt' | 'ios'`; `isIosSafari(ua): boolean`; `parseSignInLink(input: string, origin: string): string | null`; `SIGN_IN_LINK_ERROR = 'This is not a Studies DB sign-in link.'`; `MAX_TOKEN_LEN = 512` (moved here; `app/auth/callback/route.ts` imports it).

- [ ] Step 1: Tests per spec §5: Android Chrome ± prompt, iPhone Safari → ios, iPhone CriOS → ios with `isIosSafari` false, iPad desktop UA with 5 touch points → ios, Mac Safari with 0 touch points → hidden, standalone (any) → hidden, desktop Firefox → hidden. `parseSignInLink`: bot link → `/auth/callback?token=T`; with `&next=%2Fadmin` → keeps `&next=%2Fadmin`; bare token (with surrounding spaces/`<>` from Discord) → path; other origin, `/auth/callbackx`, `next=/sql`, token with `.`/`/`, 513 chars, empty → null.
- [ ] Step 2: Fail, implement, pass. Commit `feat(web): install-mode detection and sign-in link parser`.

### Task 4: Button, iOS dialog, paste field, placement

**Files:**
- Create: `apps/web/components/InstallAppButton.tsx`, `apps/web/components/PasteSignInLink.tsx`, `apps/web/e2e/pwa.spec.ts`
- Modify: `components/simple/SimpleShell.tsx` (before `SemesterSwitcher`), `app/(app)/layout.tsx` `topbarEnd` (before `SemesterSwitcher`), `app/login-info/page.tsx` (button + paste field), `e2e/global-setup.ts` (`E2E_TOKEN_PWA`)

- [ ] Step 1: e2e tests: manifest 200 `application/manifest+json` and icon 200 `image/png` without cookies; iPhone UA context → "Install app" visible on `/login-info`, click opens dialog "Install Studies DB" with the Safari steps, Esc closes; CriOS UA → dialog says "Open this page in Safari"; desktop Chromium without prompt → button absent; `emulateMedia`-like standalone via `addInitScript` overriding `matchMedia('(display-mode: standalone)')` → button absent and paste field present; pasting `http://localhost:3100/auth/callback?token=$E2E_TOKEN_PWA`, Sign in, confirm → lands signed in on `/`; pasting `https://evil.example/auth/callback?token=x` → field error.
- [ ] Step 2: Implement. Button: `useEffect` mounts, listens `beforeinstallprompt` (preventDefault, keep) and `appinstalled`; renders null until mounted or when mode is hidden; classes like ModeSwitch segments (`text-[12px] font-medium … max-sm:min-h-11`), Phosphor `DownloadSimple` icon, label "Install app" (`max-lg:sr-only` text in the top bars, visible on `/login-info`). Dialog: native `<dialog>` with `showModal()`, heading, ordered steps, Close button. Paste field: shown only when standalone; label "Paste your sign-in link", `fieldAria` error with `SIGN_IN_LINK_ERROR`, on success `window.location.assign(path)`. Hint text above: "In the installed app, sign in by pasting the link the bot sent you."
- [ ] Step 3: Manual check with Playwright Chromium (Android UA, `--enable-features` not needed): on `/login-info` over `localhost`, verify `beforeinstallprompt` fires without a service worker (log via `addInitScript`). If it does not, add `public/sw.js` (fetch handler `e.respondWith(fetch(e.request))`), register it in the button, exclude `sw.js` from the proxy, note the ruling.
- [ ] Step 4: Unit/e2e/typecheck/lint/lang pass. Invoke a taste skill (minimalist-ui) for the button + dialog styling review. Commit `feat(web): Install app button, iOS guide and in-app sign-in`.

### Task 5: Bot DM line and docs

**Files:**
- Modify: `apps/bot/src/commands/student.ts` (`sendLoginDm` content), its test; `CLAUDE.md` (Auth bullet: sliding sessions, PWA, paste sign-in); `docs/glossary.md` ("Install app", "installed app").

- [ ] Step 1: Test the DM content includes `Using the installed app? Copy this link and paste it on the app's sign-in screen.` on a second line; implement; pass.
- [ ] Step 2: Docs; commit `feat(bot): mention the installed app in the sign-in DM; docs`.

### Final

- [ ] Full gate (unit db/bot/web/worker, 4 typechecks, lint, lang, e2e).
- [ ] Reviews: `sql-console-security-reviewer` (Tasks 1–4), `discord-bot-reviewer` (Task 5), final whole-branch reviewer on the most capable model; fix findings.
- [ ] Stop with a finished, reviewed branch; merge/push only when the user says so.
