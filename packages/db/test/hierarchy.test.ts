import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import {
  assignTopicHierarchy,
  backfillTopicHierarchy,
  classifyTags,
  ensureClass,
  ensureGroup,
  groupName,
} from '../src/hierarchy.js';
import {
  classes,
  classGroups,
  subjects,
  tags,
  topics,
  topicTags,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

describe('classifyTags', () => {
  const cases: [string[], string | null, number | null][] = [
    [['Wykład'], 'wyklad', null],
    [['LAB', 'Gr. 3'], 'laboratorium', 3],
    [['Ćwiczenia', 'Gr.3'], 'cwiczenia', 3],
    [['cw', 'grupa 12'], 'cwiczenia', 12],
    [['G3'], null, 3],
    [['gr 03'], null, 3],
    [['Gr. 0'], null, null],
    [['Gr. 100'], null, null],
    [['Kolokwium'], null, null],
    [['Laboratorium', 'Ćwiczenia'], 'laboratorium', null],
    [[' wyklad '], 'wyklad', null],
    [['Laborki', 'Projekt'], 'laboratorium', null],
    [['Seminarium'], 'seminarium', null],
    [['Projekt', 'Gr. 1', 'Gr. 2'], 'projekt', 1],
  ];
  it.each(cases)('%j', (tagNames, classKind, groupNumber) => {
    expect(classifyTags(tagNames)).toEqual({ classKind, groupNumber });
  });
  it('groupName', () => expect(groupName(4)).toBe('Gr. 4'));
});

let db: Db;
let subjectId: number;
let n = 0;

async function mkTopic(tagNames: string[], classified = false) {
  n++;
  const [t] = await db
    .insert(topics)
    .values({ subjectId, title: `T${n}`, discordThreadId: `ht-${n}` })
    .$returningId();
  for (const name of tagNames) {
    const [g] = await db
      .insert(tags)
      .values({ subjectId, name, discordTagId: `htag-${n}-${name}` })
      .$returningId();
    await db.insert(topicTags).values({ topicId: t.id, tagId: g.id });
  }
  if (classified) {
    const cid = await ensureClass(db, subjectId, 'projekt');
    await db.update(topics).set({ classId: cid }).where(eq(topics.id, t.id));
  }
  return t.id;
}

beforeAll(async () => {
  db = await resetTestDb();
  const [s] = await db
    .insert(subjects)
    .values({
      name: 'X',
      code: 'HX',
      semester: 1,
      ects: 1,
      discordChannelId: 'hx-c',
    })
    .$returningId();
  subjectId = s.id;
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('ensure helpers', () => {
  it('ensureClass concurrent -> one row', async () => {
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => ensureClass(db, subjectId, 'wyklad')),
    );
    expect(new Set(ids).size).toBe(1);
    const rows = await db
      .select()
      .from(classes)
      .where(eq(classes.kind, 'wyklad'));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Wykład');
  });
  it('ensureGroup concurrent -> one row', async () => {
    const cid = await ensureClass(db, subjectId, 'laboratorium');
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => ensureGroup(db, cid, 7)),
    );
    expect(new Set(ids).size).toBe(1);
    const rows = await db
      .select()
      .from(classGroups)
      .where(eq(classGroups.classId, cid));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Gr. 7');
  });
});

describe('ensure helpers with a missing parent', () => {
  // INSERT IGNORE swallows the FK error, so the follow-up SELECT finds nothing.
  it('ensureClass throws a descriptive error', async () => {
    await expect(ensureClass(db, 999_999, 'wyklad')).rejects.toThrow(
      'ensureClass: no wyklad class for subject 999999',
    );
  });
  it('ensureGroup throws a descriptive error', async () => {
    await expect(ensureGroup(db, 999_999, 2)).rejects.toThrow(
      'ensureGroup: no group 2 for class 999999',
    );
  });
});

describe('assignTopicHierarchy', () => {
  it('sets ids, ignores group without class, and moves on re-run', async () => {
    const id = await mkTopic([]);
    const r1 = await assignTopicHierarchy(db, id, subjectId, ['Lab', 'Gr. 2']);
    expect(r1.classId).not.toBeNull();
    expect(r1.groupId).not.toBeNull();
    const [row] = await db.select().from(topics).where(eq(topics.id, id));
    expect(row.classId).toBe(r1.classId);
    expect(row.groupId).toBe(r1.groupId);

    const r2 = await assignTopicHierarchy(db, id, subjectId, ['G3']);
    expect(r2).toEqual({ classId: null, groupId: null });
    const [row2] = await db.select().from(topics).where(eq(topics.id, id));
    expect(row2.classId).toBeNull();
    expect(row2.groupId).toBeNull();

    const r3 = await assignTopicHierarchy(db, id, subjectId, ['Wykład']);
    expect(r3.classId).not.toBe(r1.classId);
    expect(r3.groupId).toBeNull();
  });
});

describe('backfillTopicHierarchy', () => {
  it('classifies unclassified, skips classified and deleted', async () => {
    const a = await mkTopic(['Ćwiczenia', 'Gr. 5']);
    const b = await mkTopic(['Kolokwium']);
    const c = await mkTopic(['Projekt'], true);
    const d = await mkTopic(['Seminarium']);
    await db
      .update(topics)
      .set({ deletedAt: new Date() })
      .where(eq(topics.id, d));
    const count = await backfillTopicHierarchy(db);
    const get = async (id: number) =>
      (await db.select().from(topics).where(eq(topics.id, id)))[0];
    expect((await get(a)).classId).not.toBeNull();
    expect((await get(a)).groupId).not.toBeNull();
    expect((await get(b)).classId).toBeNull();
    expect((await get(d)).classId).toBeNull();
    expect((await get(c)).groupId).toBeNull();
    expect(count).toBe(1);
    expect(await backfillTopicHierarchy(db)).toBe(0);
  });

  it('skips a topic with subject_id NULL', async () => {
    const [t] = await db
      .insert(topics)
      .values({ title: 'Bez przedmiotu', discordThreadId: 'null-subj-1' })
      .$returningId();
    expect(await backfillTopicHierarchy(db)).toBe(0);
    const [row] = await db.select().from(topics).where(eq(topics.id, t.id));
    expect(row.classId).toBeNull();
  });
});
