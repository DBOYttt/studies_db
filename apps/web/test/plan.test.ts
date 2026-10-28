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

describe('defaultWeek skips a finished week', () => {
  const range = { first: W(2026, 10, 1, 8), last: W(2027, 1, 29, 12) };
  // Sun 25 Oct 2026 20:00 (Warsaw wall clock), ISO week 2026-W43.
  const sunday = W(2026, 10, 25, 20);
  it('goes to the next week when nothing of this week is left', () => {
    const ends = [W(2026, 10, 19, 9, 30), W(2026, 10, 23, 15, 30)];
    expect(defaultWeek(sunday, range, ends)).toEqual({ year: 2026, week: 44 });
    // An empty current week is finished too.
    expect(defaultWeek(sunday, range, [])).toEqual({ year: 2026, week: 44 });
    expect(defaultWeek(sunday, null, [])).toEqual({ year: 2026, week: 44 });
  });
  it("stays on this week while a session or event hasn't ended", () => {
    // Ends later today; one in progress (ends after now) counts as left.
    expect(defaultWeek(sunday, range, [W(2026, 10, 25, 21)])).toEqual({
      year: 2026,
      week: 43,
    });
    expect(
      defaultWeek(W(2026, 10, 21, 10), range, [W(2026, 10, 21, 10, 30)]),
    ).toEqual({ year: 2026, week: 43 });
  });
  it('the end exactly at now is over', () => {
    expect(defaultWeek(sunday, range, [sunday])).toEqual({
      year: 2026,
      week: 44,
    });
  });
  it('rolls over the year end', () => {
    // Sun 3 Jan 2027 is in 2026-W53.
    expect(defaultWeek(W(2027, 1, 3, 12), range, [])).toEqual({
      year: 2027,
      week: 1,
    });
  });
  it('a week outside the range still opens the first week', () => {
    expect(defaultWeek(W(2026, 8, 1), range, [])).toEqual({
      year: 2026,
      week: 40,
    });
  });
});
