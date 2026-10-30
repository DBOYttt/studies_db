import { isSemester, type Semester } from '@studies/db/fields';
import { cookies } from 'next/headers';

export type { Semester };

export const SEMESTER_COOKIE = 'studiesdb.semester';

type SP = Record<string, string | string[] | undefined>;

/** `1`..`7` exactly (first value only), else null: no spaces, signs or zeros. */
export function parseSemesterValue(
  v: string | string[] | undefined,
): Semester | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || !/^[1-7]$/.test(s)) return null;
  const n = Number(s);
  return isSemester(n) ? n : null;
}

/**
 * `?sem=` wins (`all` is null even when a cookie is set); a missing or bad
 * `?sem` falls back to the cookie, whose bad value means all semesters.
 */
export function semesterFromRequest(
  sp: SP,
  cookieValue: string | undefined,
): Semester | null {
  const raw = Array.isArray(sp.sem) ? sp.sem[0] : sp.sem;
  if (raw === 'all') return null;
  return parseSemesterValue(raw) ?? parseSemesterValue(cookieValue);
}

/** The chosen semester of this request (`?sem=` then the cookie), or null. */
export async function currentSemester(sp: SP): Promise<Semester | null> {
  return semesterFromRequest(sp, (await cookies()).get(SEMESTER_COOKIE)?.value);
}

/** Not httpOnly on purpose: it only holds a number 1-7. */
export function semesterCookieOptions() {
  return {
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  };
}

/** The same path and query without any `sem` parameter (hash kept). */
export function withoutSem(path: string): string {
  const hashAt = path.indexOf('#');
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const rest = hashAt === -1 ? path : path.slice(0, hashAt);
  const q = rest.indexOf('?');
  if (q === -1) return path;
  const params = new URLSearchParams(rest.slice(q + 1));
  if (!params.has('sem')) return path;
  params.delete('sem');
  const qs = params.toString();
  return `${rest.slice(0, q)}${qs ? `?${qs}` : ''}${hash}`;
}
