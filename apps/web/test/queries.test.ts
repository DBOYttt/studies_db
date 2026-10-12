import {
  classes,
  classGroups,
  classLecturers,
  type Db,
  insertMaterial,
  lecturers,
  subjects,
  tags,
  topics,
  topicTags,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RO_POOL_OPTIONS } from '../lib/db';
import { EXAMPLE_QUERIES } from '../lib/example-queries';
import { getSubject, listTopics, loadLinkContext } from '../lib/queries';
import { runReadonlyQuery } from '../lib/sql-console';

let db: Db;
let roPool: mysql.Pool;
let subjectId: number;
let topicA: number;
let topicB: number;
let tagId: number;
let deletedMaterial: number;

const mat = (topicId: number, uploaderId: number, n: number) => ({
  topicId,
  uploaderId,
  discordMessageId: `msg${n}`,
  discordAttachmentId: `att${n}`,
  originalFilename: `plik${n}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 100 * n,
  sha256: String(n).padStart(64, '0'),
  storagePath: `p${n}`,
  previewKind: 'pdf' as const,
});

beforeAll(async () => {
  process.env.DISCORD_GUILD_ID = 'guild1';
  db = await resetTestDb();
  roPool = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 3,
  });
  [{ id: subjectId }] = await db
    .insert(subjects)
    .values({
      name: 'Fizyka',
      code: 'FIZ',
      semester: 1,
      ects: 5,
      discordChannelId: 'c1',
      platformUrl: 'https://upel.example.edu/fiz',
    })
    .$returningId();
  await db.insert(subjects).values({
    name: 'Chemia',
    code: 'CHEM',
    semester: 2,
    ects: 4,
    discordChannelId: 'c2',
  });
  const [lec] = await db
    .insert(lecturers)
    .values({ name: 'Jan Kowalski', title: 'dr' })
    .$returningId();
  const [cls] = await db
    .insert(classes)
    .values({ subjectId, kind: 'wyklad', name: 'Wykład' })
    .$returningId();
  await db
    .insert(classLecturers)
    .values({ classId: cls.id, lecturerId: lec.id });
  const uid = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ann',
    avatarUrl: null,
  });
  [{ id: topicA }] = await db
    .insert(topics)
    .values({
      subjectId,
      title: 'Kolokwium 1',
      discordThreadId: 'th1',
      createdBy: uid,
    })
    .$returningId();
  [{ id: topicB }] = await db
    .insert(topics)
    .values({ subjectId, title: 'Wykład 2', discordThreadId: 'th2' })
    .$returningId();
  [{ id: tagId }] = await db
    .insert(tags)
    .values({ subjectId, name: 'Kolokwium', discordTagId: 'tg1' })
    .$returningId();
  await db.insert(topicTags).values({ topicId: topicA, tagId });
  await insertMaterial(db, mat(topicA, uid, 1), []);
  await insertMaterial(db, mat(topicA, uid, 2), []);
  const d = await insertMaterial(db, mat(topicB, uid, 3), []);
  deletedMaterial = d.materialId;
  const { materials } = await import('@studies/db');
  await db
    .update(materials)
    .set({ deletedAt: new Date() })
    .where(eq(materials.id, deletedMaterial));
});

afterAll(async () => {
  await roPool.end();
  await closeTestDb(db);
});

describe('loadLinkContext', () => {
  it('maps subjects, classes and groups', async () => {
    const [cls] = await db.select().from(classes);
    const [g] = await db
      .insert(classGroups)
      .values({ classId: cls.id, number: 2, name: 'Gr. 2' })
      .$returningId();
    const ctx = await loadLinkContext(db);
    expect(ctx.subjects.get(subjectId)).toBe('FIZ');
    expect(ctx.classes.get(cls.id)).toEqual({ code: 'FIZ', kind: 'wyklad' });
    expect(ctx.groups.get(g.id)).toEqual({
      code: 'FIZ',
      kind: 'wyklad',
      number: 2,
    });
  });
});

describe('getSubject / listTopics', () => {
  it('getSubject returns null for unknown code', async () => {
    expect(await getSubject(db, 'NOPE')).toBeNull();
    expect(await getSubject(db, 'FIZ')).toMatchObject({
      name: 'Fizyka',
      platformUrl: 'https://upel.example.edu/fiz',
    });
    expect((await getSubject(db, 'CHEM'))?.platformUrl).toBeNull();
  });
  it('lists topics with tags and file counts', async () => {
    const all = await listTopics(db, subjectId, {});
    expect(all.map((t) => t.title).sort()).toEqual(['Kolokwium 1', 'Wykład 2']);
    const a = all.find((t) => t.id === topicA);
    expect(a).toMatchObject({ fileCount: 2, author: 'Ann' });
    expect(a?.tags).toEqual([{ id: tagId, name: 'Kolokwium' }]);
    expect(all.find((t) => t.id === topicB)).toMatchObject({
      fileCount: 0,
      author: null,
    });
  });
  it('filters by tag', async () => {
    const f = await listTopics(db, subjectId, { tagId });
    expect(f.map((t) => t.id)).toEqual([topicA]);
  });
});

describe('example queries', () => {
  for (const ex of EXAMPLE_QUERIES) {
    it(ex.name, async () => {
      const r = await runReadonlyQuery(roPool, ex.sql);
      expect(r).toMatchObject({ ok: true });
    });
  }
  it('has exactly the three named examples', () => {
    expect(EXAMPLE_QUERIES.map((e) => e.name)).toEqual([
      'Materiały na przedmiot',
      'Najaktywniejsi uploaderzy',
      'Kolokwia z ostatnich 30 dni',
    ]);
  });
});
