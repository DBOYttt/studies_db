import {
  CLASS_KINDS,
  type ClassKind,
  classes,
  classGroups,
  type Db,
  materials,
  searchAll,
  subjects,
  topics,
  users,
} from '@studies/db';
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';

export interface SimpleFile {
  id: number;
  filename: string;
  mimeType: string;
  topicId: number;
  topicTitle: string;
  subjectCode: string;
  subjectName: string;
  className: string | null;
  groupName: string | null;
  uploader: string;
  createdAt: Date;
  sizeBytes: number;
  previewKind: 'pdf' | 'image' | 'text' | 'none';
  status: 'pending' | 'ready' | 'failed';
}

export interface SubjectCard {
  id: number;
  code: string;
  name: string;
  semester: number;
  ects: number;
  kinds: ClassKind[];
  fileCount: number;
  lastUpload: Date | null;
}

const toDate = (v: unknown): Date =>
  v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);

export async function listSubjectCards(
  db: Db,
  semester?: number | null,
): Promise<SubjectCard[]> {
  const [subs, kindRows, stats] = await Promise.all([
    db
      .select({
        id: subjects.id,
        code: subjects.code,
        name: subjects.name,
        semester: subjects.semester,
        ects: subjects.ects,
      })
      .from(subjects)
      .where(semester == null ? undefined : eq(subjects.semester, semester))
      .orderBy(asc(subjects.semester), asc(subjects.name), asc(subjects.id)),
    db
      .selectDistinct({ subjectId: classes.subjectId, kind: classes.kind })
      .from(classes),
    db
      .select({
        subjectId: topics.subjectId,
        n: sql<number>`COUNT(${materials.id})`.mapWith(Number),
        last: sql<unknown>`MAX(${materials.createdAt})`,
      })
      .from(materials)
      .innerJoin(topics, eq(topics.id, materials.topicId))
      .where(and(isNull(materials.deletedAt), isNull(topics.deletedAt)))
      .groupBy(topics.subjectId),
  ]);
  const kindsBy = new Map<number, Set<ClassKind>>();
  for (const r of kindRows) {
    const s = kindsBy.get(r.subjectId) ?? new Set<ClassKind>();
    s.add(r.kind);
    kindsBy.set(r.subjectId, s);
  }
  const statBy = new Map(stats.map((s) => [s.subjectId, s]));
  return subs.map((s) => {
    const st = statBy.get(s.id);
    const ks = kindsBy.get(s.id);
    return {
      ...s,
      kinds: CLASS_KINDS.filter((k) => ks?.has(k)),
      fileCount: st?.n ?? 0,
      lastUpload: st?.last ? toDate(st.last) : null,
    };
  });
}

function simpleFileSelect(db: Db) {
  return db
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
    .innerJoin(subjects, eq(subjects.id, topics.subjectId))
    .innerJoin(users, eq(users.id, materials.uploaderId))
    .leftJoin(classes, eq(classes.id, topics.classId))
    .leftJoin(classGroups, eq(classGroups.id, topics.groupId));
}

type SimpleRow = Awaited<
  ReturnType<ReturnType<typeof simpleFileSelect>['limit']>
>[number];

const toSimpleFile = (r: SimpleRow): SimpleFile => ({
  ...r,
  createdAt: toDate(r.createdAt),
});

const live = () => [isNull(materials.deletedAt), isNull(topics.deletedAt)];

export interface SimpleFileFilter {
  subjectId?: number;
  kind?: ClassKind;
  group?: number;
  tagId?: number;
  limit: number;
  offset?: number;
  /** false: skip the COUNT(*) (callers that never show a total). */
  withTotal?: boolean;
}

/**
 * `group` is the group NUMBER (as in the advanced view); applies only
 * together with `subjectId` and `kind`. Rows and total run in parallel.
 */
export async function listSimpleFiles(
  db: Db,
  f: SimpleFileFilter & { withTotal: false },
): Promise<{ rows: SimpleFile[]; total?: undefined }>;
export async function listSimpleFiles(
  db: Db,
  f: SimpleFileFilter,
): Promise<{ rows: SimpleFile[]; total: number }>;
export async function listSimpleFiles(
  db: Db,
  f: SimpleFileFilter,
): Promise<{ rows: SimpleFile[]; total?: number }> {
  const conds: SQL[] = live() as SQL[];
  if (f.subjectId !== undefined) conds.push(eq(topics.subjectId, f.subjectId));
  if (f.kind) conds.push(eq(classes.kind, f.kind));
  // a group number only means something within one subject's kind
  if (f.subjectId !== undefined && f.kind && f.group !== undefined) {
    conds.push(eq(classGroups.number, f.group));
  }
  if (f.tagId !== undefined) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM topic_tags tt WHERE tt.topic_id = ${topics.id} AND tt.tag_id = ${f.tagId})`,
    );
  }
  const where = and(...conds);
  const [rows, total] = await Promise.all([
    simpleFileSelect(db)
      .where(where)
      .orderBy(desc(materials.createdAt), desc(materials.id))
      .limit(f.limit)
      .offset(f.offset ?? 0),
    f.withTotal === false
      ? undefined
      : db
          .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
          .from(materials)
          .innerJoin(topics, eq(topics.id, materials.topicId))
          .leftJoin(classes, eq(classes.id, topics.classId))
          .leftJoin(classGroups, eq(classGroups.id, topics.groupId))
          .where(where)
          .then(([r]) => r.n),
  ]);
  return { rows: rows.map(toSimpleFile), total };
}

/** A search result file; `snippet` («hit» marked) when its text matched. */
export type SimpleSearchFile = SimpleFile & { snippet?: string };

/** Simple search: matching files, and how many topics matched by title. */
export interface SimpleSearchResult {
  files: SimpleSearchFile[];
  /** Topic-title hits; simple mode lists files only, Advanced shows these. */
  topics: number;
}

/**
 * Name/topic/subject substring (literal) matches first, then full-text
 * content hits. Files whose text matched keep the search snippet.
 */
export async function searchSimpleFiles(
  db: Db,
  q: string,
  limit = 100,
  semester?: number | null,
): Promise<SimpleSearchResult> {
  const term = q.trim().slice(0, 200);
  if (!term) return { files: [], topics: 0 };
  const pat = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const like = (col: AnyColumn) =>
    sql`LOWER(${col}) LIKE LOWER(${pat}) ESCAPE '\\\\'`;
  const [byLike, hits] = await Promise.all([
    simpleFileSelect(db)
      .where(
        and(
          ...live(),
          semester == null ? undefined : eq(subjects.semester, semester),
          sql`(${like(materials.originalFilename)} OR ${like(topics.title)} OR ${like(subjects.name)})`,
        ),
      )
      .orderBy(desc(materials.createdAt), desc(materials.id))
      .limit(limit),
    searchAll(db, {
      q: term,
      limit,
      ...(semester == null ? {} : { semester }),
    }),
  ]);
  // A file without extracted text "matches" by its name only: no snippet.
  const snippets = new Map<number, string>();
  for (const h of hits) {
    if (h.materialId == null || snippets.has(h.materialId)) continue;
    if (h.snippet.replace(/[«»]/g, '') !== h.filename)
      snippets.set(h.materialId, h.snippet);
  }
  const withSnippet = (f: SimpleFile): SimpleSearchFile => {
    const snippet = snippets.get(f.id);
    return snippet === undefined ? f : { ...f, snippet };
  };
  const topicCount = hits.filter((h) => h.materialId == null).length;
  const out = byLike.map((r) => withSnippet(toSimpleFile(r)));
  if (out.length >= limit) return { files: out, topics: topicCount };
  const seen = new Set(out.map((r) => r.id));
  const ids = [
    ...new Set(
      hits
        .map((h) => h.materialId)
        .filter((id): id is number => id != null && !seen.has(id)),
    ),
  ];
  if (ids.length > 0) {
    const extra = new Map(
      (
        await simpleFileSelect(db).where(
          and(...live(), inArray(materials.id, ids)),
        )
      ).map((r) => [r.id, toSimpleFile(r)]),
    );
    for (const id of ids) {
      const r = extra.get(id);
      if (r && out.length < limit) out.push(withSnippet(r));
    }
  }
  return { files: out, topics: topicCount };
}
