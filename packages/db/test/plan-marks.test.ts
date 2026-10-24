import { eq } from 'drizzle-orm';
import type mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/client.js';
import {
  listMarkableClasses,
  listWeekMarks,
  upcomingSessionDates,
} from '../src/plan-marks.js';
import {
  classes,
  classGroups,
  classMarkSkips,
  classMarks,
  classSessions,
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

describe('panel entry-quiz reads', () => {
  let db: Db;
  let pool: mysql.Pool;
  const id: Record<string, number> = {};
  const W = (iso: string) => new Date(`${iso}Z`);

  beforeAll(async () => {
    db = await resetTestDb();
    pool = createDb(process.env.TEST_DATABASE_URL as string).pool;
    const subject = async (code: string, name: string) =>
      (
        await db
          .insert(subjects)
          .values({ code, name, semester: 1, ects: 5 })
          .$returningId()
      )[0].id;
    id.z = await subject('ZZ', 'Zarządzanie');
    id.a = await subject('AA', 'Analiza');
    const cls = async (subjectId: number, kind: 'laboratorium' | 'wyklad') =>
      (
        await db
          .insert(classes)
          .values({ subjectId, kind, name: kind })
          .$returningId()
      )[0].id;
    id.aLab = await cls(id.a, 'laboratorium');
    id.aLec = await cls(id.a, 'wyklad');
    id.zLab = await cls(id.z, 'laboratorium');
    id.noSessions = await cls(id.z, 'wyklad');
    const grp = async (number: number) =>
      (
        await db
          .insert(classGroups)
          .values({ classId: id.aLab, number, name: `Gr. ${number}` })
          .$returningId()
      )[0].id;
    id.g2 = await grp(2);
    id.g1 = await grp(1);
    let n = 0;
    const session = (
      classId: number,
      start: string,
      o: Partial<typeof classSessions.$inferInsert> = {},
    ) =>
      db.insert(classSessions).values({
        uid: `s${++n}`,
        occurrenceStart: W(start),
        startsAt: W(start),
        endsAt: new Date(W(start).getTime() + 90 * 60_000),
        label: 'L',
        subjectId: id.a,
        classId,
        ...o,
      });
    await session(id.aLab, '2026-10-14T10:00:00', { groupId: id.g1 });
    await session(id.aLab, '2026-10-14T12:00:00', { groupId: id.g2 });
    await session(id.aLab, '2026-10-21T10:00:00', { groupId: id.g1 });
    await session(id.aLab, '2026-10-28T10:00:00', {
      groupId: id.g1,
      status: 'cancelled',
    });
    await session(id.aLab, '2026-11-04T10:00:00', { groupId: id.g1 });
    await session(id.aLab, '2026-10-07T10:00:00', { groupId: id.g1 });
    await session(id.aLec, '2026-10-13T08:00:00');
    await session(id.zLab, '2026-10-13T08:00:00', { subjectId: id.z });
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb(db);
  });

  it('lists classes with sessions by subject name and kind, groups by number', async () => {
    expect(await listMarkableClasses(pool)).toEqual([
      {
        classId: id.aLec,
        className: 'wyklad',
        subjectId: id.a,
        subjectName: 'Analiza',
        groups: [],
      },
      {
        classId: id.aLab,
        className: 'laboratorium',
        subjectId: id.a,
        subjectName: 'Analiza',
        groups: [
          { id: id.g1, name: 'Gr. 1' },
          { id: id.g2, name: 'Gr. 2' },
        ],
      },
      {
        classId: id.zLab,
        className: 'laboratorium',
        subjectId: id.z,
        subjectName: 'Zarządzanie',
        groups: [],
      },
    ]);
  });

  it('upcoming dates: confirmed only, from the given day, per group or all', async () => {
    const from = W('2026-10-14T00:00:00');
    expect(await upcomingSessionDates(pool, id.aLab, id.g1, from, 5)).toEqual([
      '2026-10-14',
      '2026-10-21',
      '2026-11-04',
    ]);
    expect(await upcomingSessionDates(pool, id.aLab, null, from, 2)).toEqual([
      '2026-10-14',
      '2026-10-21',
    ]);
    expect(await upcomingSessionDates(pool, id.aLab, id.g2, from, 5)).toEqual([
      '2026-10-14',
    ]);
  });
});
