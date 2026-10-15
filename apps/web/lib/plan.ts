/**
 * Pure, client-safe helpers of the Plan zajęć screen: ISO weeks, the day grid
 * layout and the "Moje grupy" filter (mostly re-exported from
 * `@studies/db/plan`, which the bot's plan image shares).
 *
 * Session times are Europe/Warsaw WALL time carried in "wall Dates" (a Date
 * whose UTC fields equal the wall clock). Everything here reads/writes UTC
 * fields only; never format these with `timeZone: 'Europe/Warsaw'`.
 */
import { type IsoWeek, isoWeekOf, weekStart } from '@studies/db/plan';

export type { MyGroups } from '@studies/db';
export {
  DAY_END_MIN,
  DAY_START_MIN,
  filterMyGroups,
  formatIsoWeek,
  type IsoWeek,
  isoWeekOf,
  layoutDay,
  nowWall,
  type PlanSession,
  parseIsoWeek,
  parseMyGroups,
  SLOT_MIN,
  sanitizeMyGroups,
  shiftWeek,
  slotRange,
  type ValidGroups,
  weekDays,
  weekStart,
} from '@studies/db/plan';

/**
 * Week to show without `?week=`: the week of `now` (a wall Date) when it lies
 * within the weeks of [first, last], otherwise the week of `first`; the week
 * of `now` when there are no sessions at all.
 */
export function defaultWeek(
  now: Date,
  range: { first: Date; last: Date } | null,
): IsoWeek {
  const current = isoWeekOf(now);
  if (!range) return current;
  const first = isoWeekOf(range.first);
  const t = weekStart(current).getTime();
  const inside =
    t >= weekStart(first).getTime() &&
    t <= weekStart(isoWeekOf(range.last)).getTime();
  return inside ? current : first;
}
