import { describe, expect, it } from 'vitest';
import { semesterOptions } from '@/lib/semester-pure';

describe('semesterOptions', () => {
  it('is empty with fewer than two distinct semesters', () => {
    expect(semesterOptions([], null, '/s')).toEqual([]);
    expect(semesterOptions([1], null, '/s')).toEqual([]);
    expect(semesterOptions([2, 2], 2, '/s')).toEqual([]);
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
