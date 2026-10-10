import { deleteSession } from '@studies/db';
import { type NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/session';

export async function POST(req: NextRequest) {
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  if (sid) await deleteSession(getDb(), sid);
  const res = NextResponse.redirect(new URL('/login-info', req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
