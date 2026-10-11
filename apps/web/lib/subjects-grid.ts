import { CLASS_KINDS } from '@studies/db/constants';
import type mysql from 'mysql2/promise';

const kindOrder = CLASS_KINDS.map((k) => `'${k}'`).join(', ');

/**
 * The Przedmioty grid query, shown above the grid and run as is on the
 * read-only pool, so the SQL text and the rows always agree. Correlated
 * subqueries (no join fan-out); classes in CLASS_KINDS order.
 */
export const SUBJECTS_SQL = `SELECT s.code, s.name, s.semester, s.ects,
  (SELECT GROUP_CONCAT(c.name ORDER BY FIELD(c.kind, ${kindOrder}), c.id SEPARATOR ', ')
     FROM \`v_classes\` c WHERE c.subject_id = s.id) AS zajecia,
  (SELECT COUNT(*) FROM \`v_files\` f WHERE f.subject_code = s.code) AS pliki,
  (SELECT MAX(f.created_at) FROM \`v_files\` f WHERE f.subject_code = s.code) AS ostatnio
FROM \`v_subjects\` s
ORDER BY s.semester, s.name`;

export const SUBJECTS_COLUMNS = [
  'code',
  'name',
  'semester',
  'ects',
  'zajecia',
  'pliki',
  'ostatnio',
] as const;

export type SubjectGridRow = {
  code: string;
  name: string;
  semester: number;
  ects: number;
  zajecia: string | null;
  pliki: number;
  ostatnio: Date | null;
};

/** Runs SUBJECTS_SQL on the RO pool (throws on connection/query errors). */
export async function querySubjectsGrid(
  pool: mysql.Pool,
): Promise<SubjectGridRow[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(SUBJECTS_SQL);
  return rows.map((r) => ({
    code: String(r.code),
    name: String(r.name),
    semester: Number(r.semester),
    ects: Number(r.ects),
    zajecia: r.zajecia == null ? null : String(r.zajecia),
    pliki: Number(r.pliki),
    ostatnio:
      r.ostatnio instanceof Date
        ? r.ostatnio
        : r.ostatnio == null
          ? null
          : new Date(`${String(r.ostatnio).replace(' ', 'T')}Z`),
  }));
}
