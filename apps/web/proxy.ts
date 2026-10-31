import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from './lib/session-cookie';
import {
  fromLoadedPage,
  SESSION_ENDED_PATH,
  SIGN_IN_PATH,
} from './lib/session-ended';

/**
 * A top-level page load (not a fetch, RSC request or Server Action). Browsers
 * without Fetch Metadata send no Sec-Fetch-Mode; they count as navigations.
 */
function isPageNavigation(req: NextRequest): boolean {
  if (req.method !== 'GET' || req.headers.has('rsc')) return false;
  const mode = req.headers.get('sec-fetch-mode');
  return mode === null || mode === 'navigate';
}

/**
 * Cheap first line of defence: no `sid` cookie -> /login-info (with
 * `?expired=1` when the request came from an open page). It only checks
 * that the cookie exists (no DB access); the real gate is requireUser() in
 * every (app) page and route handler.
 */
export function proxy(req: NextRequest) {
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  if (sid) {
    const res = NextResponse.next();
    // Sliding session: keep the cookie as long-lived as the DB session, also
    // for cookies issued with the old 30-day max-age. Same value; an invalid
    // one is still refused by requireUser().
    if (isPageNavigation(req)) {
      res.cookies.set(SESSION_COOKIE, sid, sessionCookieOptions());
    }
    return res;
  }
  // A Server Action from a page left open after signing out: a redirect here
  // would hand the action an HTML page, which Next shows as an error. The
  // action's own requireUser() answers with a redirect the client follows.
  // Not a weaker gate: any made-up cookie value already gets this far.
  if (req.method === 'POST' && req.headers.has('next-action')) {
    return NextResponse.next();
  }
  const to = fromLoadedPage(req.headers, req.method)
    ? SESSION_ENDED_PATH
    : SIGN_IN_PATH;
  // Next relativises same-host redirect Locations from proxy responses.
  return NextResponse.redirect(new URL(to, req.url));
}

// The upload route is excluded on purpose: when the proxy runs, Next buffers
// the whole request body in memory before the route sees it. The route calls
// requireUser() itself.
export const config = {
  matcher: [
    '/((?!login-info(?:/|$)|auth/|_next/|favicon\\.ico$|icon\\.svg$|api/wydarzenia/[^/]+/pliki$|pdf\\.worker\\.[0-9A-Za-z.-]+\\.min\\.mjs$).*)',
  ],
};
