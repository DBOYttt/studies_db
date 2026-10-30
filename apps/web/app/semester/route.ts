import type { NextRequest } from 'next/server';
import { seeOther } from '@/lib/http';
import { safeNext } from '@/lib/mode';
import {
  parseSemesterValue,
  SEMESTER_COOKIE,
  semesterCookieOptions,
  withoutSem,
} from '@/lib/semester';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * `GET /semester?to=1-7|all&next=/path` sets or clears the semester cookie
 * and redirects to `next` without any `sem` parameter (fallback `/s`).
 */
export async function GET(req: NextRequest) {
  await requireUser();
  const params = req.nextUrl.searchParams;
  const to = params.get('to');
  const res = seeOther(withoutSem(safeNext(params.get('next')) ?? '/s'));
  const sem = parseSemesterValue(to ?? undefined);
  if (sem !== null)
    res.cookies.set(SEMESTER_COOKIE, String(sem), semesterCookieOptions());
  else if (to === 'all') res.cookies.delete(SEMESTER_COOKIE);
  return res;
}
