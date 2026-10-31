# Installable app (PWA) and sliding sessions — design

Date: 2026-10-31. Status: approved in chat, awaiting written-spec review.

## Goal

Students can put Studies DB on their phone's home screen (Android and iOS) from a dedicated
**Install app** button, and once signed in they stay signed in as long as they keep using it.

Decisions taken with the user:

- Button placement: the top bar of both shells (simple and advanced) and the sign-in page `/login-info`.
- Sessions: sliding for everyone (browser and installed app alike), 30-day idle window.

## 1. Installability

- `apps/web/app/manifest.ts` (Next `MetadataRoute.Manifest`, served at `/manifest.webmanifest`):
  `name` "Studies DB", `short_name` "Studies DB", `description` "Materials, timetable and events of your year.",
  `start_url` "/", `scope` "/", `display` "standalone", `background_color` "#ffffff",
  `theme_color` "#235a81", `icons`: `/icons/icon-192.png` (192, any), `/icons/icon-512.png` (512, any),
  `/icons/icon-maskable-512.png` (512, maskable).
- Icons are PNGs generated once from `app/icon.svg` and committed under `apps/web/public/icons/`. The maskable
  icon keeps the artwork inside the central 80 % safe zone on a full `#235a81` background. `app/apple-icon.png`
  (180×180, no transparency, no rounded corners — iOS rounds it) is picked up by Next as the
  `apple-touch-icon`.
- Root `app/layout.tsx` metadata: `appleWebApp: { capable: true, title: 'Studies DB', statusBarStyle: 'default' }`,
  and `export const viewport = { themeColor: '#235a81' }`.
- `proxy.ts` matcher excludes `manifest.webmanifest`, `icons/` and `apple-icon.png` so they load without a
  session (the browser fetches the manifest without credentials, and the installed app opens on
  `/login-info` while signed out).
- No service worker: no page or file is ever cached on the device. Current Chromium on Android offers install
  with a valid manifest alone. If the e2e/manual check shows Chrome does not fire `beforeinstallprompt`
  without one, add `public/sw.js` with a fetch handler that only calls `fetch(event.request)` (no Cache API),
  registered from the button component; the CSP already allows `worker-src 'self'`.

## 2. Install app button

`apps/web/components/InstallAppButton.tsx` (client component), placed in `SimpleShell`, the advanced shell's
top bar (`ShellFrame`) and on `/login-info`. Style and size match the neighbouring top-bar tool buttons,
with `max-sm:min-h-11` like the other top-bar touch targets. Label "Install app".

Pure detection lives in `apps/web/lib/install-app.ts` so it is unit-tested:

- `installMode(env) → 'hidden' | 'prompt' | 'ios'`, where `env` carries the user agent, whether the page runs
  standalone (`matchMedia('(display-mode: standalone)')` or `navigator.standalone`), and whether a
  `beforeinstallprompt` event was captured.
  - standalone → `hidden` (already installed and running as the app);
  - captured prompt → `prompt`;
  - iOS/iPadOS (iPhone/iPad/iPod UA, or a Mac UA with touch points > 1) → `ios`;
  - anything else → `hidden` (e.g. desktop Firefox, or Chrome before the event fires).
- `prompt`: clicking calls the saved event's `prompt()`; on `appinstalled` or an `accepted` outcome the button
  hides. After any outcome the used event is dropped (it works once), so the button hides until Chromium offers
  install again with a new event.
- `ios`: clicking opens a small dialog (native `<dialog>`, focus trapped by the browser, closes on Esc and a
  Close button) titled "Install Studies DB":
  - in Safari: "1. Tap the Share button. 2. Choose Add to Home Screen. 3. Tap Add."
  - in another iOS browser (UA contains `CriOS`, `FxiOS`, `EdgiOS` or similar): "Open this page in Safari,
    then tap Share and Add to Home Screen."
- The button renders nothing until mounted (no hydration mismatch, no layout jump on desktop where it stays
  hidden).

## 3. Signing in inside the installed app

On iOS a home-screen app has its own cookie storage, so the Discord `/link` URL (opened in Safari) cannot
sign the app in.

- `/login-info` gets a client component `PasteSignInLink` shown only when the page runs standalone. A text
  field "Paste your sign-in link" and a "Sign in" button.
- `parseSignInLink(input, origin) → string | null` in `lib/install-app.ts` returns the in-app path
  `/auth/callback?token=<token>[&next=/admin]` or null. It accepts a full URL whose origin equals the current
  origin and whose path is exactly `/auth/callback`, or a bare token; the token must be 1–`MAX_TOKEN_LEN`
  characters from the base64url alphabet; `next` is kept only when it is `/admin` (the only value the bot
  sends). Anything else shows "This is not a Studies DB sign-in link." under the field (field error pattern).
- On success the page navigates to that path inside the app, so the existing confirmation page (GET never
  consumes the token) and its POST set the `sid` cookie in the app's own storage.
- The bot's DM (`sendLoginDm`) gets one more line: "Using the installed app? Copy this link and paste it on
  the app's sign-in screen." The link stays wrapped in `<…>` with `SuppressEmbeds`.

## 4. Sliding sessions

- `SESSION_TTL_MS` stays 30 days, now meaning the idle window.
- `getSessionUser` (`packages/db/src/auth.ts`) also selects the session's `expiresAt`; when it is earlier than
  `now + SESSION_TTL_MS − 24 h` (not renewed in the last day) it runs one
  `UPDATE sessions SET expires_at = now + SESSION_TTL_MS WHERE token_hash = ? AND expires_at > now`. A failed
  renewal is logged without the token and does not fail the request. Expired, banned and unknown sessions are
  refused exactly as before; sign-out still deletes the row.
- `sessionCookieOptions().maxAge` becomes 400 days (`SESSION_COOKIE_MAX_AGE_S`, the Chrome cap). The DB expiry
  is the authority; the cookie only has to outlive it.
- No absolute lifetime (decided 2026-10-31, the user asked to stay signed in at all times): a session used at least
  once every 30 days never ends; sign-out (this device), a ban (all of the user's sessions) or 30 idle days end it.
  A copied `sid` therefore lives as long as it is used. Possible later additions: "Sign out everywhere" (delete all
  of the user's sessions) or an absolute cap on `sessions.created_at`.
- Cookies issued before this change carry a 30-day `maxAge`. `proxy.ts` re-sets an existing `sid` cookie with
  the same value and the new options on top-level page navigations (`GET` with `Sec-Fetch-Mode: navigate`, or
  no such header). The proxy still reads no DB and still never gates: an invalid `sid` is refused by
  `requireUser()` as before.

## 5. Testing

- Unit (db): renewal — a session renewed less than a day ago is not updated; one older than a day is moved to
  `now + 30 d`; an expired one is not renewed and stays refused; a banned user's session is refused and not
  renewed.
- Unit (web): `installMode` for Android Chrome with/without a captured event, iOS Safari, iOS Chrome, iPadOS
  desktop UA, standalone, desktop Firefox; `parseSignInLink` accepts the bot's link (with and without
  `next=/admin`) and a bare token, rejects another origin, another path, `next` other than `/admin`, bad
  characters, an over-long token and empty input; the manifest object; `sessionCookieOptions().maxAge`.
- Proxy test: the PWA assets pass without a cookie; a navigation with `sid` gets a `Set-Cookie` for `sid` with
  the 400-day max-age; a fetch/RSC request does not.
- E2e: `/manifest.webmanifest` and the icons return 200 without a session with the right content type; with an
  emulated iPhone UA the button opens the dialog and Esc closes it; with `display-mode: standalone` emulated the
  button is hidden and `/login-info` shows the paste field, and pasting a fresh login link signs the user in.
- Bot test: the DM text contains the new line.
- Reviews: `sql-console-security-reviewer` (auth/session and proxy), `discord-bot-reviewer` (DM text).

## Out of scope

Offline pages, push notifications, a Discord panel install button, app-store packaging.
