/**
 * The week the timetable shows and its rows (views pool). Without `?week`
 * the opening week is worked out from the sessions; when that needed the
 * current week's rows and the current week is the one shown, those rows
 * are reused instead of being fetched a second time.
 */
import { listEventsInRange } from '@studies/db';
import type mysql from 'mysql2/promise';
import {
  defaultWeek,
  type IsoWeek,
  isoWeekOf,
  type PlanSession,
  parseIsoWeek,
  shiftWeek,
  weekStart,
} from './plan';
import { eventsForFilter } from './plan-events';
import {
  listWeekSessions,
  type PlanFilter,
  sessionRange,
} from './plan-queries';

export interface PlanWeekRows {
  week: IsoWeek;
  /** The week's class sessions under the filter. */
  classRows: PlanSession[];
  /**
   * The week's events, already limited to the chosen semester (subject-less
   * ones stay); the subject/lecturer filter applies after the annotation.
   */
  events: PlanSession[];
}

const sameWeek = (a: IsoWeek, b: IsoWeek) =>
  a.year === b.year && a.week === b.week;

function loadWeek(
  pool: mysql.Pool,
  week: IsoWeek,
  filter: PlanFilter,
): Promise<PlanWeekRows> {
  return Promise.all([
    listWeekSessions(pool, week, filter),
    listEventsInRange(
      pool,
      weekStart(week),
      weekStart(shiftWeek(week, 1)),
      filter.semester,
    ),
  ]).then(([{ rows }, events]) => ({ week, classRows: rows, events }));
}

/**
 * The week shown without `?week=` (`defaultWeek`): when that is the current
 * week, the ends of its sessions and events (as the plan filter keeps them)
 * decide whether it is already over. Returns the current week's rows when
 * it loaded them.
 */
async function openingWeek(
  pool: mysql.Pool,
  now: Date,
  filter: PlanFilter,
): Promise<{ week: IsoWeek; loaded?: PlanWeekRows }> {
  const range = await sessionRange(pool, filter);
  const current = isoWeekOf(now);
  const week = defaultWeek(now, range);
  if (!sameWeek(week, current)) return { week };
  const loaded = await loadWeek(pool, current, filter);
  const ends = [
    ...loaded.classRows,
    ...eventsForFilter(loaded.events, filter),
  ].map((s) => s.endsAt);
  return { week: defaultWeek(now, range, ends), loaded };
}

/** `?week=` (or the opening week) and its rows. */
export async function loadPlanWeek(
  pool: mysql.Pool,
  rawWeek: string | undefined,
  now: Date,
  filter: PlanFilter,
): Promise<PlanWeekRows> {
  const asked = parseIsoWeek(rawWeek);
  if (asked) return loadWeek(pool, asked, filter);
  const { week, loaded } = await openingWeek(pool, now, filter);
  // Reused only for the very week they were loaded for.
  if (loaded && sameWeek(loaded.week, week)) return loaded;
  return loadWeek(pool, week, filter);
}
