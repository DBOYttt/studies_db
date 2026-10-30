/**
 * Navigation-panel tree: data shapes plus the pure, client-safe logic for the
 * active node, its ancestors and the name filter. Queries live in
 * lib/queries.ts (getNavSubjects) and lib/tables.ts (countViewRows).
 */
import type { ClassKind } from '@studies/db/constants';

export type NavGroup = {
  number: number;
  name: string;
  fileCount: number;
  href: string;
};
export type NavClass = {
  kind: ClassKind | 'none';
  name: string;
  fileCount: number;
  href: string;
  groups: NavGroup[];
};
export type NavSubject = {
  code: string;
  /** Set by `getNavSubjects`; lets the cache filter by semester. */
  semester?: number;
  name: string;
  fileCount: number;
  href: string;
  classes: NavClass[];
};
export type NavView = { name: string; rowCount: number | null; href: string };

export const DB_SCREENS = [
  '/',
  '/plan',
  '/structure',
  '/sql',
  '/search',
  '/schema',
];

// Unit separator: cannot appear in subject codes or class kinds.
const SEP = '\u001f';

export const navKey = {
  db: 'db',
  plan: 'plan',
  subjects: 'subjects',
  views: 'views',
  subject: (code: string) => `s${SEP}${code}`,
  cls: (code: string, kind: string) => `c${SEP}${code}${SEP}${kind}`,
  group: (code: string, kind: string, n: number) =>
    `g${SEP}${code}${SEP}${kind}${SEP}${n}`,
  view: (name: string) => `v${SEP}${name}`,
};

function segment(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length).split('/')[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The most specific tree node matching the URL, or null. Class/group params
 * that the subject does not have fall back to the subject node.
 */
export function activeNavKey(
  pathname: string,
  search: URLSearchParams | null,
  subjects: NavSubject[],
  views: NavView[],
): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  // The Timetable screen has its own node (it is also a db tab).
  if (path === '/plan') return navKey.plan;
  if (DB_SCREENS.includes(path)) return navKey.db;
  const view = segment(path, '/tables/');
  if (view !== null) {
    return views.some((v) => v.name === view) ? navKey.view(view) : null;
  }
  const code = segment(path, '/subjects/');
  if (code === null) return null;
  const subj = subjects.find((s) => s.code === code);
  if (!subj) return null;
  const kind = search?.get('class');
  const cls = kind ? subj.classes.find((c) => c.kind === kind) : undefined;
  if (!cls) return navKey.subject(code);
  const n = Number(search?.get('group'));
  const grp = cls.groups.find((g) => g.number === n);
  return grp
    ? navKey.group(code, cls.kind, grp.number)
    : navKey.cls(code, cls.kind);
}

/** Keys of the nodes that must be open for `key` to be visible. */
export function navAncestors(key: string | null): string[] {
  if (!key) return [];
  const [type, code, kind] = key.split(SEP);
  if (type === 'v') return [navKey.views];
  if (type === 's') return [navKey.subjects];
  if (type === 'c') return [navKey.subjects, navKey.subject(code)];
  if (type === 'g') {
    return [navKey.subjects, navKey.subject(code), navKey.cls(code, kind)];
  }
  return [];
}

const norm = (s: string) => s.trim().toLocaleLowerCase('pl');

/** Case-insensitive match on subject name or code. */
export function filterNavSubjects(
  subjects: NavSubject[],
  q: string,
): NavSubject[] {
  const n = norm(q);
  if (!n) return subjects;
  return subjects.filter(
    (s) => norm(s.name).includes(n) || norm(s.code).includes(n),
  );
}

export function filterNavViews(views: NavView[], q: string): NavView[] {
  const n = norm(q);
  return n ? views.filter((v) => norm(v.name).includes(n)) : views;
}
