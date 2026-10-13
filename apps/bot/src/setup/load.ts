import {
  CLASS_KINDS,
  classes,
  classGroups,
  classLecturers,
  classSessions,
  type Db,
  lecturers,
  materials,
  subjects,
  tags,
  topics,
  topicTags,
  users,
  utcToWarsawWall,
} from '@studies/db';
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';
import type {
  ClassSpec,
  SessionSpec,
  SubjectSpec,
  TopicSpec,
} from './types.js';

const SESSION_WINDOW_MS = 14 * 86_400_000;

/**
 * Every subject with its classes, groups, lecturers, postable topics (with
 * ready files) and sessions in the 14 days from `nowWall` (a Warsaw wall Date).
 */
export async function loadSubjectSpecs(
  db: Db,
  nowWall: Date = utcToWarsawWall(new Date()),
): Promise<SubjectSpec[]> {
  const subjectRows = await db
    .select()
    .from(subjects)
    .orderBy(asc(subjects.id));
  const classRows = await db.select().from(classes);
  const groupRows = await db
    .select({ classId: classGroups.classId, number: classGroups.number })
    .from(classGroups)
    .orderBy(asc(classGroups.number));
  const lecturerRows = await db
    .select({
      classId: classLecturers.classId,
      name: lecturers.name,
      title: lecturers.title,
      email: lecturers.email,
      officeHours: lecturers.officeHours,
      room: lecturers.room,
      group: classGroups.number,
    })
    .from(classLecturers)
    .innerJoin(lecturers, eq(lecturers.id, classLecturers.lecturerId))
    .leftJoin(classGroups, eq(classGroups.id, classLecturers.groupId))
    .orderBy(asc(classGroups.number), asc(lecturers.name));

  const byClass = (c: (typeof classRows)[number]): ClassSpec => ({
    kind: c.kind,
    name: c.name,
    assessment: c.assessment,
    assessmentNote: c.assessmentNote,
    platformUrl: c.platformUrl,
    groups: groupRows.filter((g) => g.classId === c.id).map((g) => g.number),
    lecturers: lecturerRows
      .filter((l) => l.classId === c.id)
      .map(({ classId: _, ...l }) => l),
  });

  const kindOf = new Map(classRows.map((c) => [c.id, c.kind]));
  const allGroups = await db
    .select({ id: classGroups.id, number: classGroups.number })
    .from(classGroups);
  const groupNumber = new Map(allGroups.map((g) => [g.id, g.number]));

  const topicRows = await db
    .select({
      id: topics.id,
      subjectId: topics.subjectId,
      title: topics.title,
      threadId: topics.discordThreadId,
      classId: topics.classId,
      groupId: topics.groupId,
      createdAt: topics.createdAt,
      authorName: users.displayName,
    })
    .from(topics)
    .leftJoin(users, eq(users.id, topics.createdBy))
    .where(isNull(topics.deletedAt))
    .orderBy(asc(topics.createdAt), asc(topics.id));
  const tagRows = await db
    .select({ topicId: topicTags.topicId, name: tags.name })
    .from(topicTags)
    .innerJoin(tags, eq(tags.id, topicTags.tagId));
  const materialRows = await db
    .select({
      id: materials.id,
      topicId: materials.topicId,
      filename: materials.originalFilename,
      storagePath: materials.storagePath,
      sizeBytes: materials.sizeBytes,
      discordMessageId: materials.discordMessageId,
    })
    .from(materials)
    .where(and(eq(materials.status, 'ready'), isNull(materials.deletedAt)))
    .orderBy(asc(materials.id));
  const toTopic = (t: (typeof topicRows)[number]): TopicSpec => ({
    id: t.id,
    title: t.title,
    threadId: t.threadId,
    classKind: t.classId === null ? null : (kindOf.get(t.classId) ?? null),
    group: t.groupId === null ? null : (groupNumber.get(t.groupId) ?? null),
    tagNames: tagRows.filter((r) => r.topicId === t.id).map((r) => r.name),
    authorName: t.authorName,
    createdAt: t.createdAt,
    materials: materialRows
      .filter((m) => m.topicId === t.id)
      .map(({ topicId: _, ...m }) => m),
  });

  const sessionRows = await db
    .select()
    .from(classSessions)
    .where(
      and(
        gte(classSessions.startsAt, nowWall),
        lt(
          classSessions.startsAt,
          new Date(nowWall.getTime() + SESSION_WINDOW_MS),
        ),
      ),
    )
    .orderBy(asc(classSessions.startsAt));
  const toSession = (r: (typeof sessionRows)[number]): SessionSpec => ({
    uid: r.uid,
    classKind: r.classId === null ? null : (kindOf.get(r.classId) ?? null),
    group: r.groupId === null ? null : (groupNumber.get(r.groupId) ?? null),
    label: r.label,
    room: r.room,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status,
  });

  return subjectRows.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    semester: s.semester,
    ects: s.ects,
    platformUrl: s.platformUrl,
    channelId: s.discordChannelId,
    classes: classRows
      .filter((c) => c.subjectId === s.id)
      .sort((a, b) => CLASS_KINDS.indexOf(a.kind) - CLASS_KINDS.indexOf(b.kind))
      .map(byClass),
    topics: topicRows.filter((t) => t.subjectId === s.id).map(toTopic),
    sessions: sessionRows.filter((r) => r.subjectId === s.id).map(toSession),
  }));
}
