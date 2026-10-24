/**
 * "Pick a session" of the event form: the upcoming confirmed class sessions
 * of a class (and group), on the read-only pool (`v_class_sessions`). Times
 * are wall Dates (Europe/Warsaw wall clock in the UTC fields, see
 * lib/plan.ts).
 */
import { toWall, wallSql } from '@studies/db/plan';
import type mysql from 'mysql2/promise';
import { wallDateKey, wallShortDate, wallTime } from './plan-view';

export type SessionOption = {
  /** Session id. */
  value: string;
  /** `Wed 21 Oct, 10:00–11:30 · B-2 202`. */
  label: string;
  /** `YYYY-MM-DD`, `HH:MM`, `HH:MM`: what the form's When fields take. */
  date: string;
  from: string;
  to: string;
  room: string | null;
};

const COLUMNS =
  'cs.id, cs.starts_at, cs.ends_at, cs.subject_id, cs.class_id, cs.group_id, cs.group_name, cs.room';

/** Only sessions a Test can be on (the badge rule of matchEventsToSessions). */
const BOOKABLE = "cs.status = 'confirmed' AND cs.kind = 'class'";

function toOption(r: mysql.RowDataPacket, withGroup: boolean): SessionOption {
  const start = toWall(r.starts_at);
  const end = toWall(r.ends_at);
  const room = r.room == null || r.room === '' ? null : String(r.room);
  const parts = [
    `${wallShortDate(start)}, ${wallTime(start)}–${wallTime(end)}`,
  ];
  if (room) parts.push(room);
  if (withGroup && r.group_name != null) parts.push(String(r.group_name));
  return {
    value: String(r.id),
    label: parts.join(' · '),
    date: wallDateKey(start),
    from: wallTime(start),
    to: wallTime(end),
    room,
  };
}

/**
 * The next `limit` confirmed class sessions of the class starting at or
 * after `fromWall`. With a group: that group's sessions and the whole-class
 * ones; without: every group's, labelled with the group name.
 */
export async function upcomingSessionOptions(
  pool: mysql.Pool,
  classId: number,
  groupId: number | null,
  fromWall: Date,
  limit = 20,
): Promise<SessionOption[]> {
  const params: (string | number)[] = [classId, wallSql(fromWall)];
  let group = '';
  if (groupId !== null) {
    group = 'AND (cs.group_id = ? OR cs.group_id IS NULL)';
    params.push(groupId);
  }
  params.push(Math.max(1, Math.trunc(limit)));
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ${COLUMNS}
       FROM v_class_sessions cs
      WHERE cs.class_id = ? AND cs.starts_at >= ? AND ${BOOKABLE} ${group}
      ORDER BY cs.starts_at, cs.ends_at, cs.id
      LIMIT ?`,
    params,
  );
  return rows.map((r) => toOption(r, groupId === null));
}

/** One session for `?session=<id>` (also a past one), or null if not bookable. */
export async function getSessionOption(
  pool: mysql.Pool,
  sessionId: number,
): Promise<
  | (SessionOption & {
      subjectId: number;
      classId: number;
      groupId: number | null;
    })
  | null
> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ${COLUMNS}
       FROM v_class_sessions cs
      WHERE cs.id = ? AND cs.class_id IS NOT NULL AND ${BOOKABLE}`,
    [sessionId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...toOption(r, false),
    subjectId: Number(r.subject_id),
    classId: Number(r.class_id),
    groupId: r.group_id == null ? null : Number(r.group_id),
  };
}

/**
 * The event form fields a picked session fills: date, times and place (a
 * session without a room empties the place rather than keeping an old one).
 */
export const sessionFormFields = (
  o: Pick<SessionOption, 'date' | 'from' | 'to' | 'room'>,
): { date: string; start: string; end: string; place: string } => ({
  date: o.date,
  start: o.from,
  end: o.to,
  place: o.room ?? '',
});
