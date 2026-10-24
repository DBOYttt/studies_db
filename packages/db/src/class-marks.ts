/**
 * Weekly class marks (the entry quiz, "wejściówka"), shared by web and bot.
 * Any non-banned student may turn a mark on or off, edit its note and skip a
 * week (wiki-style); an admin restores a removed mark. Every change runs in a
 * transaction and writes one `admin_audit` row (`class_mark.*`, target
 * `class_mark:<id>`, details carry the `source`). Nothing is posted to Discord.
 */

import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { writeAudit } from './audit.js';
import type { Db, DbExecutor } from './client.js';
import { CLASS_MARK_KINDS, type ClassMarkKind } from './constants.js';
import { CONFLICT, checkUser, type EventSource, isRefusal } from './events.js';
import {
  classes,
  classGroups,
  classMarkSkips,
  classMarks,
  classSessions,
  users,
} from './schema.js';
import { withTxRetry } from './tx.js';

export type MarkSource = EventSource;

export type MarkResult =
  | { ok: true; message: string; id: number; version: number }
  | { ok: false; message: string };

export type ClassMark = {
  id: number;
  classId: number;
  groupId: number | null;
  kind: ClassMarkKind;
  note: string | null;
  version: number;
  /** Skipped dates, `YYYY-MM-DD`, ascending. */
  skips: string[];
  deletedAt: Date | null;
  updatedByName: string | null;
};

export type MarkInput = {
  classId: number;
  groupId: number | null;
  kind: ClassMarkKind;
  note?: string | null;
};

export const MARK_ALREADY_ON = 'Entry quiz is already on for this class.';
export const MARK_ALREADY_ON_ALL =
  'Entry quiz is already on for all groups of this class.';
export const MARK_NOT_FOUND = 'Entry quiz not found.';
export const MARK_NOTE_MAX = 200;
const GROUP_NOT_IN_CLASS = 'This group is not part of the class.';
const CLASS_NOT_FOUND = 'Class not found.';
const NO_SESSION = 'There is no session of this class on that date.';
const ALREADY_SKIPPED = 'This week is already skipped.';
const NOT_SKIPPED = 'This week is not skipped.';
const NOTE_TOO_LONG = `The note can be at most ${MARK_NOTE_MAX} characters.`;
const ADMIN_ONLY = 'Only an admin can restore an entry quiz.';

const fail = (message: string): MarkResult => ({ ok: false, message });
const done = (message: string, id: number, version: number): MarkResult => ({
  ok: true,
  message,
  id,
  version,
});
const target = (id: number) => `class_mark:${id}`;
const bump = sql`${classMarks.version} + 1`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Trimmed note, null when blank; `false` when too long. */
function cleanNote(note: string | null | undefined): string | null | false {
  const t = note?.trim();
  if (!t) return null;
  return t.length > MARK_NOTE_MAX ? false : t;
}

/**
 * Inside a transaction: locks the class row (serialising concurrent turn-ons
 * of the same class) and checks the group belongs to it. Null when fine.
 */
async function lockClass(
  tx: DbExecutor,
  classId: number,
  groupId: number | null,
): Promise<string | null> {
  const [c] = await tx
    .select({ id: classes.id })
    .from(classes)
    .where(eq(classes.id, classId))
    .for('update');
  if (!c) return CLASS_NOT_FOUND;
  if (groupId !== null) {
    const [g] = await tx
      .select({ classId: classGroups.classId })
      .from(classGroups)
      .where(eq(classGroups.id, groupId));
    if (!g || g.classId !== classId) return GROUP_NOT_IN_CLASS;
  }
  return null;
}

/** Inside a transaction: true when another active mark exists (locked). */
async function activeExists(
  tx: DbExecutor,
  m: { classId: number; groupId: number | null; kind: ClassMarkKind },
): Promise<boolean> {
  const rows = await tx
    .select({ id: classMarks.id })
    .from(classMarks)
    .where(
      and(
        eq(classMarks.classId, m.classId),
        m.groupId === null
          ? isNull(classMarks.groupId)
          : eq(classMarks.groupId, m.groupId),
        eq(classMarks.kind, m.kind),
        isNull(classMarks.deletedAt),
      ),
    )
    .for('update');
  return rows.length > 0;
}

/** Inside a transaction: the locked mark row, or undefined. */
async function lockMark(tx: DbExecutor, id: number) {
  const [m] = await tx
    .select({
      id: classMarks.id,
      classId: classMarks.classId,
      groupId: classMarks.groupId,
      kind: classMarks.kind,
      note: classMarks.note,
      version: classMarks.version,
      deletedAt: classMarks.deletedAt,
    })
    .from(classMarks)
    .where(eq(classMarks.id, id))
    .for('update');
  return m;
}

export async function addMark(
  db: Db,
  userId: number,
  input: MarkInput,
  source: MarkSource,
): Promise<MarkResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return fail(user.message);
  if (!CLASS_MARK_KINDS.includes(input.kind)) return fail('Unknown mark type.');
  const note = cleanNote(input.note);
  if (note === false) return fail(NOTE_TOO_LONG);
  const { classId, groupId, kind } = input;
  return withTxRetry(db, async (tx) => {
    const bad = await lockClass(tx, classId, groupId);
    if (bad) return fail(bad);
    if (await activeExists(tx, { classId, groupId, kind })) {
      return fail(MARK_ALREADY_ON);
    }
    // A group mark under an all-groups one would never show (the all-groups
    // mark takes precedence on the timetable).
    if (
      groupId !== null &&
      (await activeExists(tx, { classId, groupId: null, kind }))
    ) {
      return fail(MARK_ALREADY_ON_ALL);
    }
    const [{ id }] = await tx
      .insert(classMarks)
      .values({
        classId,
        groupId,
        kind,
        note,
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();
    await writeAudit(tx, {
      userId,
      action: 'class_mark.add',
      target: target(id),
      details: { source, classId, groupId, kind, note },
    });
    return done('Entry quiz turned on.', id, 0);
  });
}

export async function editMark(
  db: Db,
  userId: number,
  id: number,
  input: { note: string | null },
  opts: { expectedVersion: number },
  source: MarkSource,
): Promise<MarkResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return fail(user.message);
  const note = cleanNote(input.note);
  if (note === false) return fail(NOTE_TOO_LONG);
  return withTxRetry(db, async (tx) => {
    const m = await lockMark(tx, id);
    if (!m || m.deletedAt !== null) return fail(MARK_NOT_FOUND);
    if (m.version !== opts.expectedVersion) return fail(CONFLICT);
    await tx
      .update(classMarks)
      .set({ note, updatedBy: userId, updatedAt: new Date(), version: bump })
      .where(eq(classMarks.id, id));
    await writeAudit(tx, {
      userId,
      action: 'class_mark.edit',
      target: target(id),
      details: { source, note, before: m.note },
    });
    return done('Note saved.', id, m.version + 1);
  });
}

/** Soft delete ("Turn off"). */
export async function removeMark(
  db: Db,
  userId: number,
  id: number,
  opts: { expectedVersion?: number },
  source: MarkSource,
): Promise<MarkResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return fail(user.message);
  return withTxRetry(db, async (tx) => {
    const m = await lockMark(tx, id);
    if (!m || m.deletedAt !== null) return fail(MARK_NOT_FOUND);
    if (
      opts.expectedVersion !== undefined &&
      m.version !== opts.expectedVersion
    ) {
      return fail(CONFLICT);
    }
    const now = new Date();
    await tx
      .update(classMarks)
      .set({ deletedAt: now, updatedBy: userId, updatedAt: now, version: bump })
      .where(eq(classMarks.id, id));
    await writeAudit(tx, {
      userId,
      action: 'class_mark.remove',
      target: target(id),
      details: {
        source,
        classId: m.classId,
        groupId: m.groupId,
        kind: m.kind,
      },
    });
    return done('Entry quiz turned off.', id, m.version + 1);
  });
}

/** Admin only. Refused while another active mark covers the same class/group/kind. */
export async function restoreMark(
  db: Db,
  adminId: number,
  id: number,
  source: MarkSource,
): Promise<MarkResult> {
  const user = await checkUser(db, adminId);
  if (isRefusal(user)) return fail(user.message);
  if (!user.isAdmin) return fail(ADMIN_ONLY);
  return withTxRetry(db, async (tx) => {
    const [peek] = await tx
      .select({ classId: classMarks.classId })
      .from(classMarks)
      .where(eq(classMarks.id, id));
    if (!peek) return fail(MARK_NOT_FOUND);
    // Same lock order as addMark: class first, then marks.
    const bad = await lockClass(tx, peek.classId, null);
    if (bad) return fail(MARK_NOT_FOUND);
    const m = await lockMark(tx, id);
    if (!m || m.deletedAt === null) return fail(MARK_NOT_FOUND);
    if (await activeExists(tx, m)) return fail(MARK_ALREADY_ON);
    await tx
      .update(classMarks)
      .set({
        deletedAt: null,
        updatedBy: adminId,
        updatedAt: new Date(),
        version: bump,
      })
      .where(eq(classMarks.id, id));
    await writeAudit(tx, {
      userId: adminId,
      action: 'class_mark.restore',
      target: target(id),
      details: { source },
    });
    return done('Entry quiz restored.', id, m.version + 1);
  });
}

/** "Not this week": the mark does not apply on `onDate` (`YYYY-MM-DD`). */
export async function skipDate(
  db: Db,
  userId: number,
  markId: number,
  onDate: string,
  source: MarkSource,
): Promise<MarkResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return fail(user.message);
  return withTxRetry(db, async (tx) => {
    const m = await lockMark(tx, markId);
    if (!m || m.deletedAt !== null) return fail(MARK_NOT_FOUND);
    if (!DATE_RE.test(onDate)) return fail(NO_SESSION);
    // The day as a range [00:00, next day 00:00), so the index on starts_at
    // is usable (DATE(starts_at) is not sargable).
    const dayStart = new Date(`${onDate}T00:00:00Z`);
    if (Number.isNaN(dayStart.getTime())) return fail(NO_SESSION);
    const nextDay = new Date(dayStart.getTime() + 86_400_000);
    const [s] = await tx
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(
        and(
          eq(classSessions.classId, m.classId),
          m.groupId === null ? undefined : eq(classSessions.groupId, m.groupId),
          eq(classSessions.kind, 'class'),
          eq(classSessions.status, 'confirmed'),
          gte(classSessions.startsAt, dayStart),
          lt(classSessions.startsAt, nextDay),
        ),
      )
      .limit(1);
    if (!s) return fail(NO_SESSION);
    const [dup] = await tx
      .select({ id: classMarkSkips.id })
      .from(classMarkSkips)
      .where(
        and(
          eq(classMarkSkips.markId, markId),
          eq(classMarkSkips.onDate, onDate),
        ),
      );
    if (dup) return fail(ALREADY_SKIPPED);
    await tx
      .insert(classMarkSkips)
      .values({ markId, onDate, createdBy: userId });
    await writeAudit(tx, {
      userId,
      action: 'class_mark.skip',
      target: target(markId),
      details: { source, onDate },
    });
    return done('Skipped for that week.', markId, m.version);
  });
}

export async function unskipDate(
  db: Db,
  userId: number,
  markId: number,
  onDate: string,
  source: MarkSource,
): Promise<MarkResult> {
  const user = await checkUser(db, userId);
  if (isRefusal(user)) return fail(user.message);
  return withTxRetry(db, async (tx) => {
    const m = await lockMark(tx, markId);
    if (!m || m.deletedAt !== null) return fail(MARK_NOT_FOUND);
    if (!DATE_RE.test(onDate)) return fail(NOT_SKIPPED);
    const [res] = await tx
      .delete(classMarkSkips)
      .where(
        and(
          eq(classMarkSkips.markId, markId),
          eq(classMarkSkips.onDate, onDate),
        ),
      );
    if (res.affectedRows === 0) return fail(NOT_SKIPPED);
    await writeAudit(tx, {
      userId,
      action: 'class_mark.unskip',
      target: target(markId),
      details: { source, onDate },
    });
    return done('Skip undone.', markId, m.version);
  });
}

/** Marks of the given classes, by id. Deleted ones only with `includeDeleted`. */
export async function listMarks(
  db: DbExecutor,
  classIds: number[],
  opts: { includeDeleted?: boolean } = {},
): Promise<ClassMark[]> {
  if (classIds.length === 0) return [];
  const rows = await db
    .select({
      id: classMarks.id,
      classId: classMarks.classId,
      groupId: classMarks.groupId,
      kind: classMarks.kind,
      note: classMarks.note,
      version: classMarks.version,
      deletedAt: classMarks.deletedAt,
      updatedByName: users.displayName,
    })
    .from(classMarks)
    .leftJoin(users, eq(users.id, classMarks.updatedBy))
    .where(
      and(
        inArray(classMarks.classId, classIds),
        opts.includeDeleted ? undefined : isNull(classMarks.deletedAt),
      ),
    )
    .orderBy(asc(classMarks.id));
  if (rows.length === 0) return [];
  const skips = await db
    .select({ markId: classMarkSkips.markId, onDate: classMarkSkips.onDate })
    .from(classMarkSkips)
    .where(
      inArray(
        classMarkSkips.markId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(classMarkSkips.onDate));
  const byMark = new Map<number, string[]>();
  for (const s of skips) {
    const list = byMark.get(s.markId) ?? [];
    list.push(s.onDate);
    byMark.set(s.markId, list);
  }
  return rows.map((r) => ({ ...r, skips: byMark.get(r.id) ?? [] }));
}
