import { isSemester, type Semester } from '@studies/db/fields';

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

export type SemesterOption = { label: string; href: string; current: boolean };

/**
 * Switcher entries: `All` then the present semesters (plus the active one)
 * ascending; `[]` when no semester is active and fewer than two distinct
 * semesters exist (nothing to switch between).
 * Each href is the `/semester` route with `path` (path + query) as `next`.
 */
export function semesterOptions(
  present: number[],
  current: Semester | null,
  path: string,
): SemesterOption[] {
  // An active semester is always listed (and keeps the switcher visible),
  // so the filter it applies can be seen and undone.
  const all = current === null ? present : [...present, current];
  const sems = [...new Set(all)].sort((a, b) => a - b);
  if (current === null && sems.length < 2) return [];
  const next = encodeURIComponent(path);
  return [
    {
      label: 'All',
      href: `/semester?to=all&next=${next}`,
      current: current === null,
    },
    ...sems.map((n) => ({
      label: String(n),
      href: `/semester?to=${n}&next=${next}`,
      current: current === n,
    })),
  ];
}
