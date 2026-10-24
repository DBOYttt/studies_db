import {
  classes,
  classGroups,
  classSessions,
  type Db,
  insertMaterial,
  materials,
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
import { nextSessions } from '../lib/plan-queries';
import {
  listSimpleFiles,
  listSubjectCards,
  searchSimpleFiles,
} from '../lib/simple-queries';

let db: Db;
let ro: mysql.Pool;
const id: Record<string, number> = {};
const mid: Record<string, number> = {};
const T = (d: number) => new Date(Date.UTC(2026, 8, d, 12));

async function mkMat(
  key: string,
  topicId: number,
  uploaderId: number,
  filename: string,
  day: number,
  extractedText?: string,
) {
  const n = Object.keys(mid).length + 1;
  const r = await insertMaterial(
    db,
    {
      topicId,
      uploaderId,
      discordMessageId: `m${n}`,
      discordAttachmentId: `a${n}`,
      originalFilename: filename,
      mimeType: 'application/pdf',
      sizeBytes: 10 * n,
      sha256: String(n).padStart(64, '0'),
      storagePath: `p${n}`,
      previewKind: 'pdf',
      createdAt: T(day),
    },
    [],
  );
  mid[key] = r.materialId;
  if (extractedText)
    await db
      .update(materials)
      .set({ extractedText })
      .where(eq(materials.id, r.materialId));
}

beforeAll(async () => {
  db = await resetTestDb();
  ro = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 3,
  });
  const mkSub = async (name: string, code: string, semester: number) =>
    (
      await db
        .insert(subjects)
        .values({ name, code, semester, ects: 5 })
        .$returningId()
    )[0].id;
  id.fiz = await mkSub('Fizyka', 'FIZ', 2);
  id.alg = await mkSub('Algebra', 'ALG', 1);
  id.pus = await mkSub('Pusty', 'PUS', 1); // no files, no classes
  const mkClass = async (
    subjectId: number,
    kind: 'wyklad' | 'cwiczenia' | 'laboratorium',
  ) =>
    (
      await db
        .insert(classes)
        .values({ subjectId, kind, name: kind })
        .$returningId()
    )[0].id;
  // inserted out of CLASS_KINDS order on purpose
  id.fizCw = await mkClass(id.fiz, 'cwiczenia');
  id.fizWy = await mkClass(id.fiz, 'wyklad');
  id.algWy = await mkClass(id.alg, 'wyklad');
  id.algCw = await mkClass(id.alg, 'cwiczenia');
  // makes group ids differ from group numbers
  await db
    .insert(classGroups)
    .values({ classId: id.algWy, number: 1, name: 'Alg 1' });
  [{ id: id.g1 }] = await db
    .insert(classGroups)
    .values({ classId: id.fizCw, number: 1, name: 'Gr. 1' })
    .$returningId();
  [{ id: id.g2 }] = await db
    .insert(classGroups)
    .values({ classId: id.fizCw, number: 2, name: 'Gr. 2' })
    .$returningId();
  [{ id: id.ag1 }] = await db
    .insert(classGroups)
    .values({ classId: id.algCw, number: 1, name: 'Alg cw 1' })
    .$returningId();
  const uid = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ann',
    avatarUrl: null,
  });
  const mkTopic = async (
    subjectId: number,
    title: string,
    n: number,
    classId?: number,
    groupId?: number,
  ) =>
    (
      await db
        .insert(topics)
        .values({
          subjectId,
          title,
          discordThreadId: `th${n}`,
          classId: classId ?? null,
          groupId: groupId ?? null,
        })
        .$returningId()
    )[0].id;
  id.t1 = await mkTopic(id.fiz, 'Kinematyka', 1, id.fizWy);
  id.t2 = await mkTopic(id.fiz, 'Dynamika', 2, id.fizCw, id.g1);
  id.t3 = await mkTopic(id.alg, 'Macierze', 3, id.algWy);
  id.t4 = await mkTopic(id.fiz, 'Bez zajęć', 4);
  id.t5 = await mkTopic(id.alg, 'Grupy', 5, id.algCw, id.ag1);
  [{ id: id.tag }] = await db
    .insert(tags)
    .values({ subjectId: id.fiz, name: 'Kolokwium', discordTagId: 'tg1' })
    .$returningId();
  await db.insert(topicTags).values({ topicId: id.t2, tagId: id.tag });
  await mkMat('a', id.t1, uid, 'wykres.pdf', 1);
  await mkMat('b', id.t2, uid, '100%_done.pdf', 3);
  await mkMat('c', id.t3, uid, 'macierze.pdf', 2);
  await mkMat('alggr', id.t5, uid, 'inne.pdf', 0);
  await mkMat('del', id.t1, uid, 'usuniety.pdf', 4);
  await mkMat(
    'ft',
    id.t4,
    uid,
    'notatki.pdf',
    5,
    'entropia układu zamkniętego',
  );
  await mkMat('both', id.t4, uid, 'zebra.pdf', 6, 'zebra zebra');
  await db
    .update(materials)
    .set({ deletedAt: new Date() })
    .where(eq(materials.id, mid.del));
  const sess = async (
    n: number,
    subjectId: number,
    start: Date,
    kind: 'class' | 'exam' = 'class',
  ) =>
    db.insert(classSessions).values({
      kind,
      uid: `uid${n}`,
      occurrenceStart: start,
      startsAt: start,
      endsAt: new Date(start.getTime() + 5_400_000),
      label: `s${n}`,
      subjectId,
      status: 'confirmed',
    });
  await sess(1, id.fiz, new Date(Date.UTC(2026, 9, 1, 8)));
  await sess(2, id.fiz, new Date(Date.UTC(2026, 9, 3, 8)));
  await sess(3, id.fiz, new Date(Date.UTC(2026, 9, 5, 8)));
  await sess(4, id.fiz, new Date(Date.UTC(2026, 9, 7, 8)));
  await sess(5, id.fiz, new Date(Date.UTC(2026, 8, 1, 8))); // past
  await sess(6, id.alg, new Date(Date.UTC(2026, 9, 2, 8)));
  await sess(7, id.alg, new Date(Date.UTC(2026, 9, 9, 8)), 'exam');
});

afterAll(async () => {
  await ro.end();
  await closeTestDb(db);
});

describe('listSubjectCards', () => {
  it('orders by semester, name and aggregates live files', async () => {
    const cards = await listSubjectCards(db);
    expect(cards.map((c) => c.code)).toEqual(['ALG', 'PUS', 'FIZ']);
    const fiz = cards.find((c) => c.code === 'FIZ');
    expect(fiz?.kinds).toEqual(['wyklad', 'cwiczenia']);
    expect(fiz?.fileCount).toBe(4); // wykres, 100%_done, notatki, zebra
    expect(fiz?.lastUpload).toEqual(T(6));
    const alg = cards.find((c) => c.code === 'ALG');
    expect(alg?.fileCount).toBe(2);
    expect(alg?.lastUpload).toEqual(T(2));
  });
  it('handles a subject with no files, classes or tags', async () => {
    const pus = (await listSubjectCards(db)).find((c) => c.code === 'PUS');
    expect(pus).toMatchObject({ kinds: [], fileCount: 0, lastUpload: null });
  });
});

describe('listSimpleFiles', () => {
  it('lists live files newest first with total', async () => {
    const r = await listSimpleFiles(db, { limit: 50 });
    expect(r.total).toBe(6);
    expect(r.rows.map((x) => x.filename)).toEqual([
      'zebra.pdf',
      'notatki.pdf',
      '100%_done.pdf',
      'macierze.pdf',
      'wykres.pdf',
      'inne.pdf',
    ]);
    const b = r.rows.find((x) => x.filename === '100%_done.pdf');
    expect(b).toMatchObject({
      subjectCode: 'FIZ',
      topicTitle: 'Dynamika',
      groupName: 'Gr. 1',
      uploader: 'Ann',
      previewKind: 'pdf',
      status: 'ready',
    });
    expect(r.rows[0].className).toBeNull();
  });
  it('paginates but keeps the total', async () => {
    const r = await listSimpleFiles(db, { limit: 2, offset: 2 });
    expect(r.total).toBe(6);
    expect(r.rows.map((x) => x.filename)).toEqual([
      '100%_done.pdf',
      'macierze.pdf',
    ]);
  });
  it('filters by subject, kind, group and tag', async () => {
    const f = async (o: Parameters<typeof listSimpleFiles>[1]) =>
      (await listSimpleFiles(db, o)).rows.map((x) => x.filename);
    expect(await f({ subjectId: id.alg, limit: 9 })).toEqual([
      'macierze.pdf',
      'inne.pdf',
    ]);
    expect(await f({ subjectId: id.fiz, kind: 'wyklad', limit: 9 })).toEqual([
      'wykres.pdf',
    ]);
    expect(await f({ subjectId: id.fiz, kind: 'cwiczenia', limit: 9 })).toEqual(
      ['100%_done.pdf'],
    );
    expect(id.g1).not.toBe(1);
    const cw = { subjectId: id.fiz, kind: 'cwiczenia' as const, limit: 9 };
    expect(await f({ ...cw, group: 1 })).toEqual(['100%_done.pdf']);
    // 2 is g1's id but the number of the (empty) second group
    expect(await f({ ...cw, group: 2 })).toEqual([]);
    expect(await f({ ...cw, group: id.g1 })).toEqual([]);
    // a group number without a kind is ignored
    expect(await f({ group: 1, limit: 9 })).toHaveLength(6);
    // group 2 matches no file, so applying it would give 0 rows
    expect(await f({ kind: 'cwiczenia', group: 2, limit: 9 })).toHaveLength(2);
    // another subject's cwiczenia also has group number 1: scoped by subject
    expect(
      await f({ subjectId: id.alg, kind: 'cwiczenia', group: 1, limit: 9 }),
    ).toEqual(['inne.pdf']);
    expect(await f({ tagId: id.tag, limit: 9 })).toEqual(['100%_done.pdf']);
    expect(await f({ subjectId: id.pus, limit: 9 })).toEqual([]);
    const empty = await listSimpleFiles(db, { subjectId: id.pus, limit: 9 });
    expect(empty.total).toBe(0);
  });
});

describe('searchSimpleFiles', () => {
  const names = async (q: string) =>
    (await searchSimpleFiles(db, q)).map((x) => x.filename);
  it('returns [] for a blank query', async () => {
    expect(await names('')).toEqual([]);
    expect(await names('   ')).toEqual([]);
  });
  it('matches % and _ literally', async () => {
    expect(await names('100%')).toEqual(['100%_done.pdf']);
    expect(await names('%')).toEqual(['100%_done.pdf']);
    expect(await names('_')).toEqual(['100%_done.pdf']);
    expect(await names('\\')).toEqual([]);
  });
  it('matches filename, topic and subject, ignoring deleted files', async () => {
    expect(await names('dynam')).toEqual(['100%_done.pdf']);
    expect(await names('algebra')).toEqual(['macierze.pdf', 'inne.pdf']);
    expect(await names('usuniety')).toEqual([]);
  });
  it('adds full-text content hits after LIKE hits, without duplicates', async () => {
    expect(await names('entropia')).toEqual(['notatki.pdf']);
    expect(await names('zebra')).toEqual(['zebra.pdf']);
  });
  it('survives search metacharacters and honours the limit', async () => {
    for (const q of ['(', '[', '"', '+-', 'a'.repeat(300)])
      await expect(searchSimpleFiles(db, q)).resolves.toBeInstanceOf(Array);
    expect(await searchSimpleFiles(db, 'pdf', 2)).toHaveLength(2);
  });
});

describe('nextSessions', () => {
  const now = new Date(Date.UTC(2026, 9, 2, 8)); // wall 2026-10-02 08:00
  it('returns upcoming sessions of the subject, soonest first, capped', async () => {
    const r = await nextSessions(ro, id.fiz, now);
    expect(r.map((s) => s.label)).toEqual(['s2', 's3', 's4']);
    expect(r[0].startsAt).toEqual(new Date(Date.UTC(2026, 9, 3, 8)));
    expect(
      (await nextSessions(ro, id.fiz, now, 2)).map((s) => s.label),
    ).toEqual(['s2', 's3']);
  });
  it('includes a session starting exactly now and is empty without sessions', async () => {
    const r = await nextSessions(ro, id.alg, new Date(Date.UTC(2026, 9, 2, 8)));
    expect(r.map((s) => s.label)).toEqual(['s6', 's7']);
    expect(await nextSessions(ro, id.pus, now)).toEqual([]);
  });
  it('carries the session kind (an exam is an exam)', async () => {
    const r = await nextSessions(ro, id.alg, now);
    expect(r.map((s) => s.sessionKind)).toEqual(['class', 'exam']);
  });
});
