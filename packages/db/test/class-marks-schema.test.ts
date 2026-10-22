import { eq, sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import {
  CLASS_MARK_KINDS,
  PUBLIC_VIEWS,
  SESSION_KINDS,
} from '../src/constants.js';
import {
  classes,
  classGroups,
  classMarkSkips,
  classMarks,
  classSessions,
  subjects,
  users,
} from '../src/schema.js';
import {
  closeTestDb,
  resetTestDb,
  testRoUrl,
  testRwUrl,
} from '../src/testing.js';

let db: Db;
let subjectId: number;
let classId: number;
let groupId: number;
let userId: number;

type Rows = Array<Record<string, unknown>>;

async function q(query: ReturnType<typeof sql>): Promise<Rows> {
  const [rows] = (await db.execute(query)) as unknown as [Rows];
  return rows;
}

async function as<T>(
  uri: string,
  fn: (c: mysql.Connection) => Promise<T>,
): Promise<T> {
  const c = await mysql.createConnection({ uri, charset: 'utf8mb4' });
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  db = await resetTestDb();
  const [s] = await db
    .insert(subjects)
    .values({ code: 'CM1', name: 'Fizyka', semester: 1, ects: 3 })
    .$returningId();
  subjectId = s.id;
  const [c] = await db
    .insert(classes)
    .values({ subjectId, kind: 'laboratorium', name: 'Laboratorium' })
    .$returningId();
  classId = c.id;
  const [g] = await db
    .insert(classGroups)
    .values({ classId, number: 2, name: 'Gr. 2' })
    .$returningId();
  groupId = g.id;
  const [u] = await db
    .insert(users)
    .values({ discordUserId: 'cm-u1', displayName: 'Ala' })
    .$returningId();
  userId = u.id;
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('class marks constants', () => {
  it('defines the mark and session kinds and the public views', () => {
    expect([...CLASS_MARK_KINDS]).toEqual(['wejsciowka']);
    expect([...SESSION_KINDS]).toEqual(['class', 'exam']);
    expect(PUBLIC_VIEWS).toContain('v_class_marks');
    expect(PUBLIC_VIEWS).toContain('v_class_mark_skips');
  });
});

describe('class marks schema', () => {
  it('v_class_marks shows a live mark with its class and group', async () => {
    const [m] = await db
      .insert(classMarks)
      .values({
        classId,
        groupId,
        kind: 'wejsciowka',
        note: 'Rozdział 3',
        createdBy: userId,
        updatedBy: userId,
      })
      .$returningId();
    await db
      .insert(classMarkSkips)
      .values({ markId: m.id, onDate: '2026-11-03', createdBy: userId });
    const rows = await q(sql`SELECT * FROM v_class_marks WHERE id = ${m.id}`);
    expect(rows[0]).toMatchObject({
      id: m.id,
      class_id: classId,
      group_id: groupId,
      kind: 'wejsciowka',
      note: 'Rozdział 3',
      class_kind: 'laboratorium',
      class_name: 'Laboratorium',
      group_name: 'Gr. 2',
      subject_id: subjectId,
      version: 0,
    });
    const skips = await q(
      sql`SELECT mark_id, DATE_FORMAT(on_date, '%Y-%m-%d') AS d FROM v_class_mark_skips WHERE mark_id = ${m.id}`,
    );
    expect(skips).toEqual([{ mark_id: m.id, d: '2026-11-03' }]);
  });

  it('a mark without a group has a NULL group_name', async () => {
    const [m] = await db
      .insert(classMarks)
      .values({ classId, kind: 'wejsciowka', createdBy: userId })
      .$returningId();
    const rows = await q(
      sql`SELECT group_id, group_name FROM v_class_marks WHERE id = ${m.id}`,
    );
    expect(rows[0]).toEqual({ group_id: null, group_name: null });
  });

  it('soft-deleting a mark hides it and its skips', async () => {
    const [m] = await db
      .insert(classMarks)
      .values({ classId, groupId, kind: 'wejsciowka', createdBy: userId })
      .$returningId();
    await db
      .insert(classMarkSkips)
      .values({ markId: m.id, onDate: '2026-11-10', createdBy: userId });
    await db
      .update(classMarks)
      .set({ deletedAt: new Date() })
      .where(eq(classMarks.id, m.id));
    expect(
      await q(sql`SELECT id FROM v_class_marks WHERE id = ${m.id}`),
    ).toEqual([]);
    expect(
      await q(sql`SELECT id FROM v_class_mark_skips WHERE mark_id = ${m.id}`),
    ).toEqual([]);
  });

  it('refuses a duplicate skip for the same mark and date', async () => {
    const [m] = await db
      .insert(classMarks)
      .values({ classId, kind: 'wejsciowka' })
      .$returningId();
    await db
      .insert(classMarkSkips)
      .values({ markId: m.id, onDate: '2026-12-01' });
    await expect(
      db.insert(classMarkSkips).values({ markId: m.id, onDate: '2026-12-01' }),
    ).rejects.toMatchObject({ cause: { errno: 1062 } });
  });

  it('deleting the class cascades to its marks and skips', async () => {
    const [c] = await db
      .insert(classes)
      .values({ subjectId, kind: 'cwiczenia', name: 'Ćwiczenia' })
      .$returningId();
    const [m] = await db
      .insert(classMarks)
      .values({ classId: c.id, kind: 'wejsciowka' })
      .$returningId();
    await db
      .insert(classMarkSkips)
      .values({ markId: m.id, onDate: '2026-12-02' });
    await db.delete(classes).where(eq(classes.id, c.id));
    expect(
      await db.select().from(classMarks).where(eq(classMarks.id, m.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(classMarkSkips)
        .where(eq(classMarkSkips.markId, m.id)),
    ).toEqual([]);
  });

  it('v_class_sessions exposes kind, defaulting to class', async () => {
    const [cs] = await db
      .insert(classSessions)
      .values({
        uid: 'cm-uid-1',
        occurrenceStart: new Date('2026-11-03T08:00:00Z'),
        subjectId,
        classId,
        groupId,
        startsAt: new Date('2026-11-03T08:00:00Z'),
        endsAt: new Date('2026-11-03T09:30:00Z'),
      })
      .$returningId();
    const rows = await q(
      sql`SELECT kind FROM v_class_sessions WHERE id = ${cs.id}`,
    );
    expect(rows).toEqual([{ kind: 'class' }]);
  });
});

describe('class marks grants', () => {
  it('studies_ro reads both views but not the tables', async () => {
    await as(testRoUrl(), async (c) => {
      await c.query('SELECT * FROM v_class_marks');
      await c.query('SELECT * FROM v_class_mark_skips');
      await expect(c.query('SELECT * FROM class_marks')).rejects.toMatchObject({
        errno: 1142,
      });
      await expect(
        c.query('SELECT * FROM class_mark_skips'),
      ).rejects.toMatchObject({ errno: 1142 });
    });
  });

  it('studies_rw may insert, update and delete both tables', async () => {
    await as(testRwUrl(), async (c) => {
      await c.query('SELECT * FROM v_class_marks');
      await c.query('SELECT * FROM v_class_mark_skips');
      const [ins] = await c.query<mysql.ResultSetHeader>(
        "INSERT INTO class_marks (class_id, kind, note) VALUES (?, 'wejsciowka', 'rw')",
        [classId],
      );
      const markId = ins.insertId;
      await c.query(
        "INSERT INTO class_mark_skips (mark_id, on_date) VALUES (?, '2026-12-08')",
        [markId],
      );
      await c.query(
        "UPDATE class_mark_skips SET on_date = '2026-12-09' WHERE mark_id = ?",
        [markId],
      );
      await c.query("UPDATE class_marks SET note = 'rw2' WHERE id = ?", [
        markId,
      ]);
      await c.query('DELETE FROM class_mark_skips WHERE mark_id = ?', [markId]);
      await c.query('DELETE FROM class_marks WHERE id = ?', [markId]);
    });
  });
});
