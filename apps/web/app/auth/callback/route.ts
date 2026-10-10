import { consumeLoginToken } from '@studies/db';
import { type NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const result = token ? await consumeLoginToken(getDb(), token) : null;
  if (!result) {
    return NextResponse.redirect(
      new URL('/login-info?error=expired', req.url),
      303,
    );
  }
  const res = NextResponse.redirect(new URL('/', req.url), 303);
  res.cookies.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());
  return res;
}
