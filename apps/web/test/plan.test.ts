import { describe, expect, it } from 'vitest';
import {
  DAY_END_MIN,
  DAY_START_MIN,
  defaultWeek,
  layoutDay,
  type PlanSession,
  SLOT_MIN,
  slotRange,
  weekDays,
} from '../lib/plan';

/** Wall Date: UTC fields equal the Warsaw wall clock. */
const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

let nextId = 1;
const S = (
  start: Date,
  end: Date,
  o: Partial<PlanSession> = {},
): PlanSession => ({
  id: nextId++,
  startsAt: start,
  endsAt: end,
  subjectId: 1,
  subjectName: 'Fizyka',
  subjectCode: 'FIZ',
  classId: null,
  classKind: null,
  className: null,
  groupId: null,
  groupName: null,
  lecturerId: null,
  lecturerName: null,
  room: null,
  label: 'W',
  status: 'confirmed',
  ...o,
});

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

describe('slotRange', () => {
  it('constants', () => {
    expect([DAY_START_MIN, DAY_END_MIN, SLOT_MIN]).toEqual([420, 1200, 15]);
  });
  it('08:00–09:30 → rows 4..10', () => {
    expect(slotRange(S(W(2026, 10, 12, 8), W(2026, 10, 12, 9, 30)))).toEqual({
      from: 4,
      to: 10,
    });
  });
  it('clamps to the day window', () => {
    expect(slotRange(S(W(2026, 10, 12, 6), W(2026, 10, 12, 7, 30)))).toEqual({
      from: 0,
      to: 2,
    });
    expect(slotRange(S(W(2026, 10, 12, 19, 30), W(2026, 10, 12, 21)))).toEqual({
      from: 50,
      to: 52,
    });
  });
  it('always at least one row, also fully outside the window', () => {
    expect(slotRange(S(W(2026, 10, 12, 5), W(2026, 10, 12, 6)))).toEqual({
      from: 0,
      to: 1,
    });
    expect(slotRange(S(W(2026, 10, 12, 21), W(2026, 10, 12, 22)))).toEqual({
      from: 51,
      to: 52,
    });
    expect(slotRange(S(W(2026, 10, 12, 8), W(2026, 10, 12, 8)))).toEqual({
      from: 4,
      to: 5,
    });
  });
  it('rounds partial slots outwards', () => {
    expect(
      slotRange(S(W(2026, 10, 12, 8, 10), W(2026, 10, 12, 9, 35))),
    ).toEqual({ from: 4, to: 11 });
  });
});

describe('layoutDay', () => {
  it('A overlaps B and C, B/C do not: 2 columns, A col 0, B and C col 1', () => {
    const a = S(W(2026, 10, 12, 8), W(2026, 10, 12, 10));
    const b = S(W(2026, 10, 12, 8), W(2026, 10, 12, 9));
    const c = S(W(2026, 10, 12, 9), W(2026, 10, 12, 10));
    const l = layoutDay([c, b, a]);
    const of = (s: PlanSession) => l.find((x) => x.session === s);
    expect(of(a)).toMatchObject({ col: 0, cols: 2 });
    expect(of(b)).toMatchObject({ col: 1, cols: 2 });
    expect(of(c)).toMatchObject({ col: 1, cols: 2 });
    expect(l.map((x) => x.session)).toEqual([a, b, c]);
  });
  it('non-overlapping sessions get one column each', () => {
    const a = S(W(2026, 10, 12, 8), W(2026, 10, 12, 9, 30));
    const b = S(W(2026, 10, 12, 9, 30), W(2026, 10, 12, 11));
    const c = S(W(2026, 10, 12, 12), W(2026, 10, 12, 13));
    expect(layoutDay([a, b, c]).map((x) => [x.col, x.cols])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
  });
  it('separate clusters have their own column count', () => {
    const a = S(W(2026, 10, 12, 8), W(2026, 10, 12, 9));
    const b = S(W(2026, 10, 12, 8, 30), W(2026, 10, 12, 9, 30));
    const c = S(W(2026, 10, 12, 8, 45), W(2026, 10, 12, 9, 15));
    const d = S(W(2026, 10, 12, 12), W(2026, 10, 12, 13));
    expect(layoutDay([a, b, c, d]).map((x) => [x.col, x.cols])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [0, 1],
    ]);
  });
  it('empty day', () => {
    expect(layoutDay([])).toEqual([]);
  });
});

describe('weekDays', () => {
  const w = { year: 2026, week: 42 };
  it('Mon–Fri by default', () => {
    expect(weekDays([], w)).toEqual(
      [12, 13, 14, 15, 16].map((d) => W(2026, 10, d)),
    );
  });
  it('adds Saturday only when a session falls on it', () => {
    const sat = S(W(2026, 10, 17, 9), W(2026, 10, 17, 10));
    expect(weekDays([sat], w)).toEqual(
      [12, 13, 14, 15, 16, 17].map((d) => W(2026, 10, d)),
    );
    const sun = S(W(2026, 10, 18, 9), W(2026, 10, 18, 10));
    expect(weekDays([sun], w)).toEqual(
      [12, 13, 14, 15, 16, 18].map((d) => W(2026, 10, d)),
    );
    // A Saturday of another week does not count.
    const otherSat = S(W(2026, 10, 24, 9), W(2026, 10, 24, 10));
    expect(weekDays([otherSat], w)).toHaveLength(5);
  });
});
