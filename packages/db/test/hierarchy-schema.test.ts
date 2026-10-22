import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import {
  CLASS_KINDS,
  CLASS_NAMES,
  classes,
  classGroups,
  materials,
  PUBLIC_VIEWS,
  subjects,
  topics,
  users,
} from '../src/schema.js';
import { closeTestDb, resetTestDb, testRoUrl } from '../src/testing.js';

let db: Db;
let pool: mysql.Pool;
let subjectId: number;
let uploaderId: number;
let classId: number;
let groupId: number;

type Rows = mysql.RowDataPacket[];

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
      discordChannelId: 'h-c1',
    })
    .$returningId();
  subjectId = s.id;
  const [u] = await db
    .insert(users)
    .values({ discordUserId: 'h-u1', displayName: 'Ala' })
    .$returningId();
  uploaderId = u.id;
  const [c] = await db
    .insert(classes)
    .values({ subjectId, kind: 'laboratorium', name: CLASS_NAMES.laboratorium })
    .$returningId();
  classId = c.id;
  const [g] = await db
    .insert(classGroups)
    .values({ classId, number: 2, name: 'Gr. 2' })
    .$returningId();
  groupId = g.id;
});

afterAll(async () => {
  await closeTestDb(db);
});

function material(topicId: number, att: string, extra = {}) {
  return {
    topicId,
    uploaderId,
    discordMessageId: 'm',
    discordAttachmentId: att,
    originalFilename: `${att}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    storagePath: 'originals/aa/x.pdf',
    previewKind: 'pdf' as const,
    createdAt: new Date(),
    ...extra,
  };
}

describe('hierarchy schema', () => {
  it('exposes class kinds and names', () => {
    expect([...CLASS_KINDS]).toEqual([
      'wyklad',
      'laboratorium',
      'cwiczenia',
      'projekt',
      'seminarium',
      'praktyczne',
      'wf',
    ]);
    expect(CLASS_NAMES).toEqual({
      wyklad: 'Wykład',
      laboratorium: 'Laboratorium',
      cwiczenia: 'Ćwiczenia',
      projekt: 'Projekt',
      seminarium: 'Seminarium',
      praktyczne: 'Zajęcia praktyczne',
      wf: 'WF',
    });
  });

  it('has the new tables, views and no subject_lecturers', async () => {
    const [rows] = await pool.query<Rows>('SHOW FULL TABLES');
    const found = new Map(
      rows.map((r) => [Object.values(r)[0] as string, r.Table_type as string]),
    );
    for (const t of ['classes', 'class_groups', 'class_lecturers'])
      expect(found.get(t)).toBe('BASE TABLE');
    for (const v of [
      'v_classes',
      'v_class_groups',
      'v_class_lecturers',
      'v_files',
    ])
      expect(found.get(v)).toBe('VIEW');
    expect(found.has('subject_lecturers')).toBe(false);
    expect(found.has('v_subject_lecturers')).toBe(false);
    expect([...PUBLIC_VIEWS]).toEqual([
      'v_subjects',
      'v_lecturers',
      'v_classes',
      'v_class_groups',
      'v_class_lecturers',
      'v_topics',
      'v_tags',
      'v_topic_tags',
      'v_materials',
      'v_files',
      'v_users',
      'v_class_sessions',
      'v_events',
      'v_class_marks',
      'v_class_mark_skips',
    ]);
  });

  it('v_topics has class_id and group_id', async () => {
    const [cols] = await pool.query<Rows>('SHOW COLUMNS FROM v_topics');
    const names = cols.map((c) => c.Field);
    expect(names).toContain('class_id');
    expect(names).toContain('group_id');
  });

  it('enforces UNIQUE(subject_id, kind) and UNIQUE(class_id, number)', async () => {
    await expect(
      db
        .insert(classes)
        .values({ subjectId, kind: 'laboratorium', name: 'Laboratorium' }),
    ).rejects.toThrow();
    await expect(
      db.insert(classGroups).values({ classId, number: 2, name: 'Gr. 2' }),
    ).rejects.toThrow();
  });

  it('v_files is flat and hides deleted materials/topics', async () => {
    const [live] = await db
      .insert(topics)
      .values({
        subjectId,
        title: 'Zestaw 1',
        discordThreadId: 'h-t1',
        classId,
        groupId,
      })
      .$returningId();
    const [dead] = await db
      .insert(topics)
      .values({
        subjectId,
        title: 'Usunięty',
        discordThreadId: 'h-t2',
        deletedAt: new Date(),
      })
      .$returningId();
    await db.insert(materials).values(material(live.id, 'f-live'));
    await db
      .insert(materials)
      .values(material(live.id, 'f-del', { deletedAt: new Date() }));
    await db.insert(materials).values(material(dead.id, 'f-deadtopic'));
    const [rows] = await pool.query<Rows>('SELECT * FROM v_files');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subject_code: 'MECH',
      subject_name: 'Mechanika',
      class_name: 'Laboratorium',
      group_name: 'Gr. 2',
      topic_title: 'Zestaw 1',
      filename: 'f-live.pdf',
      mime_type: 'application/pdf',
      uploader: 'Ala',
    });
    for (const k of [
      'material_id',
      'topic_id',
      'size_bytes',
      'preview_kind',
      'status',
      'created_at',
    ])
      expect(Object.keys(rows[0])).toContain(k);
  });

  it('v_files ends with subject_id, class_id, group_id, uploader_id', async () => {
    const [cols] = await pool.query<Rows>(
      "SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'v_files' ORDER BY ORDINAL_POSITION",
    );
    const names = cols.map((c) => c.n as string);
    expect(names.slice(0, 14)).toEqual([
      'material_id',
      'subject_code',
      'subject_name',
      'class_name',
      'group_name',
      'topic_id',
      'topic_title',
      'filename',
      'mime_type',
      'size_bytes',
      'preview_kind',
      'status',
      'uploader',
      'created_at',
    ]);
    expect(names.slice(-4)).toEqual([
      'subject_id',
      'class_id',
      'group_id',
      'uploader_id',
    ]);
    const [classWide] = await db
      .insert(topics)
      .values({
        subjectId,
        title: 'Cała klasa',
        discordThreadId: 'h-t3',
        classId,
      })
      .$returningId();
    await db.insert(materials).values(material(classWide.id, 'f-classwide'));
    const [rows] = await pool.query<Rows>(
      "SELECT * FROM v_files WHERE filename IN ('f-live.pdf', 'f-classwide.pdf') ORDER BY filename DESC",
    );
    expect(rows[0]).toMatchObject({
      subject_id: subjectId,
      class_id: classId,
      group_id: groupId,
      uploader_id: uploaderId,
    });
    expect(rows[1]).toMatchObject({
      subject_id: subjectId,
      class_id: classId,
      group_id: null,
      uploader_id: uploaderId,
    });
  });

  it('studies_ro can select new views but not classes', async () => {
    const ro = await mysql.createConnection(testRoUrl());
    try {
      for (const v of [
        'v_classes',
        'v_class_groups',
        'v_class_lecturers',
        'v_files',
      ])
        await ro.query(`SELECT * FROM ${v}`);
      await expect(ro.query('SELECT * FROM classes')).rejects.toThrow(
        /denied/i,
      );
    } finally {
      await ro.end();
    }
  });
});

describe('migration 0003/0004 data move', () => {
  it('moves subject_lecturers into class_lecturers and drops the table', async () => {
    // Build a migrations folder truncated at 0002, migrate a scratch DB to it,
    // seed subject_lecturers, then run the full migrator on the same DB.
    const full = fileURLToPath(new URL('../migrations', import.meta.url));
    const tmp = mkdtempSync(join(tmpdir(), 'mig-'));
    cpSync(full, tmp, { recursive: true });
    const journalPath = join(tmp, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    journal.entries = journal.entries.filter(
      (e: { idx: number }) => e.idx <= 2,
    );
    writeFileSync(journalPath, JSON.stringify(journal));

    const url = new URL(process.env.TEST_DATABASE_URL as string);
    const dbName = 'studies_mig_test';
    const server = new URL(url);
    server.pathname = '/';
    const admin = await mysql.createConnection({
      uri: server.toString(),
      charset: 'utf8mb4',
    });
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(
      `CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    url.pathname = `/${dbName}`;
    const conn = await mysql.createConnection({
      uri: url.toString(),
      charset: 'utf8mb4',
    });
    try {
      await migrate(drizzle(conn), { migrationsFolder: tmp });
      await conn.query(
        "INSERT INTO subjects (name, code, semester, ects, discord_channel_id) VALUES ('Fizyka','FIZ',1,5,'mc1')",
      );
      await conn.query(
        "INSERT INTO lecturers (name) VALUES ('Dr Kowalski'), ('Dr Nowak')",
      );
      await conn.query(
        "INSERT INTO subject_lecturers (subject_id, lecturer_id, role) SELECT s.id, l.id, 'cwiczenia' FROM subjects s, lecturers l WHERE l.name = 'Dr Kowalski'",
      );
      await conn.query(
        "INSERT INTO subject_lecturers (subject_id, lecturer_id, role) SELECT s.id, l.id, 'cwiczenia' FROM subjects s, lecturers l WHERE l.name = 'Dr Nowak'",
      );
      await conn.query(
        "INSERT INTO subject_lecturers (subject_id, lecturer_id, role) SELECT s.id, l.id, 'wyklad' FROM subjects s, lecturers l WHERE l.name = 'Dr Nowak'",
      );

      await runMigrations(url.toString());
      await runMigrations(url.toString()); // idempotent re-run

      const [cl] = await conn.query<Rows>(
        `SELECT c.kind, c.name, l.name AS lecturer, cl.group_id
           FROM class_lecturers cl
           JOIN classes c ON c.id = cl.class_id
           JOIN lecturers l ON l.id = cl.lecturer_id
          ORDER BY c.kind, l.name`,
      );
      // ORDER BY an ENUM sorts by declaration order: wyklad before cwiczenia.
      expect(cl.map((r) => [r.kind, r.name, r.lecturer, r.group_id])).toEqual([
        ['wyklad', 'Wykład', 'Dr Nowak', null],
        ['cwiczenia', 'Ćwiczenia', 'Dr Kowalski', null],
        ['cwiczenia', 'Ćwiczenia', 'Dr Nowak', null],
      ]);
      const [nc] = await conn.query<Rows>('SELECT COUNT(*) AS n FROM classes');
      expect(Number(nc[0].n)).toBe(2);
      const [t] = await conn.query<Rows>(
        'SHOW TABLES LIKE "subject_lecturers"',
      );
      expect(t).toHaveLength(0);
    } finally {
      await conn.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin.end();
    }
  });
});
