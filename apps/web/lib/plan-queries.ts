/**
 * Plan zajęć queries on the read-only pool (public `v_*` views only). Like
 * entity-queries, the clauses are constants of this module and values are
 * bound as `?`; the returned SQL text has them inlined.
 */
import type { ClassKind } from '@studies/db/constants';
import type mysql from 'mysql2/promise';
import { type GridOpts, pageSql, type SqlPage } from './entity-queries';
import { type IsoWeek, type PlanSession, shiftWeek, weekStart } from './plan';
import { KIND_ORDER } from './queries';
import { quoteString } from './tables';

export interface PlanFilter {
  subjectId?: number;
  lecturerId?: number;
}

/** Wall Date → DATETIME literal (UTC fields are the wall clock). */
const wallSql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function filterWhere(f: PlanFilter, alias: string) {
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

const inline = (sql: string, params: (string | number)[]) => {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    return typeof v === 'number' ? String(v) : quoteString(v);
  });
};

const toWall = (v: unknown): Date =>
  v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

const toPlanSession = (r: mysql.RowDataPacket): PlanSession => ({
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

/** Sessions starting in the week (wall Mon 00:00 <= starts_at < next Mon). */
export async function listWeekSessions(
  pool: mysql.Pool,
  w: IsoWeek,
  f: PlanFilter = {},
): Promise<{ sql: string; rows: PlanSession[] }> {
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
            cs.room, cs.label, cs.status
       FROM v_class_sessions cs
       JOIN v_subjects s ON s.id = cs.subject_id
      WHERE cs.subject_id = ? AND cs.starts_at >= ?
      ORDER BY cs.starts_at, cs.ends_at, cs.id
      LIMIT ?`,
    [subjectId, wallSql(nowWall), Math.max(1, Math.trunc(limit))],
  );
  return rows.map(toPlanSession);
}

/** First and last session start (wall Dates), or null without sessions. */
export async function sessionRange(
  pool: mysql.Pool,
  f: PlanFilter = {},
): Promise<{ first: Date; last: Date } | null> {
  const { where, params } = filterWhere(f, '');
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT MIN(starts_at) AS first, MAX(starts_at) AS last
       FROM v_class_sessions
      WHERE ${where.length ? where.join(' AND ') : 'TRUE'}`,
    params,
  );
  const r = rows[0];
  if (!r || r.first == null) return null;
  return { first: toWall(r.first), last: toWall(r.last) };
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

/** Columns of `v_class_sessions`, in view order (Lista grid). */
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

/** Lista: one page of `v_class_sessions` by start time. */
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
