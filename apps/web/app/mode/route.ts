import type { NextRequest } from 'next/server';
import { seeOther } from '@/lib/http';
import {
  MODE_COOKIE,
  modeCookieOptions,
  modeTarget,
  parseMode,
  safeNext,
} from '@/lib/mode';

/** `GET /mode?to=simple|advanced&next=/path` sets the mode cookie and redirects. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const to = parseMode(params.get('to') ?? undefined);
  const res = seeOther(modeTarget(to, safeNext(params.get('next'))));
  res.cookies.set(MODE_COOKIE, to, modeCookieOptions());
  return res;
}
