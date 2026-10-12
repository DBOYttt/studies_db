import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, DbExecutor } from '../client.js';
import { ensureClass, ensureGroup } from '../hierarchy.js';
import {
  classLecturers,
  classSessions,
  lecturers,
  subjects,
} from '../schema.js';
import {
  type ClassifiedEvent,
  classifyEvent,
  type ParsedLecturer,
  semesterFor,
  subjectCode,
} from './classify.js';
import { expandOccurrences, type IcsEvent, parseIcs } from './ics.js';

export interface SyncStats {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  warnings: string[];
}

const MAX_WARNINGS = 50;
const CHUNK = 500;

interface SessionRow {
  uid: string;
  occurrenceStart: Date;
  subjectId: number;
  classId: number | null;
  groupId: number | null;
  lecturerId: number | null;
  label: string | null;
  room: string | null;
  startsAt: Date;
  endsAt: Date;
  status: 'confirmed' | 'cancelled';
  sequence: number;
}

function sessionKey(uid: string, occurrenceStart: Date): string {
  return `${uid}\u0000${occurrenceStart.getTime()}`;
}

function sameSession(a: SessionRow, b: SessionRow): boolean {
  return (
    a.subjectId === b.subjectId &&
    a.classId === b.classId &&
    a.groupId === b.groupId &&
    a.lecturerId === b.lecturerId &&
    a.label === b.label &&
    a.room === b.room &&
    a.startsAt.getTime() === b.startsAt.getTime() &&
    a.endsAt.getTime() === b.endsAt.getTime() &&
    a.status === b.status &&
    a.sequence === b.sequence
  );
}

function chunks<T>(xs: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Per-run lookups that create missing rows; never renames or deletes. */
class Resolver {
  private subjectIds = new Map<string, number>();
  private lecturerIds = new Map<string, number>();
  private classIds = new Map<string, number>();
  private groupIds = new Map<string, number>();
  private assignments = new Set<string>();

  constructor(
    private db: DbExecutor,
    private calendarName: string,
    private takenCodes: Set<string>,
  ) {}

  async subject(ev: IcsEvent, c: ClassifiedEvent): Promise<number> {
    const unitimeName = ev.summary.slice(0, 200);
    const cached = this.subjectIds.get(unitimeName);
    if (cached !== undefined) return cached;
    const [found] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.unitimeName, unitimeName));
    let id = found?.id;
    if (id === undefined) {
      const name = (c.subjectName || unitimeName || 'Bez nazwy').slice(0, 200);
      const code = subjectCode(name, this.takenCodes);
      this.takenCodes.add(code.toUpperCase());
      const [ins] = await this.db
        .insert(subjects)
        .values({
          name,
          code,
          semester: semesterFor(this.calendarName, c.yearOfStudy),
          ects: 0,
          discordChannelId: null,
          unitimeName,
        })
        .$returningId();
      id = ins?.id;
      if (id === undefined) throw new Error(`Nie utworzono przedmiotu ${name}`);
    }
    this.subjectIds.set(unitimeName, id);
    return id;
  }

  async lecturer(p: ParsedLecturer): Promise<number> {
    const email = p.email?.trim().toLowerCase() || null;
    const name = p.name.slice(0, 200);
    const title = p.title?.slice(0, 50) ?? null;
    const key = email ? `e:${email}` : `n:${name}\u0000${title ?? ''}`;
    const cached = this.lecturerIds.get(key);
    if (cached !== undefined) return cached;
    const [found] = await this.db
      .select({ id: lecturers.id })
      .from(lecturers)
      .where(
        email
          ? eq(lecturers.email, email)
          : and(
              eq(lecturers.name, name),
              title === null
                ? isNull(lecturers.title)
                : eq(lecturers.title, title),
            ),
      )
      .limit(1);
    let id = found?.id;
    if (id === undefined) {
      const [ins] = await this.db
        .insert(lecturers)
        .values({ name, title, email })
        .$returningId();
      id = ins?.id;
      if (id === undefined)
        throw new Error(`Nie utworzono prowadzącego ${name}`);
    }
    this.lecturerIds.set(key, id);
    return id;
  }

  async class(subjectId: number, c: ClassifiedEvent): Promise<number | null> {
    if (!c.kind) return null;
    const key = `${subjectId}:${c.kind}`;
    let id = this.classIds.get(key);
    if (id === undefined) {
      id = await ensureClass(this.db, subjectId, c.kind);
      this.classIds.set(key, id);
    }
    return id;
  }

  async group(
    classId: number | null,
    c: ClassifiedEvent,
  ): Promise<number | null> {
    if (classId === null || c.groupNumber === null) return null;
    const key = `${classId}:${c.groupNumber}`;
    let id = this.groupIds.get(key);
    if (id === undefined) {
      id = await ensureGroup(
        this.db,
        classId,
        c.groupNumber,
        c.groupName ?? undefined,
      );
      this.groupIds.set(key, id);
    }
    return id;
  }

  async assign(
    classId: number,
    lecturerId: number,
    groupId: number | null,
  ): Promise<void> {
    const key = `${classId}:${lecturerId}:${groupId ?? ''}`;
    if (this.assignments.has(key)) return;
    // NULL group_id is not unique-enforced, so check for an existing row.
    const [existing] = await this.db
      .select({ id: classLecturers.id })
      .from(classLecturers)
      .where(
        and(
          eq(classLecturers.classId, classId),
          eq(classLecturers.lecturerId, lecturerId),
          groupId === null
            ? isNull(classLecturers.groupId)
            : eq(classLecturers.groupId, groupId),
        ),
      );
    if (!existing)
      await this.db
        .insert(classLecturers)
        .values({ classId, lecturerId, groupId });
    this.assignments.add(key);
  }
}

/**
 * Imports a UniTime iCalendar export in one transaction (spec §2 steps 1–6).
 * Parses before touching the DB, so malformed input writes nothing.
 */
export async function syncTimetable(db: Db, ics: string): Promise<SyncStats> {
  if (!/^BEGIN:VCALENDAR\s*$/im.test(ics))
    throw new Error('To nie jest plik iCalendar (brak BEGIN:VCALENDAR).');
  const calendar = parseIcs(ics);

  const warnings = new Set<string>();
  const warn = (w: string) => {
    if (warnings.size < MAX_WARNINGS) warnings.add(w);
  };
  const planned = calendar.events.map((ev) => {
    const c = classifyEvent(ev);
    if (!c.kind) warn(`Nieznany typ zajęć: ${c.label}`);
    if (ev.rruleUnsupported)
      warn(`Nieobsługiwana reguła powtarzania: ${ev.uid}`);
    return { ev, c, occurrences: expandOccurrences(ev) };
  });

  return db.transaction(async (tx) => {
    const codes = await tx.select({ code: subjects.code }).from(subjects);
    const r = new Resolver(
      tx,
      calendar.name,
      new Set(codes.map((x) => x.code.toUpperCase())),
    );

    const desired = new Map<string, SessionRow>();
    for (const { ev, c, occurrences } of planned) {
      const subjectId = await r.subject(ev, c);
      const classId = await r.class(subjectId, c);
      const groupId = await r.group(classId, c);
      const lecturerId = c.lecturer ? await r.lecturer(c.lecturer) : null;
      if (classId !== null && lecturerId !== null)
        await r.assign(classId, lecturerId, groupId);
      const uid = ev.uid.slice(0, 100);
      for (const o of occurrences) {
        desired.set(sessionKey(uid, o.start), {
          uid,
          occurrenceStart: o.start,
          subjectId,
          classId,
          groupId,
          lecturerId,
          label: c.label || null,
          room: c.room?.slice(0, 100) ?? null,
          startsAt: o.start,
          endsAt: o.end,
          status: ev.status,
          sequence: ev.sequence,
        });
      }
    }

    const existing = await tx
      .select({
        id: classSessions.id,
        uid: classSessions.uid,
        occurrenceStart: classSessions.occurrenceStart,
        subjectId: classSessions.subjectId,
        classId: classSessions.classId,
        groupId: classSessions.groupId,
        lecturerId: classSessions.lecturerId,
        label: classSessions.label,
        room: classSessions.room,
        startsAt: classSessions.startsAt,
        endsAt: classSessions.endsAt,
        status: classSessions.status,
        sequence: classSessions.sequence,
      })
      .from(classSessions);

    const stats: SyncStats = {
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      warnings: [...warnings],
    };
    const toDelete: number[] = [];
    for (const row of existing) {
      const key = sessionKey(row.uid, row.occurrenceStart);
      const want = desired.get(key);
      if (!want) {
        toDelete.push(row.id);
        continue;
      }
      desired.delete(key);
      if (sameSession(row, want)) {
        stats.unchanged++;
        continue;
      }
      const { uid: _u, occurrenceStart: _o, ...fields } = want;
      await tx
        .update(classSessions)
        .set({ ...fields, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(classSessions.id, row.id));
      stats.updated++;
    }
    for (const ids of chunks(toDelete)) {
      await tx.delete(classSessions).where(inArray(classSessions.id, ids));
      stats.deleted += ids.length;
    }
    for (const rows of chunks([...desired.values()])) {
      await tx.insert(classSessions).values(rows);
      stats.created += rows.length;
    }
    return stats;
  });
}
