import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { classifyTags, ensureClass, ensureGroup } from '../src/hierarchy.js';
import {
  ASSESSMENT_NAMES,
  ASSESSMENTS,
  CLASS_KINDS,
  CLASS_NAMES,
  classes,
  classSessions,
  lecturers,
  PUBLIC_VIEWS,
  subjects,
} from '../src/schema.js';
import { closeTestDb, resetTestDb, testRoUrl } from '../src/testing.js';

let db: Db;
let pool: mysql.Pool;
let subjectId: number;

type Rows = mysql.RowDataPacket[];

async function columns(view: string): Promise<string[]> {
  const [rows] = await pool.query<Rows>(
    'SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [view],
  );
  return rows.map((r) => r.n as string);
}

beforeAll(async () => {
  db = await resetTestDb();
  pool = (db as unknown as { $client: mysql.Pool }).$client;
  const [s] = await db
    .insert(subjects)
    .values({
      name: 'Fizyka',
      code: 'FIZ',
      semester: 1,
      ects: 5,
      discordChannelId: 'tt-c1',
    })
    .$returningId();
  subjectId = s.id;
});

afterAll(async () => {
  await closeTestDb(db);
});

describe('timetable constants', () => {
  it('appends praktyczne and wf to the class kinds', () => {
    expect([...CLASS_KINDS]).toEqual([
      'wyklad',
      'laboratorium',
      'cwiczenia',
      'projekt',
      'seminarium',
      'praktyczne',
      'wf',
    ]);
    expect(CLASS_NAMES.praktyczne).toBe('Zajęcia praktyczne');
    expect(CLASS_NAMES.wf).toBe('WF');
  });

  it('defines assessments', () => {
    expect([...ASSESSMENTS]).toEqual([
      'egzamin',
      'kolokwium',
      'projekt',
      'sprawozdania',
      'zaliczenie',
    ]);
    expect(ASSESSMENT_NAMES).toEqual({
      egzamin: 'Exam',
      kolokwium: 'Test',
      projekt: 'Project',
      sprawozdania: 'Lab reports',
      zaliczenie: 'Credit',
    });
  });

  it('exposes v_class_sessions publicly', () => {
    expect(PUBLIC_VIEWS).toContain('v_class_sessions');
  });

  it('classifies the new kind tags', () => {
    expect(classifyTags(['Zajęcia praktyczne']).classKind).toBe('praktyczne');
    expect(classifyTags(['praktyczne']).classKind).toBe('praktyczne');
    expect(classifyTags(['WF']).classKind).toBe('wf');
    expect(classifyTags(['Wychowanie fizyczne']).classKind).toBe('wf');
  });
});

describe('timetable views', () => {
  it('appends course columns to existing views', async () => {
    expect((await columns('v_subjects')).slice(-2)).toEqual([
      'platform_url',
      'unitime_name',
    ]);
    expect((await columns('v_lecturers')).slice(-2)).toEqual([
      'office_hours',
      'room',
    ]);
    expect((await columns('v_classes')).slice(-3)).toEqual([
      'assessment',
      'assessment_note',
      'platform_url',
    ]);
  });

  it('v_class_sessions has exactly the documented columns', async () => {
    expect(await columns('v_class_sessions')).toEqual([
      'id',
      'starts_at',
      'ends_at',
      'subject_id',
      'subject_name',
      'class_id',
      'class_kind',
      'class_name',
      'group_id',
      'group_name',
      'lecturer_id',
      'lecturer_name',
      'room',
      'label',
      'status',
      'kind',
    ]);
  });
});

describe('timetable tables', () => {
  it('allows several subjects without a Discord channel', async () => {
    await db.insert(subjects).values([
      { name: 'A', code: 'TT-A', semester: 1, ects: 1, discordChannelId: null },
      { name: 'B', code: 'TT-B', semester: 1, ects: 1, discordChannelId: null },
    ]);
    const [rows] = await pool.query<Rows>(
      "SELECT COUNT(*) AS n FROM subjects WHERE code IN ('TT-A','TT-B') AND discord_channel_id IS NULL",
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  it('keeps discord_channel_id unique', async () => {
    await expect(
      db.insert(subjects).values({
        name: 'Dup',
        code: 'TT-DUP',
        semester: 1,
        ects: 1,
        discordChannelId: 'tt-c1',
      }),
    ).rejects.toThrow();
  });

  it('makes lecturer email unique but allows many nulls', async () => {
    await db.insert(lecturers).values([
      { name: 'Dr X', email: null },
      { name: 'Dr Y', email: null },
    ]);
    await db.insert(lecturers).values({ name: 'Dr Z', email: 'z@example.edu' });
    await expect(
      db.insert(lecturers).values({ name: 'Dr Z2', email: 'z@example.edu' }),
    ).rejects.toMatchObject({ cause: { code: 'ER_DUP_ENTRY' } });
  });

  it('ensureClass handles wf and ensureGroup takes an optional name', async () => {
    const cid = await ensureClass(db, subjectId, 'wf');
    const [c] = await db
      .select({ name: classes.name })
      .from(classes)
      .where(eq(classes.id, cid));
    expect(c.name).toBe('WF');
    const g1 = await ensureGroup(db, cid, 128, 'M-128');
    const g2 = await ensureGroup(db, cid, 3);
    const [rows] = await pool.query<Rows>(
      'SELECT id, name FROM class_groups WHERE id IN (?, ?) ORDER BY id',
      [g1, g2],
    );
    expect(rows.map((r) => r.name)).toEqual(['M-128', 'Gr. 3']);
  });

  it('rejects a duplicate (uid, occurrence_start) session', async () => {
    const at = new Date(Date.UTC(2026, 9, 12, 8, 15));
    const row = {
      uid: 'uid-1@example.edu',
      occurrenceStart: at,
      subjectId,
      startsAt: at,
      endsAt: new Date(Date.UTC(2026, 9, 12, 10, 0)),
      sequence: 0,
    };
    await db.insert(classSessions).values(row);
    await expect(db.insert(classSessions).values(row)).rejects.toThrow();
    const [rows] = await pool.query<Rows>(
      'SELECT status FROM class_sessions WHERE uid = ?',
      ['uid-1@example.edu'],
    );
    expect(rows).toEqual([{ status: 'confirmed' }]);
  });

  it('seeds plan_sync with a single row', async () => {
    const [rows] = await pool.query<Rows>('SELECT * FROM plan_sync');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it('read-only user sees v_class_sessions but not the raw tables', async () => {
    const ro = await mysql.createConnection(testRoUrl());
    try {
      await ro.query('SELECT * FROM v_class_sessions');
      await expect(ro.query('SELECT * FROM plan_sync')).rejects.toThrow();
      await expect(ro.query('SELECT * FROM class_sessions')).rejects.toThrow();
    } finally {
      await ro.end();
    }
  });
});
