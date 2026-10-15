import { describe, expect, it } from 'vitest';
import {
  filterMyGroups,
  hiddenByMyGroups,
  isoWeekOf,
  type PlanSession,
} from '../lib/plan';
import {
  dayColumns,
  eventsForFilter,
  eventWhenShort,
  newEventHref,
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
  it('short when label', () => {
    expect(eventWhenShort(base)).toBe('śr 14.10 10:00');
    expect(eventWhenShort({ ...base, allDay: true })).toBe('śr 14.10');
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
