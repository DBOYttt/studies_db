import { CLASS_KINDS } from '@studies/db/constants';
import type mysql from 'mysql2/promise';

const kindOrder = CLASS_KINDS.map((k) => `'${k}'`).join(', ');

/**
 * The Subjects grid query, shown above the grid and run as is on the
 * read-only pool, so the SQL text and the rows always agree. Correlated
 * subqueries (no join fan-out); classes in CLASS_KINDS order.
 */
const SUBJECTS_SELECT = `SELECT s.code, s.name, s.semester, s.ects,
  (SELECT GROUP_CONCAT(c.name ORDER BY FIELD(c.kind, ${kindOrder}), c.id SEPARATOR ', ')
     FROM \`v_classes\` c WHERE c.subject_id = s.id) AS classes,
  (SELECT COUNT(*) FROM \`v_files\` f WHERE f.subject_code = s.code) AS files,
  (SELECT MAX(f.created_at) FROM \`v_files\` f WHERE f.subject_code = s.code) AS latest
FROM \`v_subjects\` s`;
const SUBJECTS_ORDER = `ORDER BY s.semester, s.name`;

export const SUBJECTS_SQL = `${SUBJECTS_SELECT}
${SUBJECTS_ORDER}`;

/** SUBJECTS_SQL for one semester; the semester is a bound `?`. */
export const SUBJECTS_SEMESTER_SQL = `${SUBJECTS_SELECT}
WHERE s.semester = ?
${SUBJECTS_ORDER}`;

export const SUBJECTS_COLUMNS = [
  'code',
  'name',
  'semester',
  'ects',
  'classes',
  'files',
  'latest',
] as const;

export type SubjectGridRow = {
  code: string;
  name: string;
  semester: number;
  ects: number;
  classes: string | null;
  files: number;
  latest: Date | null;
};

/** Runs SUBJECTS_SQL on the RO pool (throws on connection/query errors). */
export async function querySubjectsGrid(
  pool: mysql.Pool,
  semester?: number | null,
): Promise<SubjectGridRow[]> {
  const [rows] =
    semester == null
      ? await pool.query<mysql.RowDataPacket[]>(SUBJECTS_SQL)
      : await pool.query<mysql.RowDataPacket[]>(SUBJECTS_SEMESTER_SQL, [
          semester,
        ]);
  return rows.map((r) => ({
    code: String(r.code),
    name: String(r.name),
    semester: Number(r.semester),
    ects: Number(r.ects),
    classes: r.classes == null ? null : String(r.classes),
    files: Number(r.files),
    latest:
      r.latest instanceof Date
        ? r.latest
        : r.latest == null
          ? null
          : new Date(`${String(r.latest).replace(' ', 'T')}Z`),
  }));
}
