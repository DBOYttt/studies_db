import { describe, expect, it } from 'vitest';
import type { PlanSession } from '../src/plan.js';
import {
  annotateWeek,
  matchEventsToSessions,
  type WeekMark,
} from '../src/plan-annotate.js';

/** Wall Date: UTC fields equal the Warsaw wall clock. */
const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

const SUB = 7;
const LAB = 11;
const G1 = 21;
const G2 = 22;
const G3 = 23;

let nextId = 100;
const session = (start: Date, o: Partial<PlanSession> = {}): PlanSession => ({
  type: 'class',
  id: nextId++,
  startsAt: start,
  endsAt: new Date(start.getTime() + 90 * 60_000),
  subjectId: SUB,
  subjectName: 'Bazy danych',
  subjectCode: 'BD',
  classId: LAB,
  classKind: 'laboratorium',
  className: 'Laboratorium',
  groupId: G1,
  groupName: 'Gr. 1',
  lecturerId: null,
  lecturerName: null,
  room: 'B-2 202',
  label: 'L',
  status: 'confirmed',
  sessionKind: 'class',
  ...o,
});
const event = (start: Date, o: Partial<PlanSession> = {}): PlanSession => ({
  ...session(start),
  type: 'event',
  endsAt: start,
  lecturerId: null,
  room: null,
  label: o.eventTitle ?? 'Kolokwium 1',
  eventKind: 'kolokwium',
  eventTitle: 'Kolokwium 1',
  allDay: false,
  sessionKind: undefined,
  ...o,
});
const exam = (start: Date, o: Partial<PlanSession> = {}): PlanSession =>
  session(start, {
    classId: null,
    classKind: null,
    className: null,
    groupId: null,
    groupName: null,
    sessionKind: 'exam',
    ...o,
  });
const mark = (o: Partial<WeekMark> = {}): WeekMark => ({
  id: 500,
  classId: LAB,
  groupId: null,
  note: null,
  skips: [],
  ...o,
});

const byId = (out: PlanSession[], s: PlanSession) =>
  out.find((x) => x.type === s.type && x.id === s.id);
const MON10 = W(2026, 10, 19, 10);

describe('annotateWeek: Test badges', () => {
  it('an event at the session start badges it and is removed', () => {
    const s = session(MON10);
    const e = event(MON10);
    const out = annotateWeek([s, e], []);
    expect(out).toHaveLength(1);
    expect(out[0].badges).toEqual([
      { kind: 'test', eventIds: [e.id], titles: ['Kolokwium 1'] },
    ]);
  });

  it('an event at the session end (exclusive) does not match', () => {
    const s = session(MON10);
    const e = event(s.endsAt);
    const out = annotateWeek([s, e], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it("another group's event does not badge the session", () => {
    const s = session(MON10, { groupId: G1 });
    const e = event(W(2026, 10, 19, 10, 30), { groupId: G2 });
    const out = annotateWeek([s, e], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it('an event without a group badges every group and is removed once', () => {
    const ss = [G1, G2, G3].map((g) => session(MON10, { groupId: g }));
    const e = event(W(2026, 10, 19, 10, 15), { groupId: null });
    const out = annotateWeek([...ss, e], []);
    expect(out).toHaveLength(3);
    for (const s of out) {
      expect(s.badges).toEqual([
        { kind: 'test', eventIds: [e.id], titles: ['Kolokwium 1'] },
      ]);
    }
  });

  it('two tests on one session make one badge with both ids', () => {
    const s = session(MON10);
    const a = event(MON10, { eventTitle: 'A' });
    const b = event(W(2026, 10, 19, 11), { eventTitle: 'B' });
    const out = annotateWeek([s, a, b], []);
    expect(out).toHaveLength(1);
    expect(out[0].badges).toEqual([
      { kind: 'test', eventIds: [a.id, b.id], titles: ['A', 'B'] },
    ]);
  });

  it('a cancelled session keeps the event as a block', () => {
    const s = session(MON10, { status: 'cancelled' });
    const e = event(MON10);
    const out = annotateWeek([s, e], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it('an event on another day is kept', () => {
    const s = session(MON10);
    const e = event(W(2026, 10, 20, 10));
    const out = annotateWeek([s, e], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it('an all-day kolokwium is kept', () => {
    const s = session(W(2026, 10, 19, 0), {
      endsAt: W(2026, 10, 19, 2),
    });
    const e = event(W(2026, 10, 19, 0), {
      allDay: true,
      endsAt: W(2026, 10, 20, 0),
    });
    const out = annotateWeek([s, e], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it('a group kolokwium does not badge a group-less session of the class', () => {
    const s = session(MON10, { groupId: null, groupName: null });
    const e = event(MON10, { groupId: G1 });
    const out = annotateWeek([s, e], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it('an event after midnight of a session spanning midnight is kept', () => {
    const s = session(W(2026, 10, 19, 23), { endsAt: W(2026, 10, 20, 1) });
    const e = event(W(2026, 10, 20, 0, 30));
    const out = annotateWeek([s, e], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it('a trip inside a session is kept', () => {
    const s = session(MON10);
    const e = event(MON10, { eventKind: 'wyjazd' });
    const out = annotateWeek([s, e], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it('needs the same subject and class', () => {
    const s = session(MON10);
    const other = event(MON10, { subjectId: SUB + 1 });
    const otherClass = event(MON10, { classId: LAB + 1 });
    const out = annotateWeek([s, other, otherClass], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(out).toHaveLength(3);
  });

  it('exam sessions never get Test badges', () => {
    const x = exam(MON10, { classId: LAB, groupId: null });
    const e = event(MON10, { groupId: null });
    const out = annotateWeek([x, e], []);
    expect(byId(out, x)?.badges).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it('matchEventsToSessions returns badges by session id and matched ids', () => {
    const s1 = session(MON10, { groupId: G1 });
    const s2 = session(MON10, { groupId: G2 });
    const e = event(MON10, { groupId: G2 });
    const free = event(W(2026, 10, 21, 10));
    const r = matchEventsToSessions([s1, s2], [e, free]);
    expect([...r.badges.entries()]).toEqual([[s2.id, [e.id]]]);
    expect([...r.matched]).toEqual([e.id]);
  });
});

describe('annotateWeek: Entry quiz badges', () => {
  it('a group mark badges only that group', () => {
    const s1 = session(MON10, { groupId: G1 });
    const s2 = session(MON10, { groupId: G2 });
    const out = annotateWeek(
      [s1, s2],
      [mark({ id: 9, groupId: G2, note: 'Kartka' })],
    );
    expect(byId(out, s1)?.badges).toBeUndefined();
    expect(byId(out, s2)?.badges).toEqual([
      { kind: 'entry_quiz', markId: 9, note: 'Kartka' },
    ]);
  });

  it('an all-groups mark badges every group', () => {
    const ss = [G1, G2].map((g) => session(MON10, { groupId: g }));
    const out = annotateWeek(ss, [mark({ id: 9 })]);
    for (const s of out) {
      expect(s.badges).toEqual([{ kind: 'entry_quiz', markId: 9, note: null }]);
    }
  });

  it('a skipped date gets no badge', () => {
    const mon = session(MON10);
    const tue = session(W(2026, 10, 20, 10));
    const out = annotateWeek(
      [mon, tue],
      [mark({ id: 9, skips: ['2026-10-19'] })],
    );
    expect(byId(out, mon)?.badges).toBeUndefined();
    expect(byId(out, tue)?.badges).toHaveLength(1);
  });

  it('a cancelled session gets no badge', () => {
    const s = session(MON10, { status: 'cancelled' });
    const out = annotateWeek([s], [mark()]);
    expect(out[0].badges).toBeUndefined();
  });

  it('a mark of another class does not apply', () => {
    const s = session(MON10);
    const out = annotateWeek([s], [mark({ classId: LAB + 1 })]);
    expect(out[0].badges).toBeUndefined();
  });

  it('Test comes before Entry quiz on one session', () => {
    const s = session(MON10);
    const e = event(MON10);
    const out = annotateWeek([s, e], [mark({ id: 9 })]);
    expect(out[0].badges?.map((b) => b.kind)).toEqual(['test', 'entry_quiz']);
  });

  it('drops stale badges and links of the input', () => {
    const s = session(MON10, {
      badges: [{ kind: 'entry_quiz', markId: 1, note: null }],
    });
    const x = exam(W(2026, 2, 2, 9), { linkedEventId: 77 });
    const out = annotateWeek([s, x], []);
    expect(byId(out, s)?.badges).toBeUndefined();
    expect(byId(out, x)?.linkedEventId).toBeUndefined();
  });

  it('does not change its input', () => {
    const s = session(MON10);
    annotateWeek([s, event(MON10)], [mark()]);
    expect(s.badges).toBeUndefined();
  });
});

describe('annotateWeek: exam dedup', () => {
  it('an egzamin event within 60 minutes of an exam session is merged', () => {
    const x = exam(W(2026, 2, 2, 9));
    const e = event(W(2026, 2, 2, 10), {
      eventKind: 'egzamin',
      classId: null,
      groupId: null,
    });
    const out = annotateWeek([x, e], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: x.id, linkedEventId: e.id });
    expect(out[0].badges).toBeUndefined();
  });

  it('a cancelled exam session neither hides nor links the event', () => {
    const x = exam(W(2026, 2, 2, 9), { status: 'cancelled' });
    const e = event(W(2026, 2, 2, 9), { eventKind: 'egzamin' });
    const out = annotateWeek([x, e], []);
    expect(out).toHaveLength(2);
    expect(byId(out, x)?.linkedEventId).toBeUndefined();
    expect(byId(out, e)).toBeDefined();
  });

  it('an egzamin event more than 60 minutes away is kept', () => {
    const x = exam(W(2026, 2, 2, 9));
    const e = event(W(2026, 2, 2, 10, 1), { eventKind: 'egzamin' });
    const before = event(W(2026, 2, 2, 7, 59), { eventKind: 'egzamin' });
    const out = annotateWeek([x, e, before], []);
    expect(out).toHaveLength(3);
    expect(byId(out, x)?.linkedEventId).toBeUndefined();
  });

  it('needs the same subject and an exam session', () => {
    const x = exam(W(2026, 2, 2, 9));
    const cls = session(W(2026, 2, 2, 9, 30));
    const e = event(W(2026, 2, 2, 9), {
      eventKind: 'egzamin',
      subjectId: SUB + 1,
    });
    const e2 = event(W(2026, 2, 2, 9, 30), {
      eventKind: 'egzamin',
      subjectId: SUB,
      classId: null,
    });
    const out = annotateWeek([cls, e], []);
    expect(out).toHaveLength(2);
    const out2 = annotateWeek([x, e], []);
    expect(out2).toHaveLength(2);
    // Same subject: merged into the exam session, never into the class one.
    const out3 = annotateWeek([cls, x, e2], []);
    expect(out3).toHaveLength(2);
    expect(byId(out3, x)?.linkedEventId).toBe(e2.id);
    expect(byId(out3, cls)?.linkedEventId).toBeUndefined();
  });
});
