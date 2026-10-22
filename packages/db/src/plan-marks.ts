/**
 * Read-only loader of the entry-quiz marks for the week annotation. Reads the
 * public views only (`v_class_marks`, `v_class_mark_skips`), so it runs on the
 * `studies_ro` pool of the web as well as on the bot's pool. mysql2 is used
 * for types only.
 */
import type mysql from 'mysql2/promise';
import type { WeekMark } from './plan-annotate.js';

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
