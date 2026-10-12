/**
 * Pure, client-safe helpers of the Plan zajęć screen: ISO weeks, the day grid
 * layout and the "Moje grupy" filter.
 *
 * Session times are Europe/Warsaw WALL time carried in "wall Dates" (a Date
 * whose UTC fields equal the wall clock). Everything here reads/writes UTC
 * fields only; never format these with `timeZone: 'Europe/Warsaw'`.
 */
import type { ClassKind } from '@studies/db/constants';

export type IsoWeek = { year: number; week: number };

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Monday 00:00 of ISO week 1 of `year` (the week containing 4 January). */
function week1Monday(year: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7; // Mon = 0
  return jan4 - dow * DAY_MS;
}

/** ISO week of a wall Date (its UTC calendar date). */
export function isoWeekOf(wall: Date): IsoWeek {
  const day = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
  );
  const dow = (new Date(day).getUTCDay() + 6) % 7;
  // The Thursday of this week decides the ISO year.
  const year = new Date(day + (3 - dow) * DAY_MS).getUTCFullYear();
  const week = Math.floor((day - dow * DAY_MS - week1Monday(year)) / WEEK_MS);
  return { year, week: week + 1 };
}

/** 52 or 53. */
const weeksInYear = (year: number) =>
  isoWeekOf(new Date(Date.UTC(year, 11, 28))).week;

/** `YYYY-Www` with week 1..weeksInYear, otherwise null. */
export function parseIsoWeek(s: string | undefined): IsoWeek | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > weeksInYear(year)) return null;
  return { year, week };
}

export const formatIsoWeek = (w: IsoWeek): string =>
  `${w.year}-W${String(w.week).padStart(2, '0')}`;

/** Wall Monday 00:00 of the week. */
export const weekStart = (w: IsoWeek): Date =>
  new Date(week1Monday(w.year) + (w.week - 1) * WEEK_MS);

export const shiftWeek = (w: IsoWeek, n: number): IsoWeek =>
  isoWeekOf(new Date(weekStart(w).getTime() + n * WEEK_MS));

const warsawFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The Europe/Warsaw wall clock at `now` (a real instant), as a wall Date. */
export function nowWall(now: Date = new Date()): Date {
  const p: Record<string, number> = {};
  for (const part of warsawFormat.formatToParts(now)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
  );
}

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

export interface PlanSession {
  id: number;
  /** Wall Dates. */
  startsAt: Date;
  endsAt: Date;
  subjectId: number;
  subjectName: string;
  subjectCode: string;
  classId: number | null;
  classKind: ClassKind | null;
  className: string | null;
  groupId: number | null;
  groupName: string | null;
  lecturerId: number | null;
  lecturerName: string | null;
  room: string | null;
  label: string;
  status: 'confirmed' | 'cancelled';
}

/** Day grid: 07:00–20:00 in 15-minute rows. */
export const DAY_START_MIN = 420;
export const DAY_END_MIN = 1200;
export const SLOT_MIN = 15;
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

/** localStorage `studiesdb.myGroups.v1`: `{ "<class_id>": <group_id> }`. */
export type MyGroups = Record<string, number>;

const isId = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/** Stored "my groups"; garbage → {}, entries without numeric ids dropped. */
export function parseMyGroups(raw: string | null): MyGroups {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: MyGroups = {};
  for (const [k, v] of Object.entries(data)) {
    if (/^[1-9]\d*$/.test(k) && isId(v)) out[k] = v;
  }
  return out;
}

/** Valid group ids per class id (as listed by the server). */
export type ValidGroups = Record<string, number[]>;

/**
 * Drops entries whose class is listed in `validByClass` but whose group is no
 * longer one of its groups; classes not listed are kept as-is.
 */
export function sanitizeMyGroups(
  g: MyGroups,
  validByClass: ValidGroups,
): MyGroups {
  const out: MyGroups = {};
  for (const [k, v] of Object.entries(g)) {
    const valid = validByClass[k];
    if (valid === undefined || valid.includes(v)) out[k] = v;
  }
  return out;
}

/**
 * Sessions of my groups: anything without a class or group (lectures),
 * classes with no (valid) choice made, and sessions of the chosen group.
 * With `validByClass`, stale choices are ignored.
 */
export function filterMyGroups(
  sessions: PlanSession[],
  g: MyGroups,
  validByClass?: ValidGroups,
): PlanSession[] {
  const mineByClass = validByClass ? sanitizeMyGroups(g, validByClass) : g;
  return sessions.filter((s) => {
    if (s.classId === null || s.groupId === null) return true;
    const mine = mineByClass[String(s.classId)];
    return mine === undefined || mine === s.groupId;
  });
}
