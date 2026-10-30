/**
 * Read-only loader of the entry-quiz marks for the week annotation. Reads the
 * public views only (`v_class_marks`, `v_class_mark_skips`), so it runs on the
 * `studies_ro` pool of the web as well as on the bot's pool. mysql2 is used
 * for types only.
 */
import type mysql from 'mysql2/promise';
import { type ClassKind, KIND_ORDER } from './constants.js';
import type { WeekMark } from './plan-annotate.js';

/**
 * `c` has a session (of `kind`, when given). A scalar subquery with LIMIT 1
 * rather than IN/EXISTS: MariaDB turns those into a semi-join that scans all
 * of `class_sessions`, while this runs as a dependent subquery probing the
 * `class_id` index once per class. It stays on `v_class_sessions` (whose
 * other joins are eliminated), since `studies_ro` reads only the views.
 */
export const hasSessionSql = (kindSql: string) =>
  `(SELECT cs.id FROM v_class_sessions cs
     WHERE cs.class_id = c.id${kindSql} LIMIT 1) IS NOT NULL`;

/** Active entry-quiz marks of the classes, by id, with their skipped dates. */
export async function listWeekMarks(
  pool: mysql.Pool,
  classIds: number[],
): Promise<WeekMark[]> {
  const ids = [...new Set(classIds)].filter((n) => Number.isSafeInteger(n));
  if (ids.length === 0) return [];
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, class_id, group_id, note
       FROM v_class_marks
      WHERE kind = 'wejsciowka' AND class_id IN (?)
      ORDER BY id`,
    [ids],
  );
  if (rows.length === 0) return [];
  const marks = rows.map(
    (r): WeekMark => ({
      id: Number(r.id),
      classId: Number(r.class_id),
      groupId: r.group_id == null ? null : Number(r.group_id),
      note: r.note == null ? null : String(r.note),
      skips: [],
    }),
  );
  const byId = new Map(marks.map((m) => [m.id, m]));
  const [skips] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT mark_id, DATE_FORMAT(on_date, '%Y-%m-%d') AS on_date
       FROM v_class_mark_skips
      WHERE mark_id IN (?)
      ORDER BY mark_id, on_date`,
    [[...byId.keys()]],
  );
  for (const k of skips)
    byId.get(Number(k.mark_id))?.skips.push(String(k.on_date));
  return marks;
}

/** A class an entry quiz can be set on, with its groups (by number). */
export type MarkableClass = {
  classId: number;
  className: string;
  subjectId: number;
  subjectName: string;
  semester: number;
  groups: { id: number; name: string }[];
};

/**
 * Classes with at least one class session (exam sessions have no class),
 * ordered by subject name, then class kind. Classes without groups are kept
 * (the mark then covers the whole class).
 */
export async function listMarkableClasses(
  pool: mysql.Pool,
): Promise<MarkableClass[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT c.id AS class_id, c.kind, c.name AS class_name,
            s.id AS subject_id, s.name AS subject_name, s.semester,
            g.id AS group_id, g.name AS group_name
       FROM v_classes c
       JOIN v_subjects s ON s.id = c.subject_id
       LEFT JOIN v_class_groups g ON g.class_id = c.id
      WHERE ${hasSessionSql(" AND cs.kind = 'class'")}
      ORDER BY c.id, g.number`,
  );
  type Row = MarkableClass & { order: number };
  const byClass = new Map<number, Row>();
  for (const r of rows) {
    const classId = Number(r.class_id);
    let o = byClass.get(classId);
    if (!o) {
      o = {
        classId,
        className: String(r.class_name),
        subjectId: Number(r.subject_id),
        subjectName: String(r.subject_name),
        semester: Number(r.semester),
        groups: [],
        order: KIND_ORDER.indexOf(r.kind as ClassKind),
      };
      byClass.set(classId, o);
    }
    if (r.group_id != null) {
      o.groups.push({ id: Number(r.group_id), name: String(r.group_name) });
    }
  }
  return [...byClass.values()]
    .sort(
      (a, b) =>
        a.subjectName.localeCompare(b.subjectName, 'pl') ||
        a.subjectId - b.subjectId ||
        a.order - b.order ||
        a.classId - b.classId,
    )
    .map(({ order: _o, ...rest }) => rest);
}

/**
 * Dates (`YYYY-MM-DD`) of the next confirmed class sessions of a class from
 * `fromWall` (a wall Date); with a group, that group's sessions only (the
 * dates `skipDate` accepts for a group mark).
 */
export async function upcomingSessionDates(
  pool: mysql.Pool,
  classId: number,
  groupId: number | null,
  fromWall: Date,
  limit: number,
): Promise<string[]> {
  const params: (string | number)[] = [
    classId,
    fromWall.toISOString().slice(0, 19).replace('T', ' '),
  ];
  let group = '';
  if (groupId !== null) {
    group = 'AND group_id = ?';
    params.push(groupId);
  }
  params.push(Math.max(1, Math.trunc(limit)));
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT DISTINCT DATE_FORMAT(starts_at, '%Y-%m-%d') AS d
       FROM v_class_sessions
      WHERE class_id = ? AND starts_at >= ? AND kind = 'class'
        AND status = 'confirmed' ${group}
      ORDER BY d
      LIMIT ?`,
    params,
  );
  return rows.map((r) => String(r.d));
}
