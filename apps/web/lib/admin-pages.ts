/** Helpers of the admin Subjects and Lecturers pages. */
import { CODE_RE } from './admin-forms';

/**
 * The `[code]` segment of /admin/subjects/[code], trimmed and upper-cased
 * (`/admin/subjects/%20ana1` is ANA1); null for anything that cannot be a
 * subject code, which the page answers with 404.
 */
export function parseSubjectParam(raw: string): string | null {
  let v = raw;
  // A code never contains `%`, so decoding an already decoded value is safe.
  if (v.includes('%')) {
    try {
      v = decodeURIComponent(v);
    } catch {
      return null;
    }
  }
  const code = v.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** `dr Jan Kowalski`, or the bare name without a title. */
export const lecturerLabel = (l: { title: string | null; name: string }) =>
  l.title ? `${l.title} ${l.name}` : l.name;

export const USERS_PAGE_SIZE = 50;
const Q_MAX = 100;

export type UsersQuery = { q: string; page: number };

type SP = Record<string, string | string[] | undefined>;

/** `?q=&page=` of /admin/users; anything invalid falls back to the default. */
export function parseUsersQuery(sp: SP): UsersQuery {
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, Q_MAX) : '';
  const p = typeof sp.page === 'string' ? sp.page : '';
  return { q, page: /^[1-9]\d{0,5}$/.test(p) ? Number(p) : 1 };
}

export function usersHref(u: UsersQuery): string {
  const p = new URLSearchParams();
  if (u.q) p.set('q', u.q);
  if (u.page > 1) p.set('page', String(u.page));
  const s = p.toString();
  return s ? `/admin/users?${s}` : '/admin/users';
}
