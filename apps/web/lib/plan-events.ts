/**
 * Pure, client-safe helpers for events in the Plan zajęć: splitting a day
 * into the all-day strip and the hour grid, event links and the short
 * "when" label. Dates are wall Dates (see lib/plan.ts).
 */
import {
  formatIsoWeek,
  type IsoWeek,
  layoutDay,
  type PlanSession,
  weekStart,
} from './plan';
import { wallDateKey, wallTime } from './plan-view';

export const isEvent = (s: Pick<PlanSession, 'type'>) => s.type === 'event';

/** Stable React key / selection key (class and event ids overlap). */
export const sessionKey = (s: Pick<PlanSession, 'type' | 'id'>) =>
  `${s.type}:${s.id}`;

/** Event page of the simple or advanced view. */
export const eventPageHref = (id: number, simple: boolean) =>
  `${simple ? '/s' : ''}/wydarzenia/${id}`;

/**
 * "+ Add event": the form prefilled with today when the shown week contains
 * it, otherwise with the Monday of the shown week; `subject` when the plan is
 * filtered to one subject.
 */
export function newEventHref(
  week: IsoWeek,
  now: Date,
  current: IsoWeek,
  simple: boolean,
  subjectId?: number,
): string {
  const day =
    formatIsoWeek(week) === formatIsoWeek(current) ? now : weekStart(week);
  const q = new URLSearchParams({ date: wallDateKey(day) });
  if (subjectId !== undefined) q.set('subject', String(subjectId));
  return `${simple ? '/s' : ''}/wydarzenia/nowe?${q}`;
}

/** Events of a subject-filtered plan; lecturer-filtered plans have none. */
export function eventsForFilter(
  events: PlanSession[],
  f: { subjectId?: number; lecturerId?: number },
): PlanSession[] {
  if (f.lecturerId !== undefined) return [];
  if (f.subjectId !== undefined)
    return events.filter((e) => e.subjectId === f.subjectId);
  return events;
}

export interface DayColumn<S extends PlanSession> {
  key: string;
  day: Date;
  /** All-day events of the day (the strip above the hours). */
  allDay: S[];
  /** Everything else, laid out in columns by overlap. */
  blocks: { session: S; col: number; cols: number }[];
}

/** Group sessions by wall day: all-day events to the strip, the rest to the grid. */
export function dayColumns<S extends PlanSession>(
  days: Date[],
  sessions: S[],
): DayColumn<S>[] {
  return days.map((day) => {
    const key = wallDateKey(day);
    const of = sessions.filter((s) => wallDateKey(s.startsAt) === key);
    return {
      key,
      day,
      allDay: of.filter((s) => s.allDay),
      blocks: layoutDay(of.filter((s) => !s.allDay)) as DayColumn<S>['blocks'],
    };
  });
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** `Tue 20.10 10:00` (no time for all-day events). */
export function eventWhenShort(s: PlanSession): string {
  const d = s.startsAt;
  const date = `${DOW[d.getUTCDay()]} ${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}`;
  return s.allDay ? date : `${date} ${wallTime(d)}`;
}
