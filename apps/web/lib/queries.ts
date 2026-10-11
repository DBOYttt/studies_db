import {
  CLASS_KINDS,
  CLASS_NAMES,
  type ClassKind,
  classes,
  classGroups,
  classLecturers,
  type Db,
  groupName,
  lecturers,
  materials,
  subjects,
  tags,
  topics,
  topicTags,
  users,
} from '@studies/db';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';
import {
  type ExplorerParams,
  explorerHref,
  type SortDir,
  type SortKey,
} from './explorer';
import type { NavClass, NavSubject } from './nav-tree';

export interface SubjectInfo {
  id: number;
  code: string;
  name: string;
  semester: number;
  ects: number;
  description: string | null;
}

const KIND_ORDER: (ClassKind | 'none')[] = [...CLASS_KINDS, 'none'];
const NONE_NAME = 'Bez kategorii';

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
}

export async function getSubject(
  db: Db,
  code: string,
): Promise<SubjectInfo | null> {
  const [s] = await db.select().from(subjects).where(eq(subjects.code, code));
  if (!s) return null;
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    semester: s.semester,
    ects: s.ects,
    description: s.description,
  };
}

/** Subject code of a live topic (for redirects into the explorer). */
export async function getTopicSubjectCode(
  db: Db,
  topicId: number,
): Promise<string | null> {
  const [r] = await db
    .select({ code: subjects.code })
    .from(topics)
    .innerJoin(subjects, eq(subjects.id, topics.subjectId))
    .where(and(eq(topics.id, topicId), isNull(topics.deletedAt)));
  return r?.code ?? null;
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

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

export type TreeTopic = { id: number; title: string; fileCount: number };
export type TreeGroup = {
  id: number;
  number: number;
  name: string;
  fileCount: number;
  topics: TreeTopic[];
};
export type TreeClass = {
  id: number | null;
  kind: ClassKind | 'none';
  name: string;
  fileCount: number;
  lecturers: { name: string; title: string | null; groupName: string | null }[];
  groups: TreeGroup[];
  topics: TreeTopic[];
};

// NB: the correlated subquery must say `topics.id` literally; drizzle omits the
// table qualifier in single-table selects, which would resolve to m.id.
/** Content-driven tree (3 queries): only classes/groups holding live topics. */
export async function getSubjectTree(
  db: Db,
  subjectId: number,
): Promise<TreeClass[]> {
  const topicRows = await db
    .select({
      id: topics.id,
      title: topics.title,
      classId: topics.classId,
      groupId: topics.groupId,
      fileCount:
        sql<number>`(SELECT COUNT(*) FROM materials m WHERE m.topic_id = topics.id AND m.deleted_at IS NULL)`.mapWith(
          Number,
        ),
    })
    .from(topics)
    .where(and(eq(topics.subjectId, subjectId), isNull(topics.deletedAt)))
    .orderBy(asc(topics.title), asc(topics.id));
  if (topicRows.length === 0) return [];
  const classRows = await db
    .select({
      id: classes.id,
      kind: classes.kind,
      name: classes.name,
      groupId: classGroups.id,
      groupNumber: classGroups.number,
      groupName: classGroups.name,
    })
    .from(classes)
    .leftJoin(classGroups, eq(classGroups.classId, classes.id))
    .where(eq(classes.subjectId, subjectId))
    .orderBy(asc(classes.id), asc(classGroups.number));
  const lecRows = await db
    .select({
      classId: classLecturers.classId,
      name: lecturers.name,
      title: lecturers.title,
      groupName: classGroups.name,
    })
    .from(classLecturers)
    .innerJoin(classes, eq(classes.id, classLecturers.classId))
    .innerJoin(lecturers, eq(lecturers.id, classLecturers.lecturerId))
    .leftJoin(classGroups, eq(classGroups.id, classLecturers.groupId))
    .where(eq(classes.subjectId, subjectId))
    .orderBy(asc(classGroups.number), asc(lecturers.name));

  const byKind = new Map<ClassKind, TreeClass>();
  const groupIndex = new Map<number, TreeGroup>();
  const classById = new Map<number, TreeClass>();
  for (const r of classRows) {
    let c = byKind.get(r.kind);
    if (!c) {
      c = {
        id: r.id,
        kind: r.kind,
        name: r.name,
        fileCount: 0,
        lecturers: [],
        groups: [],
        topics: [],
      };
      byKind.set(r.kind, c);
      classById.set(r.id, c);
    }
    if (r.groupId != null && r.groupNumber != null) {
      const g: TreeGroup = {
        id: r.groupId,
        number: r.groupNumber,
        name: r.groupName ?? groupName(r.groupNumber),
        fileCount: 0,
        topics: [],
      };
      c.groups.push(g);
      groupIndex.set(r.groupId, g);
    }
  }
  for (const l of lecRows) {
    classById.get(l.classId)?.lecturers.push({
      name: l.name,
      title: l.title,
      groupName: l.groupName,
    });
  }
  const none: TreeClass = {
    id: null,
    kind: 'none',
    name: NONE_NAME,
    fileCount: 0,
    lecturers: [],
    groups: [],
    topics: [],
  };
  for (const t of topicRows) {
    const tt: TreeTopic = { id: t.id, title: t.title, fileCount: t.fileCount };
    const c = t.classId == null ? undefined : classById.get(t.classId);
    if (!c) {
      none.topics.push(tt);
      none.fileCount += tt.fileCount;
      continue;
    }
    const g = t.groupId == null ? undefined : groupIndex.get(t.groupId);
    if (g && c.groups.includes(g)) {
      g.topics.push(tt);
      g.fileCount += tt.fileCount;
    } else {
      c.topics.push(tt);
    }
    c.fileCount += tt.fileCount;
  }
  const out: TreeClass[] = [];
  for (const kind of CLASS_KINDS) {
    const c = byKind.get(kind);
    if (!c) continue;
    c.groups = c.groups.filter((g) => g.topics.length > 0);
    if (c.topics.length === 0 && c.groups.length === 0) continue;
    out.push(c);
  }
  if (none.topics.length > 0) out.push(none);
  return out;
}

/** Drops invalid segments; fills class/group from the topic's position. `file` is passed through. */
export function resolveSelection(
  tree: TreeClass[],
  p: ExplorerParams,
): ExplorerParams {
  const out: ExplorerParams = {
    ...p,
    classKind: null,
    group: null,
    topic: null,
  };
  let cls = p.classKind ? tree.find((c) => c.kind === p.classKind) : undefined;
  let grp =
    cls && p.group != null
      ? cls.groups.find((g) => g.number === p.group)
      : undefined;
  if (p.topic != null) {
    let found: { cls: TreeClass; grp?: TreeGroup } | undefined;
    const scan = (cands: TreeClass[]) => {
      for (const c of cands) {
        if (c.topics.some((t) => t.id === p.topic)) return { cls: c };
        for (const g of c.groups) {
          if (g.topics.some((t) => t.id === p.topic)) return { cls: c, grp: g };
        }
      }
      return undefined;
    };
    if (grp && cls) {
      if (grp.topics.some((t) => t.id === p.topic)) found = { cls, grp };
    } else if (cls) {
      found = scan([cls]);
    } else {
      found = scan(tree);
    }
    if (found) {
      cls = found.cls;
      grp = found.grp;
      out.topic = p.topic;
    }
  }
  out.classKind = cls?.kind ?? null;
  out.group = grp?.number ?? null;
  return out;
}

export type ExplorerFile = {
  id: number;
  filename: string;
  subjectCode: string;
  mimeType: string;
  topicId: number;
  topicTitle: string;
  className: string;
  groupName: string | null;
  previewKind: 'pdf' | 'image' | 'text' | 'none';
  status: 'pending' | 'ready' | 'failed';
  uploader: string;
  createdAt: Date;
  sizeBytes: number;
  discordUrl: string | null;
};

/** ExplorerFile as it arrives over JSON (`/api/material/[id]`): dates are ISO strings. */
export type PreviewFile = Omit<ExplorerFile, 'createdAt'> & {
  createdAt: Date | string;
};

function explorerFileSelect(db: Db) {
  return db
    .select({
      id: materials.id,
      filename: materials.originalFilename,
      subjectCode: subjects.code,
      mimeType: materials.mimeType,
      topicId: topics.id,
      topicTitle: topics.title,
      className: classes.name,
      groupName: classGroups.name,
      previewKind: materials.previewKind,
      status: materials.status,
      uploader: users.displayName,
      createdAt: materials.createdAt,
      sizeBytes: materials.sizeBytes,
      messageId: materials.discordMessageId,
      threadId: topics.discordThreadId,
    })
    .from(materials)
    .innerJoin(topics, eq(topics.id, materials.topicId))
    .innerJoin(subjects, eq(subjects.id, topics.subjectId))
    .innerJoin(users, eq(users.id, materials.uploaderId))
    .leftJoin(classes, eq(classes.id, topics.classId))
    .leftJoin(classGroups, eq(classGroups.id, topics.groupId));
}

function toExplorerFile(
  r: Awaited<
    ReturnType<ReturnType<typeof explorerFileSelect>['limit']>
  >[number],
): ExplorerFile {
  const { messageId, threadId, className, createdAt, ...rest } = r;
  const guild = process.env.DISCORD_GUILD_ID;
  return {
    ...rest,
    className: className ?? NONE_NAME,
    createdAt: toDate(createdAt),
    discordUrl: guild
      ? `https://discord.com/channels/${guild}/${threadId}/${messageId}`
      : null,
  };
}

export type ExplorerFileOpts = {
  tagId?: number;
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
};

function explorerFileWhere(
  subjectId: number,
  sel: ExplorerParams,
  opts: ExplorerFileOpts,
): SQL | undefined {
  const conds: SQL[] = [
    eq(topics.subjectId, subjectId),
    isNull(topics.deletedAt),
    isNull(materials.deletedAt),
  ];
  if (sel.classKind === 'none') conds.push(isNull(topics.classId));
  else if (sel.classKind) conds.push(eq(classes.kind, sel.classKind));
  if (sel.classKind && sel.classKind !== 'none' && sel.group != null) {
    conds.push(eq(classGroups.number, sel.group));
  }
  if (sel.topic != null) conds.push(eq(topics.id, sel.topic));
  if (opts.tagId) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM topic_tags tt WHERE tt.topic_id = ${topics.id} AND tt.tag_id = ${opts.tagId})`,
    );
  }
  const q = opts.q?.trim();
  if (q) {
    const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    conds.push(
      sql`LOWER(${materials.originalFilename}) LIKE LOWER(${`%${esc}%`}) ESCAPE '\\\\'`,
    );
  }
  return and(...conds);
}

function explorerFileOrder(opts: ExplorerFileOpts) {
  const sortCols = {
    topic: topics.title,
    filename: materials.originalFilename,
    created: materials.createdAt,
    uploader: users.displayName,
  };
  // own-property check: the URL value is untrusted, 'constructor' etc. must not match
  const sortKey =
    opts.sort && Object.hasOwn(sortCols, opts.sort) ? opts.sort : undefined;
  const col = sortCols[sortKey ?? 'created'];
  const ord = (opts.dir ?? (sortKey ? 'asc' : 'desc')) === 'asc' ? asc : desc;
  return [ord(col), ord(materials.id)] as const;
}

/** All files of the selection (CSV export; no row cap). */
export async function listExplorerFiles(
  db: Db,
  subjectId: number,
  sel: ExplorerParams,
  opts: ExplorerFileOpts,
): Promise<ExplorerFile[]> {
  const rows = await explorerFileSelect(db)
    .where(explorerFileWhere(subjectId, sel, opts))
    .orderBy(...explorerFileOrder(opts));
  return rows.map(toExplorerFile);
}

/**
 * One page of the selection's files plus the total count (subject Pliki grid).
 * `page` is clamped to the last page.
 */
export async function pageExplorerFiles(
  db: Db,
  subjectId: number,
  sel: ExplorerParams,
  opts: ExplorerFileOpts & { page: number; perPage: number },
): Promise<{
  files: ExplorerFile[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const where = explorerFileWhere(subjectId, sel, opts);
  const [{ n }] = await db
    .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(materials)
    .innerJoin(topics, eq(topics.id, materials.topicId))
    .innerJoin(users, eq(users.id, materials.uploaderId))
    .leftJoin(classes, eq(classes.id, topics.classId))
    .leftJoin(classGroups, eq(classGroups.id, topics.groupId))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(n / opts.perPage));
  const page = Math.min(Math.max(1, Math.floor(opts.page)), pageCount);
  const rows = await explorerFileSelect(db)
    .where(where)
    .orderBy(...explorerFileOrder(opts))
    .limit(opts.perPage)
    .offset((page - 1) * opts.perPage);
  return { files: rows.map(toExplorerFile), total: n, page, pageCount };
}

export async function getExplorerFile(
  db: Db,
  subjectId: number,
  materialId: number,
): Promise<ExplorerFile | null> {
  const [r] = await explorerFileSelect(db)
    .where(
      and(
        eq(materials.id, materialId),
        eq(topics.subjectId, subjectId),
        isNull(topics.deletedAt),
        isNull(materials.deletedAt),
      ),
    )
    .limit(1);
  return r ? toExplorerFile(r) : null;
}

/** A live file from any subject (table-browser preview drawer). */
export async function getMaterialFile(
  db: Db,
  materialId: number,
): Promise<ExplorerFile | null> {
  const [r] = await explorerFileSelect(db)
    .where(
      and(
        eq(materials.id, materialId),
        isNull(topics.deletedAt),
        isNull(materials.deletedAt),
      ),
    )
    .limit(1);
  return r ? toExplorerFile(r) : null;
}

export type SubjectClass = {
  id: number;
  kind: ClassKind;
  name: string;
  groups: { id: number; number: number; name: string }[];
};

/** Every class and group of a subject, also those without topics (nav tree links to them). */
export async function listSubjectClasses(
  db: Db,
  subjectId: number,
): Promise<SubjectClass[]> {
  const rows = await db
    .select({
      id: classes.id,
      kind: classes.kind,
      name: classes.name,
      groupId: classGroups.id,
      groupNumber: classGroups.number,
      groupName: classGroups.name,
    })
    .from(classes)
    .leftJoin(classGroups, eq(classGroups.classId, classes.id))
    .where(eq(classes.subjectId, subjectId))
    .orderBy(asc(classes.id), asc(classGroups.number));
  const byId = new Map<number, SubjectClass>();
  for (const r of rows) {
    let c = byId.get(r.id);
    if (!c) {
      c = { id: r.id, kind: r.kind, name: r.name, groups: [] };
      byId.set(r.id, c);
    }
    if (r.groupId != null && r.groupNumber != null) {
      c.groups.push({
        id: r.groupId,
        number: r.groupNumber,
        name: r.groupName ?? groupName(r.groupNumber),
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
}

/**
 * URL selection checked against the subject: class and group must exist (they
 * may be empty, so the grid shows no rows rather than the whole subject); a
 * topic must be a live topic of the subject and then fixes class/group itself
 * (as resolveSelection does). Invalid segments are dropped.
 */
export function resolveSubjectSelection(
  classList: SubjectClass[],
  tree: TreeClass[],
  p: ExplorerParams,
): ExplorerParams {
  if (p.topic != null) {
    const byTopic = resolveSelection(tree, p);
    if (byTopic.topic != null) return byTopic;
  }
  const out: ExplorerParams = {
    ...p,
    classKind: null,
    group: null,
    topic: null,
  };
  if (p.classKind === 'none') {
    out.classKind = 'none';
    return out;
  }
  const cls = p.classKind
    ? classList.find((c) => c.kind === p.classKind)
    : undefined;
  if (!cls) return out;
  out.classKind = cls.kind;
  if (p.group != null && cls.groups.some((g) => g.number === p.group)) {
    out.group = p.group;
  }
  return out;
}

export type SubjectLecturer = {
  className: string;
  groupName: string | null;
  name: string;
  title: string | null;
  email: string | null;
};

/** class_lecturers of a subject (v_class_lecturers joined to names), class order then group. */
export async function listSubjectLecturers(
  db: Db,
  subjectId: number,
): Promise<SubjectLecturer[]> {
  const rows = await db
    .select({
      kind: classes.kind,
      className: classes.name,
      groupNumber: classGroups.number,
      groupName: classGroups.name,
      name: lecturers.name,
      title: lecturers.title,
      email: lecturers.email,
    })
    .from(classLecturers)
    .innerJoin(classes, eq(classes.id, classLecturers.classId))
    .innerJoin(lecturers, eq(lecturers.id, classLecturers.lecturerId))
    .leftJoin(classGroups, eq(classGroups.id, classLecturers.groupId))
    .where(eq(classes.subjectId, subjectId))
    .orderBy(asc(classes.id), asc(classGroups.number), asc(lecturers.name));
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.r.kind) - KIND_ORDER.indexOf(b.r.kind) ||
        a.i - b.i,
    )
    .map(({ r }) => ({
      className: r.className,
      groupName:
        r.groupNumber == null
          ? null
          : (r.groupName ?? groupName(r.groupNumber)),
      name: r.name,
      title: r.title,
      email: r.email,
    }));
}

// ---------------------------------------------------------------------------
// Navigation panel
// ---------------------------------------------------------------------------

/** Live files (file and topic not soft-deleted) of topics matching `cond`. */
const liveFiles = (cond: SQL) =>
  sql<number>`(SELECT COUNT(*) FROM materials m JOIN topics t ON t.id = m.topic_id WHERE m.deleted_at IS NULL AND t.deleted_at IS NULL AND ${cond})`.mapWith(
    Number,
  );

/**
 * Subjects -> classes -> groups with live file counts, in one query. Every
 * class and group is listed (also empty ones); "Bez kategorii" is added only
 * when the subject has files in topics without a class.
 */
export async function getNavSubjects(db: Db): Promise<NavSubject[]> {
  const rows = await db
    .select({
      code: subjects.code,
      name: subjects.name,
      subjectFiles: liveFiles(sql`t.subject_id = ${subjects.id}`),
      noClassFiles: liveFiles(
        sql`t.subject_id = ${subjects.id} AND t.class_id IS NULL`,
      ),
      kind: classes.kind,
      className: classes.name,
      classFiles: liveFiles(sql`t.class_id = ${classes.id}`),
      groupNumber: classGroups.number,
      groupName: classGroups.name,
      groupFiles: liveFiles(sql`t.group_id = ${classGroups.id}`),
    })
    .from(subjects)
    .leftJoin(classes, eq(classes.subjectId, subjects.id))
    .leftJoin(classGroups, eq(classGroups.classId, classes.id))
    .orderBy(asc(subjects.name), asc(subjects.code), asc(classGroups.number));

  const out: (NavSubject & { none: number })[] = [];
  const bySubject = new Map<string, NavSubject & { none: number }>();
  for (const r of rows) {
    let s = bySubject.get(r.code);
    if (!s) {
      s = {
        code: r.code,
        name: r.name,
        fileCount: r.subjectFiles,
        href: explorerHref(r.code, {}),
        classes: [],
        none: r.noClassFiles,
      };
      bySubject.set(r.code, s);
      out.push(s);
    }
    if (r.kind == null) continue;
    const kind = r.kind;
    let c = s.classes.find((x) => x.kind === kind);
    if (!c) {
      c = {
        kind,
        name: r.className ?? CLASS_NAMES[kind],
        fileCount: r.classFiles,
        href: explorerHref(r.code, { classKind: kind }),
        groups: [],
      };
      s.classes.push(c);
    }
    if (r.groupNumber != null) {
      c.groups.push({
        number: r.groupNumber,
        name: r.groupName ?? groupName(r.groupNumber),
        fileCount: r.groupFiles,
        href: explorerHref(r.code, { classKind: kind, group: r.groupNumber }),
      });
    }
  }
  return out.map(({ none, ...s }) => {
    const classes: NavClass[] = KIND_ORDER.flatMap((k) =>
      s.classes.filter((c) => c.kind === k),
    );
    if (none > 0) {
      classes.push({
        kind: 'none',
        name: NONE_NAME,
        fileCount: none,
        href: explorerHref(s.code, { classKind: 'none' }),
        groups: [],
      });
    }
    return { ...s, classes };
  });
}
