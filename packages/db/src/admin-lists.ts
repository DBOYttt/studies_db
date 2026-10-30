import { asc, count, eq, inArray, or, sql } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import { CLASS_KINDS } from './constants.js';
import {
  classes,
  classGroups,
  classLecturers,
  lecturers,
  subjects,
  users,
} from './schema.js';

export async function listSubjectsAdmin(db: DbExecutor) {
  const rows = await db
    .select({
      id: subjects.id,
      code: subjects.code,
      name: subjects.name,
      semester: subjects.semester,
      ects: subjects.ects,
      discordChannelId: subjects.discordChannelId,
      classCount: sql<number>`(SELECT COUNT(*) FROM ${classes} WHERE ${classes.subjectId} = subjects.id)`,
    })
    .from(subjects)
    .orderBy(asc(subjects.code));
  return rows.map(({ discordChannelId, classCount, ...r }) => ({
    ...r,
    forumLinked: discordChannelId !== null,
    classCount: Number(classCount),
  }));
}

export async function getSubjectAdmin(db: DbExecutor, code: string) {
  const [s] = await db
    .select()
    .from(subjects)
    // The column's collation is case-insensitive, so a plain equality
    // matches 'fiz' to 'FIZ' and can use subjects_code_unique.
    .where(eq(subjects.code, code.trim()));
  if (!s) return null;
  const cls = await db
    .select()
    .from(classes)
    .where(eq(classes.subjectId, s.id));
  const ids = cls.map((c) => c.id);
  const groups = ids.length
    ? await db
        .select()
        .from(classGroups)
        .where(inArray(classGroups.classId, ids))
        .orderBy(asc(classGroups.number))
    : [];
  const lecs = ids.length
    ? await db
        .select({
          id: classLecturers.id,
          classId: classLecturers.classId,
          lecturerId: lecturers.id,
          name: lecturers.name,
          title: lecturers.title,
          groupName: classGroups.name,
          groupNumber: classGroups.number,
        })
        .from(classLecturers)
        .innerJoin(lecturers, eq(lecturers.id, classLecturers.lecturerId))
        .leftJoin(classGroups, eq(classGroups.id, classLecturers.groupId))
        .where(inArray(classLecturers.classId, ids))
        .orderBy(
          sql`${classGroups.number} IS NULL DESC`,
          asc(classGroups.number),
          asc(lecturers.name),
        )
    : [];
  const sorted = [...cls].sort(
    (a, b) => CLASS_KINDS.indexOf(a.kind) - CLASS_KINDS.indexOf(b.kind),
  );
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    semester: s.semester,
    ects: s.ects,
    description: s.description,
    platformUrl: s.platformUrl,
    forumLinked: s.discordChannelId !== null,
    classes: sorted.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      assessment: c.assessment,
      assessmentNote: c.assessmentNote,
      platformUrl: c.platformUrl,
      groups: groups
        .filter((g) => g.classId === c.id)
        .map((g) => ({ id: g.id, number: g.number, name: g.name })),
      lecturers: lecs
        .filter((l) => l.classId === c.id)
        .map((l) => ({
          id: l.id,
          lecturerId: l.lecturerId,
          name: l.name,
          title: l.title,
          groupName: l.groupName,
        })),
    })),
  };
}

const lecturerCols = {
  id: lecturers.id,
  title: lecturers.title,
  name: lecturers.name,
  email: lecturers.email,
  officeHours: lecturers.officeHours,
  room: lecturers.room,
};

export async function listLecturersAdmin(db: DbExecutor) {
  return db
    .select(lecturerCols)
    .from(lecturers)
    .orderBy(asc(lecturers.name), asc(lecturers.id));
}

export async function getLecturerAdmin(db: DbExecutor, id: number) {
  const [row] = await db
    .select(lecturerCols)
    .from(lecturers)
    .where(eq(lecturers.id, id));
  return row ?? null;
}

export async function listUsersAdmin(
  db: DbExecutor,
  o: { q?: string; limit: number; offset: number },
) {
  const q = o.q?.trim();
  const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const where = pattern
    ? or(
        sql`${users.displayName} LIKE ${pattern}`,
        sql`${users.discordUserId} LIKE ${pattern}`,
      )
    : undefined;
  const [rows, [t]] = await Promise.all([
    db
      .select({
        id: users.id,
        discordUserId: users.discordUserId,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        isAdmin: users.isAdmin,
        isBanned: users.isBanned,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(asc(users.displayName), asc(users.id))
      .limit(o.limit)
      .offset(o.offset),
    db.select({ n: count() }).from(users).where(where),
  ]);
  return { rows, total: Number(t?.n ?? 0) };
}
