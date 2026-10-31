import type { NextRequest } from 'next/server';
import { seeOther } from '@/lib/http';
import { enc, safeNext } from '@/lib/mode';
import {
  parseSemesterValue,
  SEMESTER_COOKIE,
  semesterCookieOptions,
  withoutSem,
} from '@/lib/semester';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Percent-encodes the path per segment so the Location header stays ASCII. */
function asciiLocation(target: string): string {
  const u = new URL(target, 'http://x.invalid');
  return `${u.pathname.split('/').map(enc).join('/')}${u.search}${u.hash}`;
}

/**
 * `GET /semester?to=1-7|all&next=/path` sets or clears the semester cookie
 * and redirects to `next` without any `sem` parameter (fallback `/s`).
 */
export async function GET(req: NextRequest) {
  await requireUser();
  const params = req.nextUrl.searchParams;
  const to = params.get('to');
  const res = seeOther(
    asciiLocation(withoutSem(safeNext(params.get('next')) ?? '/s')),
  );
  // A link from another site must not change the visitor's filter.
  if (req.headers.get('sec-fetch-site') === 'cross-site') return res;
  const sem = parseSemesterValue(to ?? undefined);
  if (sem !== null)
    res.cookies.set(SEMESTER_COOKIE, String(sem), semesterCookieOptions());
  else if (to === 'all') res.cookies.delete(SEMESTER_COOKIE);
  return res;
}
