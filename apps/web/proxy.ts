import { type NextRequest, NextResponse } from 'next/server';
import {
  fromLoadedPage,
  SESSION_ENDED_PATH,
  SIGN_IN_PATH,
} from './lib/session-ended';

/**
 * Cheap first line of defence: no `sid` cookie -> /login-info (with
 * `?expired=1` when the request came from an open page). It only checks
 * that the cookie exists (no DB access); the real gate is requireUser() in
 * every (app) page and route handler.
 */
export function proxy(req: NextRequest) {
  if (req.cookies.get('sid')?.value) return NextResponse.next();
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
