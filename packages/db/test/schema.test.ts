import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { insertMaterial } from '../src/materials.js';
import {
  jobs,
  materials,
  PUBLIC_VIEWS,
  subjects,
  topics,
  users,
} from '../src/schema.js';
import { resetTestDb, testRoUrl } from '../src/testing.js';

const TABLES = [
  'subjects',
  'lecturers',
  'subject_lecturers',
  'topics',
  'tags',
  'topic_tags',
  'users',
  'materials',
  'jobs',
  'login_tokens',
  'sessions',
  'bot_state',
];

let db: Db;
let pool: mysql.Pool;
let topicId: number;
let uploaderId: number;

function base(attachment: string, extra: Record<string, unknown> = {}) {
  return {
    topicId,
    uploaderId,
    discordMessageId: 'm1',
    discordAttachmentId: attachment,
    originalFilename: `${attachment}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    storagePath: 'originals/aa/x.pdf',
    previewKind: 'pdf' as const,
    createdAt: new Date(),
    ...extra,
  };
}

beforeAll(async () => {
  db = await resetTestDb();
  pool = (db as unknown as { $client: mysql.Pool }).$client;
  const [s] = await db
    .insert(subjects)
    .values({
      name: 'Mechanika',
      code: 'MECH',
      semester: 1,
      ects: 5,
      discordChannelId: 'c1',
    })
    .$returningId();
  const [t] = await db
    .insert(topics)
    .values({ subjectId: s.id, title: 'Wykład 1', discordThreadId: 't1' })
    .$returningId();
  const [u] = await db
    .insert(users)
    .values({ discordUserId: 'u1', displayName: 'Ala' })
    .$returningId();
  topicId = t.id;
  uploaderId = u.id;
});

afterAll(async () => {
  await pool.end();
});

describe('schema', () => {
  it('creates all tables and views', async () => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>('SHOW FULL TABLES');
    const found = new Map(
      rows.map((r) => [Object.values(r)[0] as string, r.Table_type as string]),
    );
    for (const t of TABLES) expect(found.get(t)).toBe('BASE TABLE');
    for (const v of PUBLIC_VIEWS) expect(found.get(v)).toBe('VIEW');
  });

  it('v_materials hides paths, text and soft-deleted rows', async () => {
    await db.insert(materials).values(base('vm1'));
    await db.insert(materials).values(base('vm2', { deletedAt: new Date() }));
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM v_materials',
    );
    expect(rows).toHaveLength(1);
    const keys = Object.keys(rows[0]);
    for (const k of [
      'storage_path',
      'preview_path',
      'extracted_text',
      'sha256',
    ])
      expect(keys).not.toContain(k);
  });

  it('v_users hides discord ids and ban flag', async () => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM v_users',
    );
    expect(Object.keys(rows[0]).sort()).toEqual([
      'created_at',
      'display_name',
      'id',
    ]);
  });

  it('studies_ro can select views only', async () => {
    const ro = await mysql.createConnection(testRoUrl());
    try {
      const [rows] = await ro.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM v_subjects',
      );
      expect(Number(rows[0].n)).toBeGreaterThanOrEqual(1);
      for (const q of [
        'SELECT * FROM sessions',
        'SELECT * FROM materials',
        'SELECT * FROM jobs',
        'DELETE FROM v_subjects',
      ])
        await expect(ro.query(q)).rejects.toThrow(/denied/i);
    } finally {
      await ro.end();
    }
  });

  it('insertMaterial is idempotent on attachment id', async () => {
    const v = base('idem');
    const r = await Promise.all([
      insertMaterial(db, v, ['convert', 'extract_text']),
      insertMaterial(db, v, ['convert', 'extract_text']),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(['created', 'exists']);
    expect(r[0].materialId).toBe(r[1].materialId);
    const rows = await db
      .select()
      .from(materials)
      .where(eq(materials.discordAttachmentId, 'idem'));
    expect(rows).toHaveLength(1);
    const js = await db
      .select()
      .from(jobs)
      .where(eq(jobs.materialId, r[0].materialId));
    expect(js).toHaveLength(2);
  });

  it('insertMaterial with no jobs marks ready', async () => {
    const r = await insertMaterial(db, base('nojobs'), []);
    const [row] = await db
      .select()
      .from(materials)
      .where(eq(materials.id, r.materialId));
    expect(row.status).toBe('ready');
    const js = await db
      .select()
      .from(jobs)
      .where(eq(jobs.materialId, r.materialId));
    expect(js).toHaveLength(0);
  });

  it('polish text round-trips', async () => {
    const name = 'Żółć – ćwiczenia ąę';
    const [s] = await db
      .insert(subjects)
      .values({
        name,
        code: 'PL',
        semester: 2,
        ects: 3,
        discordChannelId: 'c-pl',
      })
      .$returningId();
    const [row] = await db.select().from(subjects).where(eq(subjects.id, s.id));
    expect(row.name).toBe(name);
  });
});
