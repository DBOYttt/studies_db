import { getSessionUser } from '@studies/db';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from './db';
import { SESSION_COOKIE } from './session-cookie';
import {
  fromLoadedPage,
  SESSION_ENDED_PATH,
  SIGN_IN_PATH,
} from './session-ended';

export {
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE_S,
  sessionCookieOptions,
} from './session-cookie';

export interface SessionUser {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
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
  if (!user) redirect(await signInPath());
  return user;
}

/**
 * `/login-info?expired=1` ("Your session has ended") when a cookie was sent
 * but matches no session, or when the request came from an open page (a
 * Server Action or RSC fetch); the plain `/login-info` otherwise.
 */
async function signInPath(): Promise<string> {
  if ((await cookies()).get(SESSION_COOKIE)?.value) return SESSION_ENDED_PATH;
  return fromLoadedPage(await headers()) ? SESSION_ENDED_PATH : SIGN_IN_PATH;
}

/**
 * Gate for every /admin page and /api/admin/* route handler: 404 (not a
 * redirect) for anonymous users and non-admins, so the panel's existence is
 * not revealed. The flag is read from the DB on every request.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user?.isAdmin) notFound();
  return user;
}
