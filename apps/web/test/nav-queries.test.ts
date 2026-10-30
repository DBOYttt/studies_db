import {
  classes,
  classGroups,
  type Db,
  insertMaterial,
  materials,
  PUBLIC_VIEWS,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RO_POOL_OPTIONS } from '../lib/db';
import { getNavSubjects } from '../lib/queries';
import { countViewRows } from '../lib/tables';

let db: Db;
let roPool: mysql.Pool;
let n = 0;

async function topic(
  subjectId: number,
  classId: number | null,
  groupId: number | null,
  deleted = false,
) {
  n++;
  const [{ id }] = await db
    .insert(topics)
    .values({
      subjectId,
      title: `T${n}`,
      discordThreadId: `th${n}`,
      classId,
      groupId,
      deletedAt: deleted ? new Date() : null,
    })
    .$returningId();
  return id;
}

async function file(topicId: number, uploaderId: number, deleted = false) {
  n++;
  const r = await insertMaterial(
    db,
    {
      topicId,
      uploaderId,
      discordMessageId: `m${n}`,
      discordAttachmentId: `a${n}`,
      originalFilename: `f${n}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 10,
      sha256: String(n).padStart(64, '0'),
      storagePath: `p${n}`,
      previewKind: 'pdf',
    },
    [],
  );
  if (deleted) {
    await db
      .update(materials)
      .set({ deletedAt: new Date() })
      .where(eq(materials.id, r.materialId));
  }
}

beforeAll(async () => {
  db = await resetTestDb();
  roPool = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 2,
  });
  const uid = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ann',
    avatarUrl: null,
  });
  const [{ id: fiz }] = await db
    .insert(subjects)
    .values({
      name: 'Fizyka',
      code: 'FIZ',
      semester: 2,
      ects: 5,
      discordChannelId: 'c1',
    })
    .$returningId();
  await db.insert(subjects).values({
    name: 'Algebra',
    code: 'ALG',
    semester: 1,
    ects: 4,
    discordChannelId: 'c2',
  });
  // inserted lab before lecture: output follows CLASS_KINDS order
  const [{ id: lab }] = await db
    .insert(classes)
    .values({ subjectId: fiz, kind: 'laboratorium', name: 'Laboratorium' })
    .$returningId();
  const [{ id: lec }] = await db
    .insert(classes)
    .values({ subjectId: fiz, kind: 'wyklad', name: 'Wykład' })
    .$returningId();
  const [{ id: g2 }] = await db
    .insert(classGroups)
    .values({ classId: lab, number: 2, name: 'Gr. 2' })
    .$returningId();
  await db
    .insert(classGroups)
    .values({ classId: lab, number: 1, name: 'Gr. 1' });

  const tLec = await topic(fiz, lec, null);
  await file(tLec, uid);
  await file(tLec, uid, true); // soft-deleted file: not counted
  const tG2 = await topic(fiz, lab, g2);
  await file(tG2, uid);
  await file(tG2, uid);
  const tDeleted = await topic(fiz, lec, null, true); // soft-deleted topic
  await file(tDeleted, uid);
  const tNone = await topic(fiz, null, null);
  await file(tNone, uid);
});

afterAll(async () => {
  await roPool.end();
  await closeTestDb(db);
});

describe('getNavSubjects semester', () => {
  it('lists only the subjects of the semester', async () => {
    expect((await getNavSubjects(db, 1)).map((s) => s.code)).toEqual(['ALG']);
    expect((await getNavSubjects(db, 2)).map((s) => s.code)).toEqual(['FIZ']);
    expect(await getNavSubjects(db, 5)).toEqual([]);
  });
});

describe('getNavSubjects', () => {
  it('lists subjects by name with classes, groups and live file counts', async () => {
    const nav = await getNavSubjects(db);
    expect(nav.map((s) => s.code)).toEqual(['ALG', 'FIZ']);
    expect(nav[0]).toEqual({
      code: 'ALG',
      name: 'Algebra',
      semester: 1,
      fileCount: 0,
      href: '/subjects/ALG',
      classes: [],
    });
    const fiz = nav[1];
    expect(fiz.fileCount).toBe(4);
    expect(fiz.classes).toEqual([
      {
        kind: 'wyklad',
        name: 'Wykład',
        fileCount: 1,
        href: '/subjects/FIZ?class=wyklad',
        groups: [],
      },
      {
        kind: 'laboratorium',
        name: 'Laboratorium',
        fileCount: 2,
        href: '/subjects/FIZ?class=laboratorium',
        groups: [
          {
            number: 1,
            name: 'Gr. 1',
            fileCount: 0,
            href: '/subjects/FIZ?class=laboratorium&group=1',
          },
          {
            number: 2,
            name: 'Gr. 2',
            fileCount: 2,
            href: '/subjects/FIZ?class=laboratorium&group=2',
          },
        ],
      },
      {
        kind: 'none',
        name: 'Uncategorized',
        fileCount: 1,
        href: '/subjects/FIZ?class=none',
        groups: [],
      },
    ]);
  });
});

describe('countViewRows', () => {
  it('counts every public view in one statement', async () => {
    const counts = await countViewRows(roPool);
    expect(Object.keys(counts ?? {}).sort()).toEqual([...PUBLIC_VIEWS].sort());
    expect(counts?.v_subjects).toBe(2);
    expect(counts?.v_classes).toBe(2);
    expect(counts?.v_class_groups).toBe(2);
  });

  it('returns null instead of throwing when the RO pool fails', async () => {
    const broken = mysql.createPool({
      ...RO_POOL_OPTIONS,
      uri: 'mysql://nobody:wrong@127.0.0.1:1/none',
      connectionLimit: 1,
    });
    try {
      expect(await countViewRows(broken)).toBeNull();
    } finally {
      await broken.end();
    }
  });
});
