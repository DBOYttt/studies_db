import type mysql from 'mysql2/promise';
import { cookies } from 'next/headers';
import {
  SEMESTER_COOKIE,
  type Semester,
  semesterFromRequest,
} from './semester-pure';

export {
  parseSemesterValue,
  SEMESTER_COOKIE,
  type Semester,
  type SemesterOption,
  semesterFromRequest,
  semesterOptions,
} from './semester-pure';

type SP = Record<string, string | string[] | undefined>;

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

/** Semesters that have at least one subject, ascending (public view only). */
export async function listPresentSemesters(
  pool: mysql.Pool,
): Promise<number[]> {
  const [rows] = await pool.query(
    'SELECT DISTINCT semester FROM v_subjects ORDER BY semester',
  );
  return (rows as { semester: number }[]).map((r) => Number(r.semester));
}
