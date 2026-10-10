import { getSessionUser, SESSION_TTL_MS } from '@studies/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
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

export async function currentUser(): Promise<SessionUser | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  return getSessionUser(getDb(), sid);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login-info');
  return user;
}
