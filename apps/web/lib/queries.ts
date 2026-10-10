import {
  type Db,
  lecturers,
  materials,
  subjectLecturers,
  subjects,
  tags,
  topics,
  topicTags,
  users,
} from '@studies/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

export type LecturerRole = 'wyklad' | 'laboratorium' | 'cwiczenia' | 'projekt';

export interface SubjectLecturer {
  name: string;
  title: string | null;
  role: LecturerRole;
}

export interface SubjectInfo {
  id: number;
  code: string;
  name: string;
  semester: number;
  ects: number;
  description: string | null;
  lecturers: SubjectLecturer[];
}

export interface SubjectOverview extends SubjectInfo {
  materialCount: number;
  lastUploadAt: Date | null;
}

const ROLE_ORDER: LecturerRole[] = [
  'wyklad',
  'cwiczenia',
  'laboratorium',
  'projekt',
];

async function lecturersBySubject(
  db: Db,
  subjectIds: number[],
): Promise<Map<number, SubjectLecturer[]>> {
  const map = new Map<number, SubjectLecturer[]>();
  if (subjectIds.length === 0) return map;
  const rows = await db
    .select({
      subjectId: subjectLecturers.subjectId,
      name: lecturers.name,
      title: lecturers.title,
      role: subjectLecturers.role,
    })
    .from(subjectLecturers)
    .innerJoin(lecturers, eq(lecturers.id, subjectLecturers.lecturerId))
    .where(inArray(subjectLecturers.subjectId, subjectIds))
    .orderBy(asc(lecturers.name));
  for (const r of rows) {
    const list = map.get(r.subjectId) ?? [];
    list.push({ name: r.name, title: r.title, role: r.role });
    map.set(r.subjectId, list);
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
    );
  }
  return map;
}

/** Subjects with lecturers and live-material stats (soft-deleted files and topics excluded). */
export async function listSubjectsOverview(db: Db): Promise<SubjectOverview[]> {
  const subs = await db
    .select()
    .from(subjects)
    .orderBy(asc(subjects.semester), asc(subjects.name));
  const stats = await db
    .select({
      subjectId: topics.subjectId,
      n: sql<number>`COUNT(${materials.id})`.mapWith(Number),
      last: sql<string | null>`MAX(${materials.createdAt})`,
    })
    .from(materials)
    .innerJoin(topics, eq(topics.id, materials.topicId))
    .where(and(isNull(materials.deletedAt), isNull(topics.deletedAt)))
    .groupBy(topics.subjectId);
  const statBy = new Map(stats.map((s) => [s.subjectId, s]));
  const lecs = await lecturersBySubject(
    db,
    subs.map((s) => s.id),
  );
  return subs.map((s) => {
    const st = statBy.get(s.id);
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      semester: s.semester,
      ects: s.ects,
      description: s.description,
      lecturers: lecs.get(s.id) ?? [],
      materialCount: st?.n ?? 0,
      lastUploadAt: st?.last ? toDate(st.last) : null,
    };
  });
}

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
}

export async function getSubject(
  db: Db,
  code: string,
): Promise<SubjectInfo | null> {
  const [s] = await db.select().from(subjects).where(eq(subjects.code, code));
  if (!s) return null;
  const lecs = await lecturersBySubject(db, [s.id]);
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    semester: s.semester,
    ects: s.ects,
    description: s.description,
    lecturers: lecs.get(s.id) ?? [],
  };
}

export async function listSubjectTags(
  db: Db,
  subjectId: number,
): Promise<{ id: number; name: string }[]> {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.subjectId, subjectId))
    .orderBy(asc(tags.name));
}

export interface TopicRow {
  id: number;
  title: string;
  tags: { id: number; name: string }[];
  fileCount: number;
  createdAt: Date;
  author: string | null;
}

export async function listTopics(
  db: Db,
  subjectId: number,
  opts: { tagId?: number },
): Promise<TopicRow[]> {
  const conds = [eq(topics.subjectId, subjectId), isNull(topics.deletedAt)];
  if (opts.tagId) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM topic_tags tt WHERE tt.topic_id = ${topics.id} AND tt.tag_id = ${opts.tagId})`,
    );
  }
  const rows = await db
    .select({
      id: topics.id,
      title: topics.title,
      createdAt: topics.createdAt,
      author: users.displayName,
      fileCount:
        sql<number>`(SELECT COUNT(*) FROM materials m WHERE m.topic_id = ${topics.id} AND m.deleted_at IS NULL)`.mapWith(
          Number,
        ),
    })
    .from(topics)
    .leftJoin(users, eq(users.id, topics.createdBy))
    .where(and(...conds))
    .orderBy(desc(topics.createdAt), desc(topics.id));
  if (rows.length === 0) return [];
  const tagRows = await db
    .select({ topicId: topicTags.topicId, id: tags.id, name: tags.name })
    .from(topicTags)
    .innerJoin(tags, eq(tags.id, topicTags.tagId))
    .where(
      inArray(
        topicTags.topicId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(tags.name));
  const byTopic = new Map<number, { id: number; name: string }[]>();
  for (const t of tagRows) {
    const l = byTopic.get(t.topicId) ?? [];
    l.push({ id: t.id, name: t.name });
    byTopic.set(t.topicId, l);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: toDate(r.createdAt),
    author: r.author,
    fileCount: r.fileCount,
    tags: byTopic.get(r.id) ?? [],
  }));
}

export interface MaterialRow {
  id: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  previewKind: 'pdf' | 'image' | 'text' | 'none';
  status: 'pending' | 'ready' | 'failed';
  createdAt: Date;
  uploaderName: string;
  discordUrl: string | null;
}

export async function getTopicWithMaterials(
  db: Db,
  topicId: number,
): Promise<{
  topic: { id: number; title: string; createdAt: Date };
  subject: { code: string; name: string };
  tags: { id: number; name: string }[];
  materials: MaterialRow[];
} | null> {
  const [t] = await db
    .select({
      id: topics.id,
      title: topics.title,
      createdAt: topics.createdAt,
      threadId: topics.discordThreadId,
      subjectCode: subjects.code,
      subjectName: subjects.name,
    })
    .from(topics)
    .innerJoin(subjects, eq(subjects.id, topics.subjectId))
    .where(and(eq(topics.id, topicId), isNull(topics.deletedAt)));
  if (!t) return null;
  const guild = process.env.DISCORD_GUILD_ID;
  const mats = await db
    .select({
      id: materials.id,
      originalFilename: materials.originalFilename,
      mimeType: materials.mimeType,
      sizeBytes: materials.sizeBytes,
      previewKind: materials.previewKind,
      status: materials.status,
      createdAt: materials.createdAt,
      uploaderName: users.displayName,
      messageId: materials.discordMessageId,
    })
    .from(materials)
    .innerJoin(users, eq(users.id, materials.uploaderId))
    .where(and(eq(materials.topicId, topicId), isNull(materials.deletedAt)))
    .orderBy(asc(materials.id));
  const tagRows = await db
    .select({ id: tags.id, name: tags.name })
    .from(topicTags)
    .innerJoin(tags, eq(tags.id, topicTags.tagId))
    .where(eq(topicTags.topicId, topicId))
    .orderBy(asc(tags.name));
  return {
    topic: { id: t.id, title: t.title, createdAt: toDate(t.createdAt) },
    subject: { code: t.subjectCode, name: t.subjectName },
    tags: tagRows,
    materials: mats.map(({ messageId, createdAt, ...m }) => ({
      ...m,
      createdAt: toDate(createdAt),
      discordUrl: guild
        ? `https://discord.com/channels/${guild}/${t.threadId}/${messageId}`
        : null,
    })),
  };
}

export async function listAllTags(
  db: Db,
): Promise<{ id: number; name: string; subjectCode: string }[]> {
  return db
    .select({ id: tags.id, name: tags.name, subjectCode: subjects.code })
    .from(tags)
    .innerJoin(subjects, eq(subjects.id, tags.subjectId))
    .orderBy(asc(subjects.code), asc(tags.name));
}

export async function listSubjectOptions(
  db: Db,
): Promise<{ id: number; code: string; name: string }[]> {
  return db
    .select({ id: subjects.id, code: subjects.code, name: subjects.name })
    .from(subjects)
    .orderBy(asc(subjects.name));
}
