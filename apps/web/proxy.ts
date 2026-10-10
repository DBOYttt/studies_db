import { type NextRequest, NextResponse } from 'next/server';

/**
 * Cheap first line of defence: no `sid` cookie -> /login-info. It only checks
 * that the cookie exists (no DB access); the real gate is requireUser() in
 * every (app) page and route handler.
 */
export function proxy(req: NextRequest) {
  if (req.cookies.get('sid')?.value) return NextResponse.next();
  // Next relativises same-host redirect Locations from proxy responses.
  return NextResponse.redirect(new URL('/login-info', req.url));
}

export const config = {
  matcher: [
    '/((?!login-info(?:/|$)|auth/|_next/|favicon\\.ico$|pdf\\.worker\\.min\\.mjs$).*)',
  ],
};
