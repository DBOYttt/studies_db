/**
 * Shared event logic (web and bot): validation, add/edit/delete/restore,
 * links to forum posts, materials and the plan listing. Every mutation
 * returns an `ActionResult`, writes one `admin_audit` row (details carry the
 * `source`) and, when the Discord post must change, queues a bot request.
 * Messages are Polish and identical on both surfaces. Times are wall-clock
 * Warsaw time (UTC fields = local), never converted.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type mysql from 'mysql2/promise';
import type { ActionResult } from './admin-actions.js';
import { writeAudit } from './audit.js';
import { enqueueBotRequest } from './bot-requests.js';
import type { Db, DbExecutor } from './client.js';
import { EVENT_KINDS, type EventKind } from './constants.js';
import { nowWall, type PlanSession, parseWhen, toWall } from './plan.js';
import {
  classes,
  classGroups,
  events,
  eventTopics,
  materials,
  subjects,
  topics,
  users,
} from './schema.js';

export type EventSource = 'web' | 'discord';

export type EventInput = {
  kind: EventKind;
  title: string;
  subjectId: number | null;
  classId?: number | null;
  groupId?: number | null;
  /** "Kiedy": `DD.MM[.RRRR] [HH:MM[-HH:MM]]`. */
  when: string;
  place?: string | null;
  note?: string | null;
};

export const BANNED_MESSAGE = 'Twój dostęp do strony jest zablokowany.';
export const MAX_EVENTS_PER_HOUR = 10;
export const MAX_EVENT_LINKS = 20;
const TITLE_MAX = 100;
const PLACE_MAX = 100;
const NOTE_MAX = 1000;

const refused = (message: string): ActionResult => ({ ok: false, message });
const NOT_FOUND = 'Nie znaleziono wydarzenia.';

/** The validated, normalised fields of an event. */
type Fields = {
  kind: EventKind;
  title: string;
  subjectId: number | null;
  classId: number | null;
  groupId: number | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  place: string | null;
  note: string | null;
};

const blankToNull = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};

/**
 * Validates an input and resolves it to `Fields`. Group alone fills in its
 * class. `now` is a wall Date.
 */
export async function validateEvent(
  db: DbExecutor,
  i: EventInput,
  now: Date = nowWall(),
): Promise<{ ok: true; fields: Fields } | { ok: false; message: string }> {
  const bad = (message: string) => ({ ok: false as const, message });
  const title = (i.title ?? '').trim();
  if (title.length < 1 || title.length > TITLE_MAX) {
    return bad('Tytuł musi mieć od 1 do 100 znaków.');
  }
  if (!EVENT_KINDS[i.kind]) return bad('Nieznany rodzaj wydarzenia.');
  const place = blankToNull(i.place);
  if (place && place.length > PLACE_MAX) {
    return bad('Miejsce może mieć najwyżej 100 znaków.');
  }
  const note = blankToNull(i.note);
  if (note && note.length > NOTE_MAX) {
    return bad('Notatka może mieć najwyżej 1000 znaków.');
  }
  const when = parseWhen(i.when ?? '', now);
  if (!when.ok) return bad(when.message);

  let classId = i.classId ?? null;
  const groupId = i.groupId ?? null;
  const subjectId = i.subjectId ?? null;
  if (subjectId === null) {
    if (classId !== null || groupId !== null) {
      return bad('Zajęcia i grupę można wybrać tylko z przedmiotem.');
    }
  } else {
    const [s] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, subjectId));
    if (!s) return bad('Nie znaleziono przedmiotu.');
    if (groupId !== null) {
      const [g] = await db
        .select({ classId: classGroups.classId })
        .from(classGroups)
        .where(eq(classGroups.id, groupId));
      if (!g) return bad('Nie znaleziono grupy.');
      if (classId !== null && classId !== g.classId) {
        return bad('Wybrana grupa nie należy do tych zajęć.');
      }
      classId = g.classId;
    }
    if (classId !== null) {
      const [c] = await db
        .select({ subjectId: classes.subjectId })
        .from(classes)
        .where(eq(classes.id, classId));
      if (!c || c.subjectId !== subjectId) {
        return bad('Wybrane zajęcia nie należą do tego przedmiotu.');
      }
    }
  }
  return {
    ok: true,
    fields: {
      kind: i.kind,
      title,
      subjectId,
      classId,
      groupId,
      startsAt: when.startsAt,
      endsAt: when.endsAt,
      allDay: when.allDay,
      place,
      note,
    },
  };
}

/** Null when the user may write, else the refusal. */
async function checkUser(
  db: DbExecutor,
  userId: number,
): Promise<{ isAdmin: boolean } | ActionResult> {
  const [u] = await db
    .select({ banned: users.isBanned, admin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId));
  if (!u) return refused('Nie znaleziono użytkownika.');
  if (u.banned) return refused(BANNED_MESSAGE);
  return { isAdmin: u.admin };
}
const isRefusal = (x: { isAdmin: boolean } | ActionResult): x is ActionResult =>
  'ok' in x;

const jsonFields = (f: Fields) => ({
  ...f,
  startsAt: f.startsAt.toISOString(),
  endsAt: f.endsAt?.toISOString() ?? null,
});

const upsert = (db: DbExecutor, eventId: number) =>
  enqueueBotRequest(db, 'event_post_upsert', `event:${eventId}`);

export async function addEvent(
  db: Db,
  userId: number,
  input: EventInput,
  source: EventSource,
): Promise<ActionResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return user;
  const v = await validateEvent(db, input);
  if (!v.ok) return refused(v.message);
  return db.transaction(async (tx) => {
    // Rate limit: this user's recent adds, counted from the audit log.
    const [r] = (await tx.execute(sql`
      SELECT COUNT(*) AS n FROM admin_audit
       WHERE user_id = ${userId} AND action = 'event.add'
         AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`)) as unknown as [
      { n: number | string }[],
    ];
    if (Number(r[0].n) >= MAX_EVENTS_PER_HOUR) {
      return refused(
        `Możesz dodać najwyżej ${MAX_EVENTS_PER_HOUR} wydarzeń na godzinę. Spróbuj później.`,
      );
    }
    const f = v.fields;
    const [res] = await tx
      .insert(events)
      .values({ ...f, createdBy: userId, updatedBy: userId });
    const id = res.insertId;
    await writeAudit(tx, {
      userId,
      action: 'event.add',
      target: String(id),
      details: { source, fields: jsonFields(f) },
    });
    await upsert(tx, id);
    return { ok: true, message: 'Dodano wydarzenie.', id };
  });
}

const FIELD_KEYS = [
  'kind',
  'title',
  'subjectId',
  'classId',
  'groupId',
  'startsAt',
  'endsAt',
  'allDay',
  'place',
  'note',
] as const;

const same = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date
    ? a.getTime() === b.getTime()
    : a === b;

const asInput = (patch: Partial<EventInput>, cur: Fields, when: string) => {
  const subjectChanged =
    patch.subjectId !== undefined && patch.subjectId !== cur.subjectId;
  return {
    kind: patch.kind ?? cur.kind,
    title: patch.title ?? cur.title,
    subjectId: patch.subjectId === undefined ? cur.subjectId : patch.subjectId,
    // Moving to another subject drops the class/group unless given anew.
    classId:
      patch.classId !== undefined
        ? patch.classId
        : subjectChanged
          ? null
          : cur.classId,
    groupId:
      patch.groupId !== undefined
        ? patch.groupId
        : subjectChanged || patch.classId !== undefined
          ? null
          : cur.groupId,
    when,
    place: patch.place === undefined ? cur.place : patch.place,
    note: patch.note === undefined ? cur.note : patch.note,
  } satisfies EventInput;
};

const pad = (n: number) => String(n).padStart(2, '0');
/** The "Kiedy" text of stored times, to re-validate an event unchanged. */
function whenText(f: Fields): string {
  const s = f.startsAt;
  const date = `${pad(s.getUTCDate())}.${pad(s.getUTCMonth() + 1)}.${s.getUTCFullYear()}`;
  if (f.allDay) return date;
  const t = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${date} ${t(s)}${f.endsAt ? `-${t(f.endsAt)}` : ''}`;
}

export async function editEvent(
  db: Db,
  userId: number,
  eventId: number,
  patch: Partial<EventInput>,
  source: EventSource,
): Promise<ActionResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return user;
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)));
  if (!row) return refused(NOT_FOUND);
  const cur: Fields = {
    kind: row.kind,
    title: row.title,
    subjectId: row.subjectId,
    classId: row.classId,
    groupId: row.groupId,
    startsAt: toWall(row.startsAt),
    endsAt: row.endsAt ? toWall(row.endsAt) : null,
    allDay: row.allDay,
    place: row.place,
    note: row.note,
  };
  // Only a changed "Kiedy" is range-checked; an old event stays editable.
  const whenGiven = patch.when !== undefined;
  const input = asInput(patch, cur, patch.when ?? whenText(cur));
  const v = await validateEvent(
    db,
    input,
    whenGiven ? nowWall() : new Date(cur.startsAt.getTime() - 86_400_000),
  );
  if (!v.ok) return refused(v.message);
  const next = v.fields;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of FIELD_KEYS) {
    if (!same(cur[k], next[k])) {
      const j = (x: unknown) => (x instanceof Date ? x.toISOString() : x);
      changes[k] = { from: j(cur[k]), to: j(next[k]) };
    }
  }
  if (Object.keys(changes).length === 0) {
    return { ok: true, message: 'Brak zmian.' };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(events)
      .set({ ...next, updatedBy: userId, updatedAt: new Date() })
      .where(eq(events.id, eventId));
    await writeAudit(tx, {
      userId,
      action: 'event.edit',
      target: String(eventId),
      details: { source, changes },
    });
    await upsert(tx, eventId);
  });
  return { ok: true, message: 'Zapisano zmiany.' };
}

export async function deleteEvent(
  db: Db,
  userId: number,
  eventId: number,
  source: EventSource,
): Promise<ActionResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return user;
  return db.transaction(async (tx) => {
    const [res] = await tx
      .update(events)
      .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(events.id, eventId), isNull(events.deletedAt)));
    if (res.affectedRows === 0) return refused(NOT_FOUND);
    await writeAudit(tx, {
      userId,
      action: 'event.delete',
      target: String(eventId),
      details: { source },
    });
    await enqueueBotRequest(tx, 'event_post_archive', `event:${eventId}`);
    return { ok: true, message: 'Usunięto wydarzenie.' };
  });
}

/** Admin only. */
export async function restoreEvent(
  db: Db,
  adminUserId: number,
  eventId: number,
  source: EventSource = 'web',
): Promise<ActionResult> {
  const user = await checkUser(db, adminUserId);
  if (isRefusal(user)) return user;
  if (!user.isAdmin) {
    return refused('Tylko administrator może przywrócić wydarzenie.');
  }
  return db.transaction(async (tx) => {
    const [res] = await tx
      .update(events)
      .set({ deletedAt: null, updatedBy: adminUserId, updatedAt: new Date() })
      .where(and(eq(events.id, eventId), sql`${events.deletedAt} IS NOT NULL`));
    if (res.affectedRows === 0) {
      return refused('Nie znaleziono usuniętego wydarzenia.');
    }
    await writeAudit(tx, {
      userId: adminUserId,
      action: 'event.restore',
      target: String(eventId),
      details: { source },
    });
    await upsert(tx, eventId);
    return { ok: true, message: 'Przywrócono wydarzenie.' };
  });
}

export async function linkTopic(
  db: Db,
  userId: number,
  eventId: number,
  topicId: number,
  source: EventSource,
): Promise<ActionResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return user;
  return db.transaction(async (tx) => {
    const [ev] = await tx
      .select({ subjectId: events.subjectId })
      .from(events)
      .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
      .for('update');
    if (!ev) return refused(NOT_FOUND);
    const [t] = await tx
      .select({ subjectId: topics.subjectId })
      .from(topics)
      .where(and(eq(topics.id, topicId), isNull(topics.deletedAt)));
    if (!t) return refused('Nie znaleziono posta.');
    if (ev.subjectId !== null && t.subjectId !== ev.subjectId) {
      return refused('Ten post należy do innego przedmiotu.');
    }
    const links = await tx
      .select({ topicId: eventTopics.topicId })
      .from(eventTopics)
      .where(eq(eventTopics.eventId, eventId));
    if (links.some((l) => l.topicId === topicId)) {
      return refused('Ten post jest już powiązany.');
    }
    if (links.length >= MAX_EVENT_LINKS) {
      return refused(`Można powiązać najwyżej ${MAX_EVENT_LINKS} postów.`);
    }
    await tx.insert(eventTopics).values({ eventId, topicId });
    await writeAudit(tx, {
      userId,
      action: 'event.link',
      target: String(eventId),
      details: { source, topicId },
    });
    await upsert(tx, eventId);
    return { ok: true, message: 'Powiązano post.' };
  });
}

export async function unlinkTopic(
  db: Db,
  userId: number,
  eventId: number,
  topicId: number,
  source: EventSource,
): Promise<ActionResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return user;
  return db.transaction(async (tx) => {
    const [res] = await tx
      .delete(eventTopics)
      .where(
        and(eq(eventTopics.eventId, eventId), eq(eventTopics.topicId, topicId)),
      );
    if (res.affectedRows === 0) return refused('Ten post nie jest powiązany.');
    await writeAudit(tx, {
      userId,
      action: 'event.unlink',
      target: String(eventId),
      details: { source, topicId },
    });
    await upsert(tx, eventId);
    return { ok: true, message: 'Usunięto powiązanie.' };
  });
}

export type EventDetails = typeof events.$inferSelect & {
  subjectCode: string | null;
  subjectName: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  linkedTopicIds: number[];
};

/** The event (also a deleted one: `deletedAt` is set) or null. */
export async function getEvent(
  db: DbExecutor,
  id: number,
): Promise<EventDetails | null> {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  if (!row) return null;
  const nameOf = async (uid: number | null) => {
    if (uid === null) return null;
    const [u] = await db
      .select({ n: users.displayName })
      .from(users)
      .where(eq(users.id, uid));
    return u?.n ?? null;
  };
  const [subj] =
    row.subjectId === null
      ? []
      : await db
          .select({ code: subjects.code, name: subjects.name })
          .from(subjects)
          .where(eq(subjects.id, row.subjectId));
  const links = await db
    .select({ topicId: eventTopics.topicId })
    .from(eventTopics)
    .where(eq(eventTopics.eventId, id))
    .orderBy(eventTopics.id);
  return {
    ...row,
    subjectCode: subj?.code ?? null,
    subjectName: subj?.name ?? null,
    createdByName: await nameOf(row.createdBy),
    updatedByName: await nameOf(row.updatedBy),
    linkedTopicIds: links.map((l) => l.topicId),
  };
}

export type EventMaterial = {
  id: number;
  filename: string;
  topicTitle: string;
  createdAt: Date;
  previewKind: (typeof materials.$inferSelect)['previewKind'];
};

/** Files of the event's own post plus linked posts, newest first. */
export async function eventMaterials(
  db: DbExecutor,
  eventId: number,
): Promise<EventMaterial[]> {
  const [ev] = await db
    .select({ topicId: events.topicId })
    .from(events)
    .where(eq(events.id, eventId));
  if (!ev) return [];
  const links = await db
    .select({ topicId: eventTopics.topicId })
    .from(eventTopics)
    .where(eq(eventTopics.eventId, eventId));
  const ids = [
    ...new Set([
      ...(ev.topicId === null ? [] : [ev.topicId]),
      ...links.map((l) => l.topicId),
    ]),
  ];
  if (ids.length === 0) return [];
  return db
    .select({
      id: materials.id,
      filename: materials.originalFilename,
      topicTitle: topics.title,
      createdAt: materials.createdAt,
      previewKind: materials.previewKind,
    })
    .from(materials)
    .innerJoin(topics, eq(topics.id, materials.topicId))
    .where(
      and(
        inArray(materials.topicId, ids),
        isNull(materials.deletedAt),
        isNull(topics.deletedAt),
      ),
    )
    .orderBy(desc(materials.createdAt), desc(materials.id));
}

/* ---------- plan listing ---------- */

const DAY_MS = 86_400_000;
const END_SQL = `CASE WHEN e.all_day THEN e.starts_at + INTERVAL 1 DAY
                      ELSE COALESCE(e.ends_at, e.starts_at) END`;
const SELECT_EVENTS = `
  SELECT e.id, e.kind, e.title, e.starts_at, e.ends_at, e.all_day, e.place,
         e.subject_id, e.subject_code, e.subject_name,
         COALESCE(e.class_id, g.class_id) AS class_id,
         c.kind AS class_kind, c.name AS class_name,
         e.group_id, g.name AS group_name
    FROM v_events e
    LEFT JOIN v_class_groups g ON g.id = e.group_id
    LEFT JOIN v_classes c ON c.id = COALESCE(e.class_id, g.class_id)`;

const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

/**
 * Event row → plan row. An event without a subject has `subjectId` 0 and
 * empty name/code (PlanSession's subject fields are not nullable). An
 * all-day event ends at the next midnight, one without an end at its start.
 */
function toEventSession(r: mysql.RowDataPacket): PlanSession {
  const startsAt = toWall(r.starts_at);
  const allDay = Boolean(r.all_day);
  const endsAt = allDay
    ? new Date(startsAt.getTime() + DAY_MS)
    : r.ends_at
      ? toWall(r.ends_at)
      : startsAt;
  return {
    type: 'event',
    id: Number(r.id),
    startsAt,
    endsAt,
    subjectId: Number(r.subject_id ?? 0),
    subjectName: String(r.subject_name ?? ''),
    subjectCode: String(r.subject_code ?? ''),
    classId: numOrNull(r.class_id),
    classKind: (r.class_kind ?? null) as PlanSession['classKind'],
    className: strOrNull(r.class_name),
    groupId: numOrNull(r.group_id),
    groupName: strOrNull(r.group_name),
    lecturerId: null,
    lecturerName: null,
    room: strOrNull(r.place),
    label: String(r.title),
    status: 'confirmed',
    eventKind: r.kind as EventKind,
    eventTitle: String(r.title),
    allDay,
  };
}

const wallLiteral = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** Events starting in [fromWall, toWall), ordered by start. */
export async function listEventsInRange(
  pool: mysql.Pool,
  fromWall: Date,
  toWall_: Date,
): Promise<PlanSession[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `${SELECT_EVENTS}
     WHERE e.starts_at >= ? AND e.starts_at < ?
     ORDER BY e.starts_at, e.id`,
    [wallLiteral(fromWall), wallLiteral(toWall_)],
  );
  return rows.map(toEventSession);
}

/** The next `limit` events that have not ended at `nowWall_`. */
export async function listUpcomingEvents(
  pool: mysql.Pool,
  nowWall_: Date,
  limit: number,
): Promise<PlanSession[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `${SELECT_EVENTS}
     WHERE ${END_SQL} >= ?
     ORDER BY e.starts_at, e.id
     LIMIT ?`,
    [wallLiteral(nowWall_), Math.max(0, Math.floor(limit))],
  );
  return rows.map(toEventSession);
}
