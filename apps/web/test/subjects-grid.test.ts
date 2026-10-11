import {
  classes,
  type Db,
  insertMaterial,
  materials,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { RO_POOL_OPTIONS } = await import('../lib/db');
const { querySubjectsGrid, SUBJECTS_SQL } = await import(
  '../lib/subjects-grid'
);

let db: Db;
let pool: mysql.Pool;

beforeAll(async () => {
  process.env.DISCORD_GUILD_ID = 'guild1';
  db = await resetTestDb();
  pool = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 2,
  });
  const mkSubject = async (code: string, name: string, semester: number) =>
    (
      await db
        .insert(subjects)
        .values({ code, name, semester, ects: 4, discordChannelId: code })
        .$returningId()
    )[0].id;
  const fiz = await mkSubject('FIZ', 'Fizyka', 2);
  await mkSubject('ALG', 'Algebra', 1);
  await mkSubject('BIO', 'Biologia', 1);
  // Inserted out of CLASS_KINDS order on purpose; no topics in some classes.
  for (const [kind, name] of [
    ['cwiczenia', 'Ćwiczenia'],
    ['projekt', 'Projekt'],
    ['wyklad', 'Wykład'],
  ] as const) {
    await db.insert(classes).values({ subjectId: fiz, kind, name });
  }
  const userId = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ala',
    avatarUrl: null,
  });
  const [{ id: topic }] = await db
    .insert(topics)
    .values({ subjectId: fiz, title: 'T', discordThreadId: 'th1' })
    .$returningId();
  for (let n = 1; n <= 3; n++) {
    const r = await insertMaterial(
      db,
      {
        topicId: topic,
        uploaderId: userId,
        discordMessageId: `m${n}`,
        discordAttachmentId: `a${n}`,
        originalFilename: `f${n}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: n,
        sha256: String(n).padStart(64, '0'),
        storagePath: `p${n}`,
        previewKind: 'pdf',
      },
      [],
    );
    if (n === 3) {
      await db
        .update(materials)
        .set({ deletedAt: new Date() })
        .where(eq(materials.id, r.materialId));
    }
  }
});

afterAll(async () => {
  await pool.end();
  await closeTestDb(db);
});

describe('querySubjectsGrid', () => {
  it('orders by semester, name and reads every class in CLASS_KINDS order', async () => {
    const rows = await querySubjectsGrid(pool);
    expect(rows.map((r) => r.code)).toEqual(['ALG', 'BIO', 'FIZ']);
    const fiz = rows.find((r) => r.code === 'FIZ');
    expect(fiz?.zajecia).toBe('Wykład, Ćwiczenia, Projekt');
    expect(rows.find((r) => r.code === 'ALG')?.zajecia).toBeNull();
  });

  it('counts live files only (no join fan-out)', async () => {
    const rows = await querySubjectsGrid(pool);
    const fiz = rows.find((r) => r.code === 'FIZ');
    expect(fiz?.pliki).toBe(2);
    expect(fiz?.ostatnio).toBeInstanceOf(Date);
    const alg = rows.find((r) => r.code === 'ALG');
    expect(alg?.pliki).toBe(0);
    expect(alg?.ostatnio).toBeNull();
  });

  it('reads public views only', () => {
    const from = [...SUBJECTS_SQL.matchAll(/`(\w+)`/g)].map((m) => m[1]);
    expect(new Set(from)).toEqual(
      new Set(['v_classes', 'v_files', 'v_subjects']),
    );
  });
});
