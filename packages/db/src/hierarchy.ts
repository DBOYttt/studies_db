import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db, DbExecutor } from './client.js';
import {
  CLASS_NAMES,
  type ClassKind,
  classes,
  classGroups,
  tags,
  topics,
  topicTags,
} from './schema.js';
import { stripMarks } from './search.js';

const CLASS_ALIASES: Record<string, ClassKind> = {
  wyklad: 'wyklad',
  lab: 'laboratorium',
  laboratorium: 'laboratorium',
  laborki: 'laboratorium',
  cwiczenia: 'cwiczenia',
  cw: 'cwiczenia',
  projekt: 'projekt',
  seminarium: 'seminarium',
};
const GROUP_RE = /^(gr\.?|grupa|g)\s*0*(\d{1,2})$/;

export function groupName(n: number): string {
  return `Gr. ${n}`;
}

export function classifyTags(tagNames: string[]): {
  classKind: ClassKind | null;
  groupNumber: number | null;
} {
  let classKind: ClassKind | null = null;
  let groupNumber: number | null = null;
  for (const raw of tagNames) {
    const t = stripMarks(raw.trim()).toLowerCase();
    if (classKind === null && Object.hasOwn(CLASS_ALIASES, t)) {
      classKind = CLASS_ALIASES[t];
      continue;
    }
    if (groupNumber === null) {
      const m = GROUP_RE.exec(t);
      const n = m ? Number(m[2]) : 0;
      if (n >= 1 && n <= 99) groupNumber = n;
    }
  }
  return { classKind, groupNumber };
}

export async function ensureClass(
  db: DbExecutor,
  subjectId: number,
  kind: ClassKind,
): Promise<number> {
  await db
    .insert(classes)
    .ignore()
    .values({ subjectId, kind, name: CLASS_NAMES[kind] });
  const [row] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.subjectId, subjectId), eq(classes.kind, kind)));
  if (!row)
    throw new Error(
      `ensureClass: no ${kind} class for subject ${subjectId} (does the subject exist?)`,
    );
  return row.id;
}

export async function ensureGroup(
  db: DbExecutor,
  classId: number,
  number: number,
): Promise<number> {
  await db
    .insert(classGroups)
    .ignore()
    .values({ classId, number, name: groupName(number) });
  const [row] = await db
    .select({ id: classGroups.id })
    .from(classGroups)
    .where(
      and(eq(classGroups.classId, classId), eq(classGroups.number, number)),
    );
  if (!row)
    throw new Error(
      `ensureGroup: no group ${number} for class ${classId} (does the class exist?)`,
    );
  return row.id;
}

export async function assignTopicHierarchy(
  db: DbExecutor,
  topicId: number,
  subjectId: number,
  tagNames: string[],
): Promise<{ classId: number | null; groupId: number | null }> {
  const { classKind, groupNumber } = classifyTags(tagNames);
  let classId: number | null = null;
  let groupId: number | null = null;
  if (classKind) {
    classId = await ensureClass(db, subjectId, classKind);
    if (groupNumber !== null)
      groupId = await ensureGroup(db, classId, groupNumber);
  }
  await db
    .update(topics)
    .set({ classId, groupId })
    .where(eq(topics.id, topicId));
  return { classId, groupId };
}

export async function backfillTopicHierarchy(db: Db): Promise<number> {
  const pending = await db
    .select({ id: topics.id, subjectId: topics.subjectId })
    .from(topics)
    .where(and(isNull(topics.classId), isNull(topics.deletedAt)));
  let updated = 0;
  for (const t of pending) {
    const rows = await db
      .select({ name: tags.name })
      .from(topicTags)
      .innerJoin(tags, eq(tags.id, topicTags.tagId))
      .where(eq(topicTags.topicId, t.id))
      .orderBy(asc(tags.id));
    const { classId } = await assignTopicHierarchy(
      db,
      t.id,
      t.subjectId,
      rows.map((r) => r.name),
    );
    if (classId !== null) updated++;
  }
  return updated;
}
