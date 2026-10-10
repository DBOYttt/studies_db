import { deleteSession } from '@studies/db';
import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { seeOther } from '@/lib/http';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

export async function POST(req: NextRequest) {
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  if (sid) await deleteSession(getDb(), sid);
  const res = seeOther('/login-info');
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
