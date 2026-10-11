import { type ClassKind, groupName } from '@studies/db';
import type mysql from 'mysql2/promise';
import { KIND_ORDER } from './queries';
import { toJsonValue } from './sql-console';
import { quoteString } from './tables';

export interface SqlPage {
  columns: string[];
  rows: unknown[][];
  total: number;
  page: number;
  pageCount: number;
  perPage: number;
  /** The page query as text, values inlined (what the grid shows). */
  sql: string;
}

export interface PageQuery {
  select: string;
  from: string;
  where: string;
  params: (string | number)[];
  orderBy: string;
  page: number;
  perPage: number;
}

/**
 * COUNT, then one page. All clauses are constants written in this module;
 * only `params` carry values (bound as `?`, inlined in the returned `sql`).
 */
export async function pageSql(
  pool: mysql.Pool,
  q: PageQuery,
): Promise<SqlPage> {
  const { perPage } = q;
  const [countRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM ${q.from} WHERE ${q.where}`,
    q.params,
  );
  const total = Number(countRows[0].n);
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const requested = Math.floor(Number(q.page));
  const page = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), pageCount)
    : 1;
  const limit = `LIMIT ${(page - 1) * perPage}, ${perPage}`;
  const [rows, fields] = await pool.query<mysql.RowDataPacket[][]>({
    sql: `SELECT ${q.select} FROM ${q.from} WHERE ${q.where} ORDER BY ${q.orderBy} ${limit}`,
    values: q.params,
    rowsAsArray: true,
  });
  let i = 0;
  const where = q.where.replace(/\?/g, () => {
    const v = q.params[i++];
    return typeof v === 'number' ? String(v) : quoteString(v);
  });
  return {
    columns: fields.map((f) => f.name),
    rows: rows.map((r) => (r as unknown[]).map(toJsonValue)),
    total,
    page,
    pageCount,
    perPage,
    sql: `SELECT ${q.select}\nFROM ${q.from}\nWHERE ${where}\nORDER BY ${q.orderBy}\n${limit}`,
  };
}

export const FILE_COLUMNS = [
  'material_id',
  'filename',
  'subject_name',
  'class_name',
  'group_name',
  'topic_title',
  'uploader',
  'created_at',
  'status',
  'preview_kind',
  'subject_id',
  'class_id',
  'group_id',
  'topic_id',
  'uploader_id',
];

export interface GridOpts {
  page: number;
  perPage: number;
  sort?: string;
  dir?: string;
}

/** Sortable file grid columns (`?sort=`). */
export const FILE_SORTS = [
  'filename',
  'created_at',
  'topic_title',
  'uploader',
  'subject_name',
];
const DEFAULT_FILE_ORDER = 'created_at DESC, material_id DESC';

/** ORDER BY for file grids; unknown sort columns fall back to the default. */
export function fileSort(sort?: string, dir?: string): string {
  if (!sort || !FILE_SORTS.includes(sort)) return DEFAULT_FILE_ORDER;
  return `${sort} ${dir === 'desc' ? 'DESC' : 'ASC'}, material_id DESC`;
}

const TOPIC_SORTS: Record<string, string> = {
  title: 't.title',
  created_at: 't.created_at',
  subject_name: 's.name',
};
/** Sortable topic grid columns (`?sort=`). */
export const TOPIC_SORT_KEYS = Object.keys(TOPIC_SORTS);
function topicSort(sort?: string, dir?: string): string {
  const col = sort ? TOPIC_SORTS[sort] : undefined;
  if (!col) return 't.created_at DESC, t.id DESC';
  return `${col} ${dir === 'desc' ? 'DESC' : 'ASC'}, t.id DESC`;
}

const filesPage = (
  pool: mysql.Pool,
  where: string,
  params: (string | number)[],
  o: GridOpts,
) =>
  pageSql(pool, {
    select: FILE_COLUMNS.join(', '),
    from: 'v_files f',
    where,
    params,
    orderBy: fileSort(o.sort, o.dir),
    page: o.page,
    perPage: o.perPage,
  });

const topicsPage = (
  pool: mysql.Pool,
  where: string,
  params: (string | number)[],
  o: GridOpts,
) =>
  pageSql(pool, {
    select:
      't.id, t.title, s.name AS subject_name, t.class_id, t.group_id, t.created_at, t.subject_id',
    from: 'v_topics t JOIN v_subjects s ON s.id = t.subject_id',
    where,
    params,
    orderBy: topicSort(o.sort, o.dir),
    page: o.page,
    perPage: o.perPage,
  });

async function one<T>(
  pool: mysql.Pool,
  sql: string,
  id: number,
): Promise<T | null> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(sql, [id]);
  return rows.length ? (rows[0] as unknown as T) : null;
}

// ---- lecturers -----------------------------------------------------------

export const getLecturer = (pool: mysql.Pool, id: number) =>
  one<{ id: number; name: string; title: string | null; email: string | null }>(
    pool,
    'SELECT id, name, title, email FROM v_lecturers WHERE id = ?',
    id,
  );

export interface LecturerAssignment {
  subjectCode: string;
  subjectName: string;
  classKind: ClassKind;
  className: string;
  groupNumber: number | null;
  groupName: string | null;
  wholeClass: boolean;
  fileCount: number;
  /** Ids for links. */
  subjectId: number;
  classId: number;
  groupId: number | null;
}

/**
 * Classes a lecturer teaches. A whole-class assignment gives one
 * `wholeClass` row followed by a row per existing group of that class;
 * explicit group assignments give one row each (deduplicated).
 */
export async function listLecturerAssignments(
  pool: mysql.Pool,
  id: number,
): Promise<LecturerAssignment[]> {
  const [assigned] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.id AS subject_id, s.code, s.name AS subject_name,
            c.id AS class_id, c.kind, c.name AS class_name,
            cl.group_id, g.number AS group_number, g.name AS group_name
       FROM v_class_lecturers cl
       JOIN v_classes c ON c.id = cl.class_id
       JOIN v_subjects s ON s.id = c.subject_id
       LEFT JOIN v_class_groups g ON g.id = cl.group_id
      WHERE cl.lecturer_id = ?`,
    [id],
  );
  if (!assigned.length) return [];
  const classIds = [...new Set(assigned.map((r) => Number(r.class_id)))];
  const [groups] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT id, class_id, number, name FROM v_class_groups WHERE class_id IN (?)',
    [classIds],
  );
  const [counts] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT class_id, group_id, COUNT(*) AS n FROM v_files
      WHERE class_id IN (?) GROUP BY class_id, group_id`,
    [classIds],
  );
  const classCount = new Map<number, number>();
  const groupCount = new Map<number, number>();
  for (const r of counts) {
    const n = Number(r.n);
    classCount.set(r.class_id, (classCount.get(r.class_id) ?? 0) + n);
    if (r.group_id !== null) groupCount.set(r.group_id, n);
  }

  type Row = LecturerAssignment & { order: number };
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const r of assigned) {
    const base = {
      subjectCode: String(r.code),
      subjectName: String(r.subject_name),
      classKind: r.kind as ClassKind,
      className: String(r.class_name),
      subjectId: Number(r.subject_id),
      classId: Number(r.class_id),
      order: KIND_ORDER.indexOf(r.kind as ClassKind),
    };
    const push = (
      g: { id: number; number: number; name: string | null } | null,
    ) => {
      const key = `${base.classId}:${g?.id ?? 'all'}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        ...base,
        groupId: g ? g.id : null,
        groupNumber: g ? g.number : null,
        groupName: g ? (g.name ?? groupName(g.number)) : null,
        wholeClass: g === null,
        fileCount: g
          ? (groupCount.get(g.id) ?? 0)
          : (classCount.get(base.classId) ?? 0),
      });
    };
    if (r.group_id === null) {
      push(null);
      for (const g of groups.filter((x) => x.class_id === base.classId)) {
        push({ id: g.id, number: g.number, name: g.name });
      }
    } else {
      push({
        id: r.group_id,
        number: r.group_number,
        name: r.group_name,
      });
    }
  }
  out.sort(
    (a, b) =>
      a.subjectName.localeCompare(b.subjectName, 'pl') ||
      a.subjectId - b.subjectId ||
      a.order - b.order ||
      a.classId - b.classId ||
      (a.groupNumber ?? 0) - (b.groupNumber ?? 0),
  );
  return out.map(({ order: _o, ...rest }) => rest);
}

export const lecturerFiles = (pool: mysql.Pool, id: number, o: GridOpts) =>
  filesPage(
    pool,
    `EXISTS (SELECT 1 FROM v_class_lecturers cl
          WHERE cl.lecturer_id = ?
            AND cl.class_id = f.class_id
            AND (cl.group_id IS NULL OR f.group_id IS NULL
                 OR cl.group_id = f.group_id))`.replace(/\s+/g, ' '),
    [id],
    o,
  );

// ---- users ---------------------------------------------------------------

export const getUser = (pool: mysql.Pool, id: number) =>
  one<{ id: number; display_name: string; created_at: unknown }>(
    pool,
    'SELECT id, display_name, created_at FROM v_users WHERE id = ?',
    id,
  );

export const userFiles = (pool: mysql.Pool, id: number, o: GridOpts) =>
  filesPage(pool, 'f.uploader_id = ?', [id], o);

export const userTopics = (pool: mysql.Pool, id: number, o: GridOpts) =>
  topicsPage(pool, 't.created_by = ?', [id], o);

// ---- tags ----------------------------------------------------------------

export const getTag = (pool: mysql.Pool, id: number) =>
  one<{
    id: number;
    name: string;
    subject_id: number;
    subject_code: string;
    subject_name: string;
  }>(
    pool,
    `SELECT g.id, g.name, g.subject_id, s.code AS subject_code,
            s.name AS subject_name
       FROM v_tags g JOIN v_subjects s ON s.id = g.subject_id
      WHERE g.id = ?`,
    id,
  );

export const tagTopics = (pool: mysql.Pool, id: number, o: GridOpts) =>
  topicsPage(
    pool,
    't.id IN (SELECT topic_id FROM v_topic_tags WHERE tag_id = ?)',
    [id],
    o,
  );

export const tagFiles = (pool: mysql.Pool, id: number, o: GridOpts) =>
  filesPage(
    pool,
    'f.topic_id IN (SELECT topic_id FROM v_topic_tags WHERE tag_id = ?)',
    [id],
    o,
  );
