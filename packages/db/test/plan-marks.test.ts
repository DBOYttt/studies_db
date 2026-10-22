import { eq } from 'drizzle-orm';
import type mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/client.js';
import { listWeekMarks } from '../src/plan-marks.js';
import {
  classes,
  classGroups,
  classMarkSkips,
  classMarks,
  subjects,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

describe('listWeekMarks', () => {
  let db: Db;
  let pool: mysql.Pool;
  const id: Record<string, number> = {};

  beforeAll(async () => {
    db = await resetTestDb();
    pool = createDb(process.env.TEST_DATABASE_URL as string).pool;
    [{ id: id.sub }] = await db
      .insert(subjects)
      .values({ code: 'BD', name: 'Bazy danych', semester: 1, ects: 5 })
      .$returningId();
    const cls = async (kind: 'laboratorium' | 'cwiczenia' | 'projekt') =>
      (
        await db
          .insert(classes)
          .values({ subjectId: id.sub, kind, name: kind })
          .$returningId()
      )[0].id;
    id.lab = await cls('laboratorium');
    id.other = await cls('cwiczenia');
    id.third = await cls('projekt');
    [{ id: id.g2 }] = await db
      .insert(classGroups)
      .values({ classId: id.lab, number: 2, name: 'Gr. 2' })
      .$returningId();
    const addMark = async (
      classId: number,
      groupId: number | null,
      note: string | null,
    ) =>
      (
        await db
          .insert(classMarks)
          .values({ classId, groupId, kind: 'wejsciowka', note })
          .$returningId()
      )[0].id;
    id.mAll = await addMark(id.lab, null, null);
    id.mG2 = await addMark(id.lab, id.g2, 'Kartka');
    id.mOther = await addMark(id.other, null, null);
    id.mThird = await addMark(id.third, null, null);
    await db.insert(classMarkSkips).values([
      { markId: id.mG2, onDate: '2026-10-28' },
      { markId: id.mG2, onDate: '2026-10-21' },
      { markId: id.mOther, onDate: '2026-10-21' },
    ]);
    id.mDeleted = await addMark(id.lab, null, 'old');
    await db
      .update(classMarks)
      .set({ deletedAt: new Date() })
      .where(eq(classMarks.id, id.mDeleted));
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb(db);
  });

  it('returns the marks of the classes with their skips, without deleted ones', async () => {
    const marks = await listWeekMarks(pool, [id.lab, id.other]);
    expect(marks).toEqual([
      { id: id.mAll, classId: id.lab, groupId: null, note: null, skips: [] },
      {
        id: id.mG2,
        classId: id.lab,
        groupId: id.g2,
        note: 'Kartka',
        skips: ['2026-10-21', '2026-10-28'],
      },
      {
        id: id.mOther,
        classId: id.other,
        groupId: null,
        note: null,
        skips: ['2026-10-21'],
      },
    ]);
  });

  it('returns nothing for no classes', async () => {
    expect(await listWeekMarks(pool, [])).toEqual([]);
  });
});
