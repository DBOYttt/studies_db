import { getSessionUser, SESSION_TTL_MS } from '@studies/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from './db';

export const SESSION_COOKIE = 'sid';

export interface SessionUser {
  id: number;
  displayName: string;
  avatarUrl: string | null;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  };
}

/**
 * The signed-in user, or null. Memoised per request (React `cache`), so the
 * (app) layout and page share one session lookup.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  return getSessionUser(getDb(), sid);
});

/**
 * Every page under app/(app)/ and every route handler must call this itself:
 * the layout alone is not a gate (RSC requests can skip rendering it).
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login-info');
  return user;
}
