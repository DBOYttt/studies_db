import {
  classes,
  classGroups,
  type Db,
  eventMaterials,
  listAuditRows,
  materials,
  subjects,
  topics,
  users,
} from '@studies/db';
import type { ClassKind } from '@studies/db/constants';
import { and, asc, eq, inArray, isNull, like, type SQL } from 'drizzle-orm';
import type { SimpleFile } from './simple-queries';

export type SubjectOption = {
  id: number;
  code: string;
  name: string;
  classes: {
    id: number;
    kind: ClassKind;
    name: string;
    groups: { id: number; name: string }[];
  }[];
};

/** Subjects with their classes and groups, for the form's selects. */
export async function listEventSubjectOptions(
  db: Db,
): Promise<SubjectOption[]> {
  const [subs, cls, grs] = await Promise.all([
    db
      .select({ id: subjects.id, code: subjects.code, name: subjects.name })
      .from(subjects)
      .orderBy(asc(subjects.semester), asc(subjects.name), asc(subjects.id)),
    db
      .select({
        id: classes.id,
        subjectId: classes.subjectId,
        kind: classes.kind,
        name: classes.name,
      })
      .from(classes)
      .orderBy(asc(classes.id)),
    db
      .select({
        id: classGroups.id,
        classId: classGroups.classId,
        name: classGroups.name,
      })
      .from(classGroups)
      .orderBy(asc(classGroups.number)),
  ]);
  return subs.map((s) => ({
    ...s,
    classes: cls
      .filter((c) => c.subjectId === s.id)
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        groups: grs
          .filter((g) => g.classId === c.id)
          .map((g) => ({ id: g.id, name: g.name })),
      })),
  }));
}

const toDate = (v: unknown): Date =>
  v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);

/** The event's files as rows of the shared FileList (posts need no subject). */
export async function eventFileRows(
  db: Db,
  eventId: number,
): Promise<SimpleFile[]> {
  const mats = await eventMaterials(db, eventId);
  if (mats.length === 0) return [];
  const rows = await db
    .select({
      id: materials.id,
      filename: materials.originalFilename,
      mimeType: materials.mimeType,
      topicId: topics.id,
      topicTitle: topics.title,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      className: classes.name,
      groupName: classGroups.name,
      uploader: users.displayName,
      createdAt: materials.createdAt,
      sizeBytes: materials.sizeBytes,
      previewKind: materials.previewKind,
      status: materials.status,
    })
    .from(materials)
    .innerJoin(topics, eq(topics.id, materials.topicId))
    .leftJoin(subjects, eq(subjects.id, topics.subjectId))
    .innerJoin(users, eq(users.id, materials.uploaderId))
    .leftJoin(classes, eq(classes.id, topics.classId))
    .leftJoin(classGroups, eq(classGroups.id, topics.groupId))
    .where(
      inArray(
        materials.id,
        mats.map((m) => m.id),
      ),
    );
  const order = new Map(mats.map((m, i) => [m.id, i]));
  return rows
    .map((r) => ({
      ...r,
      subjectCode: r.subjectCode ?? '',
      subjectName: r.subjectName ?? '',
      createdAt: toDate(r.createdAt),
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export type LinkedTopic = {
  id: number;
  title: string;
  subjectCode: string | null;
};

/** Posts by id (non-deleted), in the order given. */
export async function listTopicsByIds(
  db: Db,
  ids: number[],
): Promise<LinkedTopic[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: topics.id, title: topics.title, subjectCode: subjects.code })
    .from(topics)
    .leftJoin(subjects, eq(subjects.id, topics.subjectId))
    .where(and(inArray(topics.id, ids), isNull(topics.deletedAt)));
  return ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is LinkedTopic => r !== undefined);
}

export const TOPIC_SEARCH_LIMIT = 20;

/** Non-deleted posts whose title contains `q`, within a subject if given. */
export async function searchTopics(
  db: Db,
  subjectId: number | null,
  q: string,
): Promise<LinkedTopic[]> {
  const text = q.trim().slice(0, 100);
  const conds: SQL[] = [isNull(topics.deletedAt)];
  if (subjectId !== null) conds.push(eq(topics.subjectId, subjectId));
  if (text)
    conds.push(like(topics.title, `%${text.replace(/[\\%_]/g, '\\$&')}%`));
  return db
    .select({ id: topics.id, title: topics.title, subjectCode: subjects.code })
    .from(topics)
    .leftJoin(subjects, eq(subjects.id, topics.subjectId))
    .where(and(...conds))
    .orderBy(asc(topics.title), asc(topics.id))
    .limit(TOPIC_SEARCH_LIMIT);
}

/**
 * Audit rows of one event and of its series (`series:<id>`), newest first.
 */
export async function eventHistory(
  db: Db,
  eventId: number,
  seriesId: number | null,
) {
  // Rows only: the page shows no total, so the count query is skipped.
  return listAuditRows(db, {
    limit: 50,
    offset: 0,
    target:
      seriesId === null
        ? String(eventId)
        : [String(eventId), `series:${seriesId}`],
    actionPrefix: 'event.',
  });
}
