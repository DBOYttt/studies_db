import { describe, expect, it } from 'vitest';
import { defaultWeek } from '../lib/plan';

/** Wall Date: UTC fields equal the Warsaw wall clock. */
const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

describe('defaultWeek', () => {
  const range = { first: W(2026, 10, 1, 8), last: W(2027, 1, 29, 12) };
  it("now's week when inside the range (week granularity)", () => {
    expect(defaultWeek(W(2026, 11, 18, 10), range)).toEqual({
      year: 2026,
      week: 47,
    });
    // Monday of the first week, before `first` itself.
    expect(defaultWeek(W(2026, 9, 28), range)).toEqual({
      year: 2026,
      week: 40,
    });
    // Sunday of the last week, after `last` itself.
    expect(defaultWeek(W(2027, 1, 31, 20), range)).toEqual({
      year: 2027,
      week: 4,
    });
  });
  it('week of first when outside', () => {
    expect(defaultWeek(W(2026, 8, 1), range)).toEqual({ year: 2026, week: 40 });
    expect(defaultWeek(W(2027, 3, 1), range)).toEqual({ year: 2026, week: 40 });
  });
  it("now's week without a range", () => {
    expect(defaultWeek(W(2026, 10, 12), null)).toEqual({
      year: 2026,
      week: 42,
    });
  });
});
