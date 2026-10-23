/**
 * Event reminders: per-user preferences, the send log and the selection of
 * what is due now. The bot's tick calls `dueDms` / `dueDigest`, sends, then
 * `markSent`. All times are wall-clock Warsaw (UTC fields = local); nothing
 * here converts time zones.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type mysql from 'mysql2/promise';
import { writeAudit } from './audit.js';
import type { Db } from './client.js';
import { listEventsInRange } from './events.js';
import {
  annotateWeek,
  filterMyGroups,
  isoWeekOf,
  listWeekMarks,
  listWeekSessionRows,
  type PlanSession,
  type ValidGroups,
} from './plan.js';
import {
  classGroups,
  reminderLog,
  reminderPrefs,
  userGroups,
  users,
} from './schema.js';

export type ReminderKind = 'day' | 'hour' | 'digest';
export type ReminderSource = 'web' | 'discord';
export type ReminderPrefs = {
  dayBefore: boolean;
  hourBefore: boolean;
  disabledReason: string | null;
};
export type DueDm = {
  userId: number;
  discordUserId: string;
  event: PlanSession;
  kind: 'day' | 'hour';
};
export type SentEntry = {
  eventId: number;
  /** 0 = the channel digest. */
  userId: number;
  kind: ReminderKind;
  forStartsAt: Date;
};

/** `reminder_log.user_id` of channel digest rows. */
export const DIGEST_USER_ID = 0;
export const DM_DISABLED_REASON = 'DMs closed';
/** A reminder missed by no more than this is still sent. */
export const CATCH_UP_MS = 30 * 60_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** The "day before" reminder of an all-day event: 18:00 the previous day. */
const ALL_DAY_DAY_OFFSET = 6 * HOUR;

export async function getReminderPrefs(
  db: Db,
  userId: number,
): Promise<ReminderPrefs> {
  const [row] = await db
    .select({
      dayBefore: reminderPrefs.dayBefore,
      hourBefore: reminderPrefs.hourBefore,
      disabledReason: reminderPrefs.disabledReason,
    })
    .from(reminderPrefs)
    .where(eq(reminderPrefs.userId, userId));
  return row ?? { dayBefore: false, hourBefore: false, disabledReason: null };
}

/** Saves the toggles, clears `disabled_reason` and audits `reminders.update`. */
export async function setReminderPrefs(
  db: Db,
  userId: number,
  prefs: { dayBefore: boolean; hourBefore: boolean },
  source: ReminderSource,
): Promise<void> {
  await db.transaction(async (tx) => {
    const set = {
      dayBefore: prefs.dayBefore,
      hourBefore: prefs.hourBefore,
      disabledReason: null,
    };
    await tx
      .insert(reminderPrefs)
      .values({ userId, ...set })
      .onDuplicateKeyUpdate({ set });
    await writeAudit(tx, {
      userId,
      action: 'reminders.update',
      target: String(userId),
      details: {
        source,
        dayBefore: prefs.dayBefore,
        hourBefore: prefs.hourBefore,
      },
    });
  });
}

/** Turns both reminders off and records why (for example closed DMs). */
export async function disableReminders(
  db: Db,
  userId: number,
  reason: string,
): Promise<void> {
  const set = { dayBefore: false, hourBefore: false, disabledReason: reason };
  await db
    .insert(reminderPrefs)
    .values({ userId, ...set })
    .onDuplicateKeyUpdate({ set });
}

/** INSERT IGNORE: entries already logged for that `for_starts_at` are kept. */
export async function markSent(db: Db, entries: SentEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db
    .insert(reminderLog)
    .ignore()
    .values(
      entries.map((e) => ({
        eventId: e.eventId,
        userId: e.userId,
        kind: e.kind,
        forStartsAt: e.forStartsAt,
      })),
    );
}

/** When the reminder of this kind becomes due; null when the kind doesn't apply. */
function windowStart(e: PlanSession, kind: 'day' | 'hour'): number | null {
  const start = e.startsAt.getTime();
  if (kind === 'day') {
    return e.allDay ? start - ALL_DAY_DAY_OFFSET : start - DAY;
  }
  return e.allDay ? null : start - HOUR;
}

const logKey = (eventId: number, userId: number, kind: string, t: Date) =>
  `${eventId}:${userId}:${kind}:${t.getTime()}`;

async function loggedKeys(
  db: Db,
  eventIds: number[],
  kinds: ReminderKind[],
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const rows = await db
    .select({
      eventId: reminderLog.eventId,
      userId: reminderLog.userId,
      kind: reminderLog.kind,
      forStartsAt: reminderLog.forStartsAt,
    })
    .from(reminderLog)
    .where(
      and(
        inArray(reminderLog.eventId, eventIds),
        inArray(reminderLog.kind, kinds),
      ),
    );
  return new Set(
    rows.map((r) => logKey(r.eventId, r.userId, r.kind, r.forStartsAt)),
  );
}

/**
 * DMs due at `nowWall_`: events whose window start (24 h / 1 h before, or 18:00
 * the day before for all-day events, which get no hour reminder) lies within
 * the last 30 minutes and that are not yet logged for their current start.
 * Moje grupy applies (stale picks ignored; no picks = no filtering). Banned
 * and opted-out users are skipped.
 */
export async function dueDms(
  db: Db,
  pool: mysql.Pool,
  nowWall_: Date,
): Promise<DueDm[]> {
  const now = nowWall_.getTime();
  const candidates = await listEventsInRange(
    pool,
    new Date(now),
    new Date(now + DAY + MIN),
  );
  type Hit = { event: PlanSession; kind: 'day' | 'hour' };
  const hits: Hit[] = [];
  for (const event of candidates) {
    for (const kind of ['day', 'hour'] as const) {
      const ws = windowStart(event, kind);
      if (ws !== null && ws <= now && now - ws <= CATCH_UP_MS) {
        hits.push({ event, kind });
      }
    }
  }
  if (hits.length === 0) return [];

  const recipients = await db
    .select({
      userId: users.id,
      discordUserId: users.discordUserId,
      dayBefore: reminderPrefs.dayBefore,
      hourBefore: reminderPrefs.hourBefore,
    })
    .from(reminderPrefs)
    .innerJoin(users, eq(users.id, reminderPrefs.userId))
    .where(eq(users.isBanned, false));
  const active = recipients.filter((r) => r.dayBefore || r.hourBefore);
  if (active.length === 0) return [];

  const logged = await loggedKeys(
    db,
    [...new Set(hits.map((h) => h.event.id))],
    ['day', 'hour'],
  );
  const pickRows = await db
    .select({
      userId: userGroups.userId,
      classId: userGroups.classId,
      groupId: userGroups.groupId,
    })
    .from(userGroups)
    .where(
      inArray(
        userGroups.userId,
        active.map((r) => r.userId),
      ),
    );
  const picks = new Map<number, Record<string, number>>();
  for (const p of pickRows) {
    const m = picks.get(p.userId) ?? {};
    m[String(p.classId)] = p.groupId;
    picks.set(p.userId, m);
  }
  const valid: ValidGroups = {};
  for (const g of await db
    .select({ id: classGroups.id, classId: classGroups.classId })
    .from(classGroups)) {
    const key = String(g.classId);
    valid[key] = [...(valid[key] ?? []), g.id];
  }

  const out: DueDm[] = [];
  for (const u of active) {
    const mine = picks.get(u.userId) ?? {};
    for (const { event, kind } of hits) {
      if (kind === 'day' ? !u.dayBefore : !u.hourBefore) continue;
      if (logged.has(logKey(event.id, u.userId, kind, event.startsAt)))
        continue;
      if (filterMyGroups([event], mine, valid).length === 0) continue;
      out.push({
        userId: u.userId,
        discordUserId: u.discordUserId,
        event,
        kind,
      });
    }
  }
  return out;
}

/**
 * Wall midnight of tomorrow while the digest is due (18:00–18:30), else null.
 */
export function digestDay(nowWall_: Date): Date | null {
  const minutes = nowWall_.getUTCHours() * 60 + nowWall_.getUTCMinutes();
  if (minutes < 18 * 60 || minutes >= 18 * 60 + 30) return null;
  return new Date(
    Date.UTC(
      nowWall_.getUTCFullYear(),
      nowWall_.getUTCMonth(),
      nowWall_.getUTCDate() + 1,
    ),
  );
}

/**
 * Tomorrow's events for the channel digest: only from 18:00 to 18:30, and only
 * those without a digest row for their current start (so an event added later
 * the same evening still gets announced).
 */
export async function dueDigest(
  pool: mysql.Pool,
  nowWall_: Date,
): Promise<PlanSession[]> {
  const tomorrow = digestDay(nowWall_);
  if (!tomorrow) return [];
  const list = await listEventsInRange(
    pool,
    tomorrow,
    new Date(tomorrow.getTime() + DAY),
  );
  if (list.length === 0) return [];
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT event_id, DATE_FORMAT(for_starts_at, '%Y-%m-%d %H:%i:%s') AS t
       FROM reminder_log
      WHERE kind = 'digest' AND user_id = ? AND event_id IN (?)`,
    [DIGEST_USER_ID, list.map((e) => e.id)],
  );
  const logged = new Set(rows.map((r) => `${r.event_id}:${r.t}`));
  const wall = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  return list.filter((e) => !logged.has(`${e.id}:${wall(e.startsAt)}`));
}

/** Forgets the "DMs closed" note once it has been shown; prefs stay as they are. */
export async function clearDisabledReason(
  db: Db,
  userId: number,
): Promise<void> {
  await db
    .update(reminderPrefs)
    .set({ disabledReason: null })
    .where(eq(reminderPrefs.userId, userId));
}

export type DueEntryQuiz = {
  subjectName: string;
  className: string;
  /** null: a session of the whole class. */
  groupName: string | null;
};

/**
 * Tomorrow's entry quizzes for the channel digest (18:00–18:30 only, else
 * empty): the confirmed class sessions that carry the Entry quiz badge, one
 * entry per class and group, in order of their first session. Whether they
 * were already posted is the caller's (bot setting `digest_quiz_date`).
 */
export async function dueEntryQuizzes(
  pool: mysql.Pool,
  nowWall_: Date,
): Promise<DueEntryQuiz[]> {
  const tomorrow = digestDay(nowWall_);
  if (!tomorrow) return [];
  const key = tomorrow.toISOString().slice(0, 10);
  const sessions = (
    await listWeekSessionRows(pool, isoWeekOf(tomorrow))
  ).filter(
    (s) => s.startsAt.toISOString().slice(0, 10) === key && s.classId !== null,
  );
  if (sessions.length === 0) return [];
  const marks = await listWeekMarks(
    pool,
    sessions.map((s) => s.classId as number),
  );
  if (marks.length === 0) return [];
  const out: DueEntryQuiz[] = [];
  const seen = new Set<string>();
  for (const s of annotateWeek(sessions, marks)) {
    if (!s.badges?.some((b) => b.kind === 'entry_quiz')) continue;
    const k = `${s.classId}:${s.groupId ?? 0}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      subjectName: s.subjectName,
      className: s.className ?? s.label,
      groupName: s.groupName,
    });
  }
  return out;
}
