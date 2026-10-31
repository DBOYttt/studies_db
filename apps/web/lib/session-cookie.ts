/**
 * The `sid` cookie, import-free so proxy.ts can use it. The DB expiry
 * (sliding, `SESSION_TTL_MS` idle in packages/db) decides whether a session is
 * valid; the cookie only has to outlive it, so it gets Chrome's 400-day cap
 * and the proxy re-sets it on page navigations.
 */
export const SESSION_COOKIE = 'sid';
export const SESSION_COOKIE_MAX_AGE_S = 400 * 24 * 3600;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_COOKIE_MAX_AGE_S,
    path: '/',
  };
}
