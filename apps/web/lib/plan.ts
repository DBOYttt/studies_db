/**
 * Pure, client-safe helpers of the Plan zajęć screen: ISO weeks, the day grid
 * layout and the "Moje grupy" filter.
 *
 * Session times are Europe/Warsaw WALL time carried in "wall Dates" (a Date
 * whose UTC fields equal the wall clock). Everything here reads/writes UTC
 * fields only; never format these with `timeZone: 'Europe/Warsaw'`.
 */
import {
  type IsoWeek,
  isoWeekOf,
  type PlanSession,
  weekStart,
} from '@studies/db/plan';

export type { MyGroups } from '@studies/db';
export {
  filterMyGroups,
  formatIsoWeek,
  type IsoWeek,
  isoWeekOf,
  nowWall,
  type PlanSession,
  parseIsoWeek,
  parseMyGroups,
  sanitizeMyGroups,
  shiftWeek,
  type ValidGroups,
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

/** Day grid: 07:00–20:00 in 15-minute rows. */
export const DAY_START_MIN = 420;
export const DAY_END_MIN = 1200;
export const SLOT_MIN = 15;
const DAY_MS = 86_400_000;
const SLOTS = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;

/**
 * Grid rows [from, to) of a session, rounded outwards to whole slots and
 * clamped to the day window; always at least one row (to > from).
 */
export function slotRange(s: PlanSession): { from: number; to: number } {
  const startMin = s.startsAt.getUTCHours() * 60 + s.startsAt.getUTCMinutes();
  const endMin =
    startMin + (s.endsAt.getTime() - s.startsAt.getTime()) / 60_000;
  const clamp = (n: number, lo: number, hi: number) =>
    Math.min(Math.max(n, lo), hi);
  const from = clamp(
    Math.floor((startMin - DAY_START_MIN) / SLOT_MIN),
    0,
    SLOTS - 1,
  );
  const to = clamp(
    Math.ceil((endMin - DAY_START_MIN) / SLOT_MIN),
    from + 1,
    SLOTS,
  );
  return { from, to };
}

/**
 * Side-by-side placement of one day's sessions. Overlap is judged on grid
 * rows (what is drawn), sessions that overlap transitively form a cluster
 * sharing `cols` columns, and each takes the first free column (earlier
 * start first, longer first on ties). Output is in that order.
 */
export function layoutDay(
  sessions: PlanSession[],
): { session: PlanSession; col: number; cols: number }[] {
  const items = sessions
    .map((session) => ({ session, ...slotRange(session) }))
    .sort(
      (a, b) =>
        a.from - b.from ||
        b.to - a.to ||
        a.session.startsAt.getTime() - b.session.startsAt.getTime() ||
        a.session.id - b.session.id,
    );
  const out: { session: PlanSession; col: number; cols: number }[] = [];
  let cluster: typeof out = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const x of cluster) x.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const it of items) {
    if (it.from >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.from);
    if (col < 0) col = colEnds.length;
    colEnds[col] = it.to;
    clusterEnd = Math.max(clusterEnd, it.to);
    cluster.push({ session: it.session, col, cols: 0 });
  }
  flush();
  return out;
}

/** Wall midnights of Mon–Fri, plus Sat/Sun only when a session falls on them. */
export function weekDays(sessions: PlanSession[], w: IsoWeek): Date[] {
  const mon = weekStart(w).getTime();
  const used = new Set(
    sessions.map((s) => Math.floor((s.startsAt.getTime() - mon) / DAY_MS)),
  );
  return [0, 1, 2, 3, 4, 5, 6]
    .filter((d) => d < 5 || used.has(d))
    .map((d) => new Date(mon + d * DAY_MS));
}
