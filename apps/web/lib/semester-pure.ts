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

export type SemesterOption = {
  /** Visible text: `All` or the number. */
  label: string;
  /** Accessible name: `All semesters` or `Semester N`. */
  name: string;
  href: string;
  current: boolean;
};

/**
 * Switcher entries: `All` then the present semesters ascending; `[]` when no
 * semester is active and fewer than two distinct semesters exist (nothing to
 * switch between). An active semester without subjects gets no entry of its
 * own (the bar would shift): see `unlistedSemester`, and with it the bar
 * stays visible so the filter can be undone.
 * Each href is the `/semester` route with `path` (path + query) as `next`.
 */
export function semesterOptions(
  present: number[],
  current: Semester | null,
  path: string,
): SemesterOption[] {
  const sems = [...new Set(present)].sort((a, b) => a - b);
  if (current === null && sems.length < 2) return [];
  const next = encodeURIComponent(path);
  return [
    {
      label: 'All',
      name: 'All semesters',
      href: `/semester?to=all&next=${next}`,
      current: current === null,
    },
    ...sems.map((n) => ({
      label: String(n),
      name: `Semester ${n}`,
      href: `/semester?to=${n}&next=${next}`,
      current: current === n,
    })),
  ];
}

/** The active semester when no subject is in it (not listed), else null. */
export function unlistedSemester(
  present: number[],
  current: Semester | null,
): Semester | null {
  return current !== null && !present.includes(current) ? current : null;
}
