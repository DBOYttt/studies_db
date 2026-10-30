/**
 * Shared plan core: ISO weeks (Europe/Warsaw wall time), the "Moje grupy"
 * filter and the week-sessions query. Used by the web and the bot.
 *
 * Session times are Europe/Warsaw WALL time carried in "wall Dates" (a Date
 * whose UTC fields equal the wall clock). Everything here reads/writes UTC
 * fields only; never format these with `timeZone: 'Europe/Warsaw'`.
 *
 * Keep runtime imports out of this file (client bundles import it through
 * `@studies/db/plan`); mysql2 is used for types only.
 */
import type mysql from 'mysql2/promise';
import { type ClassKind, type EventKind, KIND_ORDER } from './constants.js';
import type { MyGroups } from './my-groups.js';
import type { PlanBadge } from './plan-annotate.js';
import { hasSessionSql } from './plan-marks.js';

export * from './plan-annotate.js';
export * from './plan-marks.js';

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

/* ---------- "Kiedy": event date/time text ---------- */

export type WhenResult =
  | { ok: true; startsAt: Date; endsAt: Date | null; allDay: boolean }
  | { ok: false; message: string };

export const WHEN_FORMAT_MESSAGE =
  'Invalid date format. Use DD.MM[.YYYY] [HH:MM[-HH:MM]], e.g. 20.10 10:00-11:30.';
const WHEN_RE =
  /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?:\s+(\d{1,2}):(\d{2})(?:\s*[-–—]\s*(\d{1,2}):(\d{2}))?)?$/;
const MIN_MS = 60_000;

/**
 * Parses `DD.MM[.RRRR] [HH:MM[-HH:MM]]` (wall clock). `now` is a wall Date
 * (`nowWall()`). Without a year the date nearest to `now` is used (05.01 typed
 * in December is next January; 10.09 typed mid-October is this September, so
 * it is refused as too old rather than moved a year ahead). A date alone is
 * all-day (00:00, no end). Accepted: now − 1 month … now + 1 year.
 */
export function parseWhen(text: string, now: Date): WhenResult {
  const fail = (message: string): WhenResult => ({ ok: false, message });
  const m = WHEN_RE.exec(text.trim());
  if (!m) return fail(WHEN_FORMAT_MESSAGE);
  const day = Number(m[1]);
  const month = Number(m[2]);
  const dateAt = (y: number) => {
    const d = new Date(Date.UTC(y, month - 1, day));
    return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : null;
  };
  const minutes = (h?: string, mi?: string) => {
    if (h === undefined || mi === undefined) return null;
    const hh = Number(h);
    const mm = Number(mi);
    return hh < 24 && mm < 60 ? hh * 60 + mm : Number.NaN;
  };
  const startMin = minutes(m[4], m[5]);
  const endMin = minutes(m[6], m[7]);
  if (Number.isNaN(startMin) || Number.isNaN(endMin)) {
    return fail('Invalid time.');
  }
  const offset = (startMin ?? 0) * MIN_MS;
  let date: Date | null = null;
  if (m[3] !== undefined) {
    date = dateAt(Number(m[3]));
  } else {
    const y = now.getUTCFullYear();
    for (const cand of [y + 1, y, y - 1]) {
      const d = dateAt(cand);
      if (!d) continue;
      const dist = Math.abs(d.getTime() + offset - now.getTime());
      if (!date || dist < Math.abs(date.getTime() + offset - now.getTime())) {
        date = d;
      }
    }
  }
  if (!date) return fail('Invalid date.');
  const startsAt = new Date(date.getTime() + offset);
  let endsAt: Date | null = null;
  if (endMin !== null) {
    endsAt = new Date(date.getTime() + endMin * MIN_MS);
    if (endsAt <= startsAt) return fail('The end must be after the start.');
  }
  const lo = new Date(now);
  lo.setUTCMonth(lo.getUTCMonth() - 1);
  const hi = new Date(now);
  hi.setUTCFullYear(hi.getUTCFullYear() + 1);
  if (startsAt < lo) {
    return fail('The date cannot be more than a month in the past.');
  }
  if (startsAt > hi) {
    return fail('The date cannot be more than a year ahead.');
  }
  return { ok: true, startsAt, endsAt, allDay: startMin === null };
}

/**
 * A class session (`type: 'class'`) or an event (`type: 'event'`). `id` is
 * the row id of its own table, so it is only unique together with `type`.
 *
 * Events: an event without a subject has `subjectId` 0 and empty
 * `subjectName` / `subjectCode`; `room` is the place, `label` the title,
 * `lecturerId`/`lecturerName` are null and `status` is 'confirmed'. An all-day
 * event ends at the next midnight, one without an end time ends at its start.
 */
export interface PlanSession {
  type: 'class' | 'event';
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
  /** Events only. */
  eventKind?: EventKind;
  eventTitle?: string;
  allDay?: boolean;
  /** Class sessions only: 'exam' for exam sessions (missing = 'class'). */
  sessionKind?: 'class' | 'exam';
  /** Set by `annotateWeek`: Test / Entry quiz markers of a class session. */
  badges?: PlanBadge[];
  /** Set by `annotateWeek`: the `egzamin` event merged into this exam session. */
  linkedEventId?: number;
}

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
 * Sessions of my groups. With no saved (valid) group nothing is filtered.
 * Otherwise: anything without a class or group (lectures) and only the picked
 * group of each picked class; sessions with a group in a class without a pick
 * are hidden. Events follow the same rule: one with a group shows only when
 * that group is picked, one without a group always shows. With
 * `validByClass`, stale picks are ignored (so a class whose only pick is
 * stale counts as not picked).
 */
export function filterMyGroups(
  sessions: PlanSession[],
  g: MyGroups,
  validByClass?: ValidGroups,
): PlanSession[] {
  const mineByClass = validByClass ? sanitizeMyGroups(g, validByClass) : g;
  if (Object.keys(mineByClass).length === 0) return sessions;
  return sessions.filter((s) => {
    if (s.classId === null || s.groupId === null) return true;
    return mineByClass[String(s.classId)] === s.groupId;
  });
}

/** How many sessions `filterMyGroups` hides. */
export function hiddenByMyGroups(
  sessions: PlanSession[],
  g: MyGroups,
  validByClass?: ValidGroups,
): number {
  return sessions.length - filterMyGroups(sessions, g, validByClass).length;
}

/* ---------- week grid layout (web WeekView, bot plan image) ---------- */

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

export interface PlanFilter {
  subjectId?: number;
  lecturerId?: number;
  /** Only sessions of subjects in this semester (1-7). */
  semester?: number | null;
}

/** Wall Date → DATETIME literal (UTC fields are the wall clock). */
export const wallSql = (d: Date) =>
  d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * WHERE parts for a plan filter. The semester condition is `s.semester = ?`
 * when the caller joins `v_subjects` under `subjectAlias`, otherwise a
 * subquery on `v_subjects`, so callers reading `v_class_sessions` alone work.
 */
export function filterWhere(
  f: PlanFilter,
  alias: string,
  subjectAlias?: string,
) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.semester != null) {
    where.push(
      subjectAlias
        ? `${subjectAlias}.semester = ?`
        : `${alias}subject_id IN (SELECT id FROM v_subjects WHERE semester = ?)`,
    );
    params.push(f.semester);
  }
  if (f.subjectId !== undefined) {
    where.push(`${alias}subject_id = ?`);
    params.push(f.subjectId);
  }
  if (f.lecturerId !== undefined) {
    where.push(`${alias}lecturer_id = ?`);
    params.push(f.lecturerId);
  }
  return { where, params };
}

export const toWall = (v: unknown): Date =>
  v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

export const toPlanSession = (r: mysql.RowDataPacket): PlanSession => ({
  type: 'class',
  id: Number(r.id),
  startsAt: toWall(r.starts_at),
  endsAt: toWall(r.ends_at),
  subjectId: Number(r.subject_id),
  subjectName: String(r.subject_name),
  subjectCode: String(r.subject_code),
  classId: numOrNull(r.class_id),
  classKind: (r.class_kind ?? null) as ClassKind | null,
  className: strOrNull(r.class_name),
  groupId: numOrNull(r.group_id),
  groupName: strOrNull(r.group_name),
  lecturerId: numOrNull(r.lecturer_id),
  lecturerName: strOrNull(r.lecturer_name),
  room: strOrNull(r.room),
  label: String(r.label ?? ''),
  status: r.status === 'cancelled' ? 'cancelled' : 'confirmed',
  sessionKind: r.kind === 'exam' ? 'exam' : 'class',
});

/** Week-sessions SELECT (v_class_sessions + v_subjects) and its bound values. */
export function weekSessionsQuery(
  w: IsoWeek,
  f: PlanFilter = {},
): { sql: string; params: (string | number)[] } {
  const extra = filterWhere(f, 'cs.', 's');
  const where = ['cs.starts_at >= ?', 'cs.starts_at < ?', ...extra.where];
  const params = [
    wallSql(weekStart(w)),
    wallSql(weekStart(shiftWeek(w, 1))),
    ...extra.params,
  ];
  const sql = [
    'SELECT cs.id, cs.starts_at, cs.ends_at, cs.subject_id, cs.subject_name,',
    '       s.code AS subject_code, cs.class_id, cs.class_kind, cs.class_name,',
    '       cs.group_id, cs.group_name, cs.lecturer_id, cs.lecturer_name,',
    '       cs.room, cs.label, cs.status, cs.kind',
    'FROM v_class_sessions cs',
    'JOIN v_subjects s ON s.id = cs.subject_id',
    `WHERE ${where.join(' AND ')}`,
    'ORDER BY cs.starts_at, cs.ends_at, cs.id',
  ].join('\n');
  return { sql, params };
}

/** All sessions starting in the week, ordered by start. */
export async function listWeekSessionRows(
  pool: mysql.Pool,
  w: IsoWeek,
): Promise<PlanSession[]> {
  const { sql, params } = weekSessionsQuery(w);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(sql, params);
  return rows.map(toPlanSession);
}

export interface MyGroupOption {
  classId: number;
  subjectName: string;
  className: string;
  groups: { id: number; name: string }[];
}

/**
 * Classes that have sessions and groups, with every group of the class (by
 * number), ordered by subject name then class kind. Classes without groups
 * are left out: there is nothing to choose.
 */
export async function listMyGroupOptions(
  pool: mysql.Pool,
  semester?: number | null,
): Promise<MyGroupOption[]> {
  const bySemester = semester == null ? '' : ' AND s.semester = ?';
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT c.id AS class_id, c.kind, c.name AS class_name,
            s.id AS subject_id, s.name AS subject_name,
            g.id AS group_id, g.name AS group_name
       FROM v_classes c
       JOIN v_subjects s ON s.id = c.subject_id
       JOIN v_class_groups g ON g.class_id = c.id
      WHERE ${hasSessionSql('')}${bySemester}
      ORDER BY c.id, g.number`,
    semester == null ? [] : [semester],
  );
  type Row = MyGroupOption & { subjectId: number; order: number };
  const byClass = new Map<number, Row>();
  for (const r of rows) {
    const classId = Number(r.class_id);
    let o = byClass.get(classId);
    if (!o) {
      o = {
        classId,
        subjectName: String(r.subject_name),
        className: String(r.class_name),
        groups: [],
        subjectId: Number(r.subject_id),
        order: KIND_ORDER.indexOf(r.kind as ClassKind),
      };
      byClass.set(classId, o);
    }
    o.groups.push({ id: Number(r.group_id), name: String(r.group_name) });
  }
  return [...byClass.values()]
    .sort(
      (a, b) =>
        a.subjectName.localeCompare(b.subjectName, 'pl') ||
        a.subjectId - b.subjectId ||
        a.order - b.order ||
        a.classId - b.classId,
    )
    .map(({ subjectId: _s, order: _o, ...rest }) => rest);
}
