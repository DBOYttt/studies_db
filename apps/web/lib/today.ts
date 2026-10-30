/**
 * "Today" on the start page: the class sessions of the student's Warsaw day
 * under My groups (every group while none is picked), and the next class
 * when the day has none. Fixed queries on the views pool.
 */
import type { DbExecutor } from '@studies/db';
import { toPlanSession, wallSql } from '@studies/db/plan';
import type mysql from 'mysql2/promise';
import { loadMyGroups } from './my-groups-load';
import {
  filterMyGroups,
  type MyGroups,
  nowWall,
  type PlanSession,
} from './plan';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Warsaw day of the instant `now` as wall Dates: [00:00, next 00:00).
 * Wall Dates carry the wall clock in their UTC fields, so the day is always
 * 24 h long there, DST changes included.
 */
export function wallDay(now: Date): { start: Date; end: Date } {
  const w = nowWall(now);
  const start = new Date(
    Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()),
  );
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export interface TodayClasses {
  /** Wall midnight of today. */
  day: Date;
  /** Today's sessions under My groups, cancelled ones included. */
  sessions: PlanSession[];
  /** The next confirmed class when today has none to go to, else null. */
  next: PlanSession | null;
  /** Whether a (still valid) group is picked in My groups. */
  groupsPicked: boolean;
}

const SELECT = `SELECT cs.id, cs.starts_at, cs.ends_at, cs.subject_id,
            cs.subject_name, s.code AS subject_code, cs.class_id,
            cs.class_kind, cs.class_name, cs.group_id, cs.group_name,
            cs.lecturer_id, cs.lecturer_name, cs.room, cs.label, cs.status,
            cs.kind
       FROM v_class_sessions cs
       JOIN v_subjects s ON s.id = cs.subject_id`;

async function sessionsBetween(
  pool: mysql.Pool,
  from: Date,
  to: Date,
): Promise<PlanSession[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `${SELECT}
      WHERE cs.starts_at >= ? AND cs.starts_at < ?
      ORDER BY cs.starts_at, cs.ends_at, cs.id`,
    [wallSql(from), wallSql(to)],
  );
  return rows.map(toPlanSession);
}

/**
 * `filterMyGroups` as SQL: with a pick, sessions without a class or group
 * always pass, others only in a picked (class, group). No pick: no filter.
 */
export function myGroupsWhere(mine: MyGroups): {
  sql: string;
  params: number[];
} {
  const picks = Object.entries(mine);
  if (picks.length === 0) return { sql: 'TRUE', params: [] };
  return {
    sql: `(cs.class_id IS NULL OR cs.group_id IS NULL OR ${picks
      .map(() => '(cs.class_id = ? AND cs.group_id = ?)')
      .join(' OR ')})`,
    params: picks.flatMap(([c, g]) => [Number(c), g]),
  };
}

/**
 * The first confirmed session of My groups from `from` on: a range on the
 * start index read in order, stopped at the first match.
 */
async function nextConfirmed(
  pool: mysql.Pool,
  from: Date,
  mine: MyGroups,
): Promise<PlanSession | null> {
  const g = myGroupsWhere(mine);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `${SELECT}
      WHERE cs.starts_at >= ? AND cs.status = 'confirmed' AND ${g.sql}
      ORDER BY cs.starts_at, cs.ends_at, cs.id
      LIMIT 1`,
    [wallSql(from), ...g.params],
  );
  return rows[0] ? toPlanSession(rows[0]) : null;
}

export async function todayForUser(
  db: DbExecutor,
  pool: mysql.Pool,
  userId: number,
  now: Date,
  /** My groups already being loaded for this request (`loadMyGroups`). */
  opts: { mine?: Promise<MyGroups> } = {},
): Promise<TodayClasses> {
  const { start, end } = wallDay(now);
  const [day, mine] = await Promise.all([
    sessionsBetween(pool, start, end),
    opts.mine ?? loadMyGroups(db, pool, userId),
  ]);
  const sessions = filterMyGroups(day, mine);
  const next = sessions.some((s) => s.status === 'confirmed')
    ? null
    : await nextConfirmed(pool, end, mine);
  return {
    day: start,
    sessions,
    next,
    groupsPicked: Object.keys(mine).length > 0,
  };
}

type SP = Record<string, string | string[] | undefined>;

/**
 * Where the timetable List starts: today 00:00 Warsaw (a wall Date), or
 * null (every session) with `?past=1` ("Show past").
 */
export function listFrom(sp: SP, now: Date): Date | null {
  return sp.past === '1' ? null : wallDay(now).start;
}
