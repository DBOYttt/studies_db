/**
 * Pure, client-safe helpers of the Plan zajęć screen: ISO weeks, the day grid
 * layout and the "My groups" filter (mostly re-exported from
 * `@studies/db/plan`, which the bot's plan image shares).
 *
 * Session times are Europe/Warsaw WALL time carried in "wall Dates" (a Date
 * whose UTC fields equal the wall clock). Everything here reads/writes UTC
 * fields only; never format these with `timeZone: 'Europe/Warsaw'`.
 */
import {
  type IsoWeek,
  isoWeekOf,
  shiftWeek,
  weekStart,
} from '@studies/db/plan';

export type { MyGroups } from '@studies/db';
export {
  annotateWeek,
  DAY_END_MIN,
  DAY_START_MIN,
  filterMyGroups,
  formatIsoWeek,
  hiddenByMyGroups,
  type IsoWeek,
  isoWeekOf,
  layoutDay,
  nowWall,
  type PlanBadge,
  type PlanSession,
  parseIsoWeek,
  parseMyGroups,
  SLOT_MIN,
  sanitizeMyGroups,
  shiftWeek,
  slotRange,
  type ValidGroups,
  type WeekMark,
  weekDays,
  weekStart,
} from '@studies/db/plan';

/**
 * Week to show without `?week=`: the week of `now` (a wall Date) when it lies
 * within the weeks of [first, last], otherwise the week of `first`; the week
 * of `now` when there are no sessions at all. With `thisWeekEnds` (the wall
 * end times of the current week's sessions and events), a current week where
 * nothing ends after `now` is finished, so the next week opens instead (on a
 * Sunday evening the student sees what is coming, not an empty past week).
 */
export function defaultWeek(
  now: Date,
  range: { first: Date; last: Date } | null,
  thisWeekEnds?: readonly Date[],
): IsoWeek {
  const current = isoWeekOf(now);
  let week = current;
  if (range) {
    const first = isoWeekOf(range.first);
    const t = weekStart(current).getTime();
    const inside =
      t >= weekStart(first).getTime() &&
      t <= weekStart(isoWeekOf(range.last)).getTime();
    if (!inside) week = first;
  }
  if (week !== current || thisWeekEnds === undefined) return week;
  const left = thisWeekEnds.some((end) => end.getTime() > now.getTime());
  return left ? current : shiftWeek(current, 1);
}
