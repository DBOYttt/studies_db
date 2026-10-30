/**
 * Timetable queries on the read-only pool (public `v_*` views only). Like
 * entity-queries, the clauses are constants of this module and values are
 * bound as `?`; the returned SQL text has them inlined.
 */
import {
  filterWhere,
  type IsoWeek,
  listMyGroupOptions,
  type MyGroupOption,
  type PlanFilter,
  type PlanSession,
  toPlanSession,
  toWall,
  wallSql,
  weekSessionsQuery,
} from '@studies/db/plan';
import type mysql from 'mysql2/promise';
import { type GridOpts, pageSql, type SqlPage } from './entity-queries';
import { quoteString } from './tables';

const inline = (sql: string, params: (string | number)[]) => {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    return typeof v === 'number' ? String(v) : quoteString(v);
  });
};

export { listMyGroupOptions, type MyGroupOption, type PlanFilter };

/** Sessions starting in the week (wall Mon 00:00 <= starts_at < next Mon). */
export async function listWeekSessions(
  pool: mysql.Pool,
  w: IsoWeek,
  f: PlanFilter = {},
): Promise<{ sql: string; rows: PlanSession[] }> {
  const { sql, params } = weekSessionsQuery(w, f);
  const [rows] = await pool.query<mysql.RowDataPacket[]>(sql, params);
  return {
    sql: inline(sql, params),
    rows: rows.map(toPlanSession),
  };
}

/** The next `limit` sessions of a subject starting at or after `nowWall`. */
export async function nextSessions(
  pool: mysql.Pool,
  subjectId: number,
  nowWall: Date,
  limit = 3,
): Promise<PlanSession[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT cs.id, cs.starts_at, cs.ends_at, cs.subject_id, cs.subject_name,
            s.code AS subject_code, cs.class_id, cs.class_kind, cs.class_name,
            cs.group_id, cs.group_name, cs.lecturer_id, cs.lecturer_name,
            cs.room, cs.label, cs.status, cs.kind
       FROM v_class_sessions cs
       JOIN v_subjects s ON s.id = cs.subject_id
      WHERE cs.subject_id = ? AND cs.starts_at >= ?
      ORDER BY cs.starts_at, cs.ends_at, cs.id
      LIMIT ?`,
    [subjectId, wallSql(nowWall), Math.max(1, Math.trunc(limit))],
  );
  return rows.map(toPlanSession);
}

/**
 * First and last session start (wall Dates), or null without sessions.
 * Unfiltered, each end is one ORDER BY … LIMIT 1 read from
 * `idx_class_sessions_starts`: MIN/MAX over the view's join would scan
 * every session (`studies_ro` cannot read the base table).
 */
export async function sessionRange(
  pool: mysql.Pool,
  f: PlanFilter = {},
): Promise<{ first: Date; last: Date } | null> {
  const { where, params } = filterWhere(f, '');
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    where.length
      ? `SELECT MIN(starts_at) AS first, MAX(starts_at) AS last
           FROM v_class_sessions
          WHERE ${where.join(' AND ')}`
      : `SELECT (SELECT starts_at FROM v_class_sessions
                  ORDER BY starts_at LIMIT 1) AS first,
                (SELECT starts_at FROM v_class_sessions
                  ORDER BY starts_at DESC LIMIT 1) AS last`,
    params,
  );
  const r = rows[0];
  if (!r || r.first == null) return null;
  return { first: toWall(r.first), last: toWall(r.last) };
}

/** Columns of `v_class_sessions`, in view order (list grid). */
export const SESSION_COLUMNS = [
  'id',
  'starts_at',
  'ends_at',
  'subject_id',
  'subject_name',
  'class_id',
  'class_kind',
  'class_name',
  'group_id',
  'group_name',
  'lecturer_id',
  'lecturer_name',
  'room',
  'label',
  'status',
];

/** List: one page of `v_class_sessions` by start time. */
export function planListPage(
  pool: mysql.Pool,
  o: GridOpts & PlanFilter,
): Promise<SqlPage> {
  const { where, params } = filterWhere(o, '');
  return pageSql(pool, {
    select: SESSION_COLUMNS.join(', '),
    from: 'v_class_sessions',
    where: where.length ? where.join(' AND ') : 'TRUE',
    params,
    orderBy: 'starts_at, id',
    page: o.page,
    perPage: o.perPage,
  });
}
