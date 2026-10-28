import { describe, expect, it } from 'vitest';
import {
  filterMyGroups,
  hiddenByMyGroups,
  isoWeekOf,
  type PlanSession,
} from '../lib/plan';
import {
  annotatePlanWeek,
  canAddTest,
  dayColumns,
  eventsForFilter,
  eventWhenShort,
  newEventHref,
  newTestHref,
} from '../lib/plan-events';
import { pickUpcoming } from '../lib/upcoming-events';

const base: PlanSession = {
  type: 'event',
  id: 1,
  startsAt: new Date('2026-10-14T10:00:00Z'),
  endsAt: new Date('2026-10-14T11:00:00Z'),
  subjectId: 5,
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
  label: 'Kolokwium',
  status: 'confirmed',
  eventKind: 'kolokwium',
  eventTitle: 'Kolokwium',
  allDay: false,
};
const days = [
  new Date('2026-10-13T00:00:00Z'),
  new Date('2026-10-14T00:00:00Z'),
];

describe('dayColumns', () => {
  it('puts all-day events in the strip, not the grid', () => {
    const allDay = {
      ...base,
      id: 2,
      allDay: true,
      startsAt: new Date('2026-10-14T00:00:00Z'),
      endsAt: new Date('2026-10-15T00:00:00Z'),
    };
    const cols = dayColumns(days, [base, allDay]);
    expect(cols[1].allDay.map((s) => s.id)).toEqual([2]);
    expect(cols[1].blocks.map((b) => b.session.id)).toEqual([1]);
    expect(cols[0].allDay).toEqual([]);
    expect(cols[0].blocks).toEqual([]);
  });
});

describe('Moje grupy and events', () => {
  it('hides another group event and counts it', () => {
    const other = { ...base, id: 3, classId: 7, groupId: 9 };
    const mine = { ...base, id: 4, classId: 7, groupId: 8 };
    const all = [base, other, mine];
    const g = { '7': 8 };
    expect(filterMyGroups(all, g).map((s) => s.id)).toEqual([1, 4]);
    expect(hiddenByMyGroups(all, g)).toBe(1);
  });
});

describe('helpers', () => {
  it('filters events by plan filter', () => {
    const other = { ...base, id: 9, subjectId: 6 };
    expect(eventsForFilter([base, other], { subjectId: 5 })).toEqual([base]);
    expect(eventsForFilter([base], { lecturerId: 1 })).toEqual([]);
    expect(eventsForFilter([base, other], {})).toHaveLength(2);
  });
  it('prefills today or the Monday of the shown week', () => {
    const now = new Date('2026-10-15T09:00:00Z');
    const cur = isoWeekOf(now);
    expect(newEventHref(cur, now, cur, true)).toBe(
      '/s/wydarzenia/nowe?date=2026-10-15',
    );
    const next = { ...cur, week: cur.week + 1 };
    expect(newEventHref(next, now, cur, false, 5)).toBe(
      '/wydarzenia/nowe?date=2026-10-19&subject=5',
    );
  });
  it('"+ Test" opens the form prefilled with the session', () => {
    const s = {
      ...base,
      type: 'class' as const,
      id: 42,
      classId: 3,
      className: 'Laboratorium',
    };
    const title = (href: string) =>
      new URLSearchParams(href.split('?')[1]).get('title');
    const simple = newTestHref({ ...s, groupId: 8 }, true);
    expect(simple).toMatch(
      /^\/s\/wydarzenia\/nowe\?kind=kolokwium&subject=5&class=3&group=8&session=42&title=/,
    );
    // The title is prefilled, so "Add event" needs no typing.
    expect(title(simple)).toBe('Test – FIZ Laboratorium');
    const adv = newTestHref(s, false);
    expect(adv).toMatch(
      /^\/wydarzenia\/nowe\?kind=kolokwium&subject=5&class=3&session=42&title=/,
    );
    expect(title(newTestHref({ ...s, className: null }, false))).toBe(
      'Test – FIZ',
    );
  });
  it('"+ Test" only on confirmed class sessions', () => {
    const s = { ...base, type: 'class' as const, id: 42, classId: 3 };
    expect(canAddTest(s)).toBe(true);
    expect(canAddTest({ ...s, status: 'cancelled' })).toBe(false);
    expect(canAddTest({ ...s, sessionKind: 'exam' })).toBe(false);
    expect(canAddTest({ ...s, classId: null })).toBe(false);
    expect(canAddTest(base)).toBe(false);
  });
  it('short when label', () => {
    expect(eventWhenShort(base)).toBe('Wed 14 Oct, 10:00');
    expect(eventWhenShort({ ...base, allDay: true })).toBe('Wed 14 Oct');
  });
});

describe('pickUpcoming', () => {
  it('lists 5 events in time order, skipping other groups', () => {
    const ev = Array.from({ length: 8 }, (_, i) => ({
      ...base,
      id: i + 1,
      startsAt: new Date(Date.UTC(2026, 9, 15 + i, 10)),
      classId: 7,
      groupId: i === 1 ? 9 : 8,
    }));
    const got = pickUpcoming(ev, { '7': 8 }, 5);
    expect(got.map((e) => e.id)).toEqual([1, 3, 4, 5, 6]);
  });
});

describe('annotatePlanWeek', () => {
  const lab: PlanSession = {
    ...base,
    type: 'class',
    id: 10,
    startsAt: new Date('2026-10-14T10:00:00Z'),
    endsAt: new Date('2026-10-14T11:30:00Z'),
    classId: 3,
    classKind: 'laboratorium',
    lecturerId: 8,
    eventKind: undefined,
    eventTitle: undefined,
    allDay: undefined,
  };
  const test = {
    ...base,
    id: 20,
    classId: 3,
    startsAt: new Date('2026-10-14T10:15:00Z'),
  };
  const trip = {
    ...base,
    id: 21,
    eventKind: 'wyjazd' as const,
    eventTitle: 'Wyjazd',
    startsAt: new Date('2026-10-14T08:00:00Z'),
    endsAt: new Date('2026-10-14T09:00:00Z'),
  };

  it('a lecturer plan gets Test badges but no event blocks', () => {
    const out = annotatePlanWeek([lab], [test, trip], [], { lecturerId: 8 });
    expect(out.map((s) => `${s.type}:${s.id}`)).toEqual(['class:10']);
    expect(out[0].badges?.[0]).toMatchObject({ kind: 'test', eventIds: [20] });
  });

  it('a subject plan keeps the unmatched events of that subject, sorted by time', () => {
    const other = { ...trip, id: 22, subjectId: 6 };
    const out = annotatePlanWeek([lab], [test, trip, other], [], {
      subjectId: 5,
    });
    expect(out.map((s) => `${s.type}:${s.id}`)).toEqual([
      'event:21',
      'class:10',
    ]);
  });
});
