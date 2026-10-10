import { consumeLoginToken } from '@studies/db';
import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { seeOther } from '@/lib/http';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const result = token ? await consumeLoginToken(getDb(), token) : null;
  if (!result) return seeOther('/login-info?error=expired');
  const res = seeOther('/');
  res.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return res;
}
