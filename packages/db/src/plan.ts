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
import { type ClassKind, KIND_ORDER } from './constants.js';
import type { MyGroups } from './my-groups.js';

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

export interface PlanFilter {
  subjectId?: number;
  lecturerId?: number;
}

/** Wall Date → DATETIME literal (UTC fields are the wall clock). */
export const wallSql = (d: Date) =>
  d.toISOString().slice(0, 19).replace('T', ' ');

export function filterWhere(f: PlanFilter, alias: string) {
  const where: string[] = [];
  const params: (string | number)[] = [];
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
});

/** Week-sessions SELECT (v_class_sessions + v_subjects) and its bound values. */
export function weekSessionsQuery(
  w: IsoWeek,
  f: PlanFilter = {},
): { sql: string; params: (string | number)[] } {
  const extra = filterWhere(f, 'cs.');
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
    '       cs.room, cs.label, cs.status',
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
): Promise<MyGroupOption[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT c.id AS class_id, c.kind, c.name AS class_name,
            s.id AS subject_id, s.name AS subject_name,
            g.id AS group_id, g.name AS group_name
       FROM v_classes c
       JOIN v_subjects s ON s.id = c.subject_id
       JOIN v_class_groups g ON g.class_id = c.id
      WHERE c.id IN (SELECT class_id FROM v_class_sessions
                      WHERE class_id IS NOT NULL)
      ORDER BY c.id, g.number`,
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
