import { describe, expect, it, vi } from 'vitest';

let semCookie: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) =>
      n === 'studiesdb.semester' && semCookie
        ? { name: n, value: semCookie }
        : undefined,
  }),
}));

const { semesterPageMetadata, semesterTitle } = await import(
  '../lib/page-meta'
);

describe('semester page titles', () => {
  it('adds the semester only while one is filtered', () => {
    expect(semesterTitle('Start', null)).toBe('Start');
    expect(semesterTitle('Start', 3)).toBe('Start · Semester 3');
  });

  it('follows ?sem, then the cookie', async () => {
    semCookie = undefined;
    expect(await semesterPageMetadata('Timetable', {})).toEqual({
      title: 'Timetable',
    });
    semCookie = '5';
    expect(await semesterPageMetadata('Timetable', {})).toEqual({
      title: 'Timetable · Semester 5',
    });
    expect(await semesterPageMetadata('Timetable', { sem: '2' })).toEqual({
      title: 'Timetable · Semester 2',
    });
    expect(await semesterPageMetadata('Timetable', { sem: 'all' })).toEqual({
      title: 'Timetable',
    });
    semCookie = undefined;
  });
});
