import { describe, expect, it } from 'vitest';
import { semesterOptions, unlistedSemester } from '@/lib/semester-pure';

describe('semesterOptions', () => {
  it('is empty with fewer than two distinct semesters', () => {
    expect(semesterOptions([], null, '/s')).toEqual([]);
    expect(semesterOptions([1], null, '/s')).toEqual([]);
    expect(semesterOptions([2, 2], null, '/s')).toEqual([]);
  });

  it('stays visible while a semester is active, even with one present', () => {
    const o = semesterOptions([2, 2], 2, '/s');
    expect(o.map((x) => [x.label, x.current])).toEqual([
      ['All', false],
      ['2', true],
    ]);
  });

  it('does not add a segment for an active semester without subjects', () => {
    const o = semesterOptions([1, 3], 4, '/s');
    expect(o.map((x) => x.label)).toEqual(['All', '1', '3']);
    expect(o.some((x) => x.current)).toBe(false);
    // Still shown, so the filter can be undone.
    expect(semesterOptions([], 5, '/s').map((x) => x.label)).toEqual(['All']);
    expect(unlistedSemester([1, 3], 4)).toBe(4);
    expect(unlistedSemester([1, 3], 3)).toBeNull();
    expect(unlistedSemester([1, 3], null)).toBeNull();
  });

  it('names each entry for screen readers', () => {
    const o = semesterOptions([1, 3], null, '/s');
    expect(o.map((x) => x.name)).toEqual([
      'All semesters',
      'Semester 1',
      'Semester 3',
    ]);
  });

  it('lists All first, then semesters ascending, marking the current one', () => {
    const o = semesterOptions([3, 1], 3, '/s/plan?week=x');
    expect(o.map((x) => x.label)).toEqual(['All', '1', '3']);
    expect(o.map((x) => x.current)).toEqual([false, false, true]);
    expect(o[2].href).toBe(
      `/semester?to=3&next=${encodeURIComponent('/s/plan?week=x')}`,
    );
    expect(o[0].href).toBe(
      `/semester?to=all&next=${encodeURIComponent('/s/plan?week=x')}`,
    );
  });

  it('marks All current when no semester is chosen', () => {
    const o = semesterOptions([1, 3], null, '/s');
    expect(o[0].current).toBe(true);
    expect(o.filter((x) => x.current)).toHaveLength(1);
  });
});
