import { describe, expect, it } from 'vitest';
import {
  activeNavKey,
  filterNavSubjects,
  filterNavViews,
  type NavSubject,
  type NavView,
  navAncestors,
  navKey,
} from '../lib/nav-tree';

const subjects: NavSubject[] = [
  {
    code: 'BD',
    name: 'Bazy danych',
    fileCount: 3,
    href: '/subjects/BD',
    classes: [
      {
        kind: 'laboratorium',
        name: 'Laboratorium',
        fileCount: 3,
        href: '/subjects/BD?class=laboratorium',
        groups: [
          {
            number: 2,
            name: 'Gr. 2',
            fileCount: 3,
            href: '/subjects/BD?class=laboratorium&group=2',
          },
        ],
      },
    ],
  },
  {
    code: 'C++',
    name: 'Programowanie',
    fileCount: 0,
    href: '/subjects/C%2B%2B',
    classes: [],
  },
];
const views: NavView[] = [
  { name: 'v_files', rowCount: 3, href: '/tables/v_files' },
  { name: 'v_subjects', rowCount: 2, href: '/tables/v_subjects' },
];
const at = (url: string) => {
  const u = new URL(url, 'http://x');
  return activeNavKey(u.pathname, u.searchParams, subjects, views);
};

describe('activeNavKey', () => {
  it('maps database screens to the studies_db node', () => {
    for (const p of ['/', '/structure', '/sql?q=1', '/search', '/schema']) {
      expect(at(p)).toBe(navKey.db);
    }
  });
  it('maps /plan (any query) to the Timetable node', () => {
    expect(at('/plan')).toBe(navKey.plan);
    expect(at('/plan?week=2026-W42')).toBe(navKey.plan);
    expect(at('/plan/?tab=groups')).toBe(navKey.plan);
    expect(navAncestors(navKey.plan)).toEqual([]);
  });
  it('maps subject, class and group URLs to the most specific node', () => {
    expect(at('/subjects/BD')).toBe(navKey.subject('BD'));
    expect(at('/subjects/BD?class=laboratorium')).toBe(
      navKey.cls('BD', 'laboratorium'),
    );
    expect(at('/subjects/BD?class=laboratorium&group=2&file=9')).toBe(
      navKey.group('BD', 'laboratorium', 2),
    );
    expect(at('/subjects/C%2B%2B?tab=map')).toBe(navKey.subject('C++'));
  });
  it('falls back to the subject for unknown class/group params', () => {
    expect(at('/subjects/BD?class=wyklad')).toBe(navKey.subject('BD'));
    expect(at('/subjects/BD?class=laboratorium&group=7')).toBe(
      navKey.cls('BD', 'laboratorium'),
    );
  });
  it('maps view pages and ignores unknown routes', () => {
    expect(at('/tables/v_files?page=2')).toBe(navKey.view('v_files'));
    expect(at('/tables/nope')).toBeNull();
    expect(at('/subjects/NOPE')).toBeNull();
    expect(at('/topics/5')).toBeNull();
  });
});

describe('navAncestors', () => {
  it('lists the nodes to open', () => {
    expect(navAncestors(navKey.group('BD', 'laboratorium', 2))).toEqual([
      navKey.subjects,
      navKey.subject('BD'),
      navKey.cls('BD', 'laboratorium'),
    ]);
    expect(navAncestors(navKey.subject('BD'))).toEqual([navKey.subjects]);
    expect(navAncestors(navKey.view('v_files'))).toEqual([navKey.views]);
    expect(navAncestors(navKey.db)).toEqual([]);
    expect(navAncestors(null)).toEqual([]);
  });
});

describe('filters', () => {
  it('matches subject names and codes case-insensitively', () => {
    expect(filterNavSubjects(subjects, 'bazy').map((s) => s.code)).toEqual([
      'BD',
    ]);
    expect(filterNavSubjects(subjects, ' c++ ').map((s) => s.code)).toEqual([
      'C++',
    ]);
    expect(filterNavSubjects(subjects, '')).toBe(subjects);
  });
  it('matches view names', () => {
    expect(filterNavViews(views, 'SUBJ').map((v) => v.name)).toEqual([
      'v_subjects',
    ]);
  });
});
