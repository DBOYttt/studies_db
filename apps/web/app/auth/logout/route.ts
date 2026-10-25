import { deleteSession } from '@studies/db';
import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { forbiddenOrigin, seeOther } from '@/lib/http';
import { isCrossOrigin } from '@/lib/same-origin';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return forbiddenOrigin();
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  if (sid) await deleteSession(getDb(), sid);
  const res = seeOther('/login-info');
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
