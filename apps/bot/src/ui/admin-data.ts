/**
 * Reads behind the admin panel views: plain rows for the view builders.
 */
import {
  type ClassKind,
  classes,
  classGroups,
  classLecturers,
  type Db,
  jobs,
  lecturers,
  materials,
  subjects,
  users,
} from '@studies/db';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { planStatusReply } from '../commands/plan.js';
import {
  type LecturerCardData,
  type LecturerOption,
  lecturerLabel,
  type StatusData,
  type SubjectCardData,
  type SubjectOption,
  type UserCardData,
} from './views/admin.js';

export async function loadStatus(db: Db): Promise<StatusData> {
  const rows = await db
    .select({ status: jobs.status, n: count() })
    .from(jobs)
    .groupBy(jobs.status);
  const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  const [pending] = await db
    .select({ n: count() })
    .from(materials)
    .where(and(eq(materials.status, 'pending'), isNull(materials.deletedAt)));
  return {
    planText: await planStatusReply(db, new Date()),
    jobs: { queued: n('queued'), running: n('running'), failed: n('failed') },
    pending: pending?.n ?? 0,
  };
}

export const subjectOptions = (db: Db): Promise<SubjectOption[]> =>
  db
    .select({
      code: subjects.code,
      name: subjects.name,
      semester: subjects.semester,
    })
    .from(subjects)
    .orderBy(asc(subjects.semester), asc(subjects.code));

export const lecturerOptions = (db: Db): Promise<LecturerOption[]> =>
  db
    .select({ id: lecturers.id, name: lecturers.name, title: lecturers.title })
    .from(lecturers)
    .orderBy(asc(lecturers.name), asc(lecturers.id));

export async function subjectRow(db: Db, code: string) {
  const [s] = await db
    .select({
      id: subjects.id,
      code: subjects.code,
      name: subjects.name,
      semester: subjects.semester,
      ects: subjects.ects,
      description: subjects.description,
      platformUrl: subjects.platformUrl,
      channelId: subjects.discordChannelId,
    })
    .from(subjects)
    .where(eq(subjects.code, code));
  return s ?? null;
}

export async function subjectCardData(
  db: Db,
  code: string,
): Promise<SubjectCardData | null> {
  const s = await subjectRow(db, code);
  if (!s) return null;
  const cls = await db
    .select({
      id: classes.id,
      kind: classes.kind,
      assessment: classes.assessment,
      assessmentNote: classes.assessmentNote,
      platformUrl: classes.platformUrl,
    })
    .from(classes)
    .where(eq(classes.subjectId, s.id));
  const lects = cls.length
    ? await db
        .select({
          classId: classLecturers.classId,
          name: lecturers.name,
          title: lecturers.title,
          groupName: classGroups.name,
        })
        .from(classLecturers)
        .innerJoin(lecturers, eq(lecturers.id, classLecturers.lecturerId))
        .leftJoin(classGroups, eq(classGroups.id, classLecturers.groupId))
        .where(
          inArray(
            classLecturers.classId,
            cls.map((c) => c.id),
          ),
        )
        .orderBy(asc(classGroups.number), asc(lecturers.name))
    : [];
  const { id: _id, ...rest } = s;
  return {
    ...rest,
    classes: cls.map(({ id, ...c }) => ({
      ...c,
      lecturers: lects
        .filter((l) => l.classId === id)
        .map((l) => ({ name: lecturerLabel(l), groupName: l.groupName })),
    })),
  };
}

export async function classRow(db: Db, code: string, kind: ClassKind) {
  const [c] = await db
    .select({
      assessment: classes.assessment,
      assessmentNote: classes.assessmentNote,
      platformUrl: classes.platformUrl,
    })
    .from(classes)
    .innerJoin(subjects, eq(subjects.id, classes.subjectId))
    .where(and(eq(subjects.code, code), eq(classes.kind, kind)));
  return c ?? null;
}

export const groupOptions = (db: Db, code: string, kind: ClassKind) =>
  db
    .select({ number: classGroups.number, name: classGroups.name })
    .from(classGroups)
    .innerJoin(classes, eq(classes.id, classGroups.classId))
    .innerJoin(subjects, eq(subjects.id, classes.subjectId))
    .where(and(eq(subjects.code, code), eq(classes.kind, kind)))
    .orderBy(asc(classGroups.number));

export async function lecturerRow(
  db: Db,
  id: number,
): Promise<LecturerCardData | null> {
  const [l] = await db
    .select({
      id: lecturers.id,
      name: lecturers.name,
      title: lecturers.title,
      email: lecturers.email,
      officeHours: lecturers.officeHours,
      room: lecturers.room,
    })
    .from(lecturers)
    .where(eq(lecturers.id, id));
  return l ?? null;
}

/** The user's row, or what Discord tells about someone who has none yet. */
export async function userCardData(
  db: Db,
  discordUserId: string,
  fallbackName: string,
): Promise<UserCardData> {
  const [u] = await db
    .select({
      displayName: users.displayName,
      isAdmin: users.isAdmin,
      isBanned: users.isBanned,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.discordUserId, discordUserId));
  return {
    discordUserId,
    displayName: u?.displayName ?? fallbackName,
    isAdmin: u?.isAdmin ?? false,
    isBanned: u?.isBanned ?? false,
    createdAt: u?.createdAt ?? null,
  };
}
