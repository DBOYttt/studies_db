import type mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import {
  classes,
  classGroups,
  classSessions,
  type Db,
  lecturers,
  subjects,
} from '../src/index.js';
import {
  filterMyGroups,
  formatIsoWeek,
  hiddenByMyGroups,
  isoWeekOf,
  listMyGroupOptions,
  listWeekSessionRows,
  nowWall,
  type PlanSession,
  parseIsoWeek,
  parseMyGroups,
  sanitizeMyGroups,
  shiftWeek,
  weekSessionsQuery,
  weekStart,
} from '../src/plan.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

/** Wall Date: UTC fields equal the Warsaw wall clock. */
const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

let nextId = 1;
const S = (
  start: Date,
  end: Date,
  o: Partial<PlanSession> = {},
): PlanSession => ({
  id: nextId++,
  startsAt: start,
  endsAt: end,
  subjectId: 1,
  subjectName: 'Fizyka',
  subjectCode: 'FIZ',
  classId: null,
  classKind: null,
  className: null,
  groupId: null,
  groupName: null,
  lecturerId: null,
  lecturerName: null,
  room: null,
  label: 'W',
  status: 'confirmed',
  ...o,
});

describe('ISO weeks', () => {
  it('isoWeekOf around the year end', () => {
    expect(isoWeekOf(W(2026, 12, 31))).toEqual({ year: 2026, week: 53 });
    expect(isoWeekOf(W(2027, 1, 3, 23, 59))).toEqual({ year: 2026, week: 53 });
    expect(isoWeekOf(W(2027, 1, 4))).toEqual({ year: 2027, week: 1 });
    expect(isoWeekOf(W(2026, 1, 1))).toEqual({ year: 2026, week: 1 });
    expect(isoWeekOf(W(2026, 10, 12, 8))).toEqual({ year: 2026, week: 42 });
  });

  it('parse / format', () => {
    expect(parseIsoWeek('2026-W42')).toEqual({ year: 2026, week: 42 });
    expect(parseIsoWeek('2026-W53')).toEqual({ year: 2026, week: 53 });
    expect(parseIsoWeek('2026-W54')).toBeNull();
    expect(parseIsoWeek('2027-W53')).toBeNull();
    expect(parseIsoWeek('2026-W00')).toBeNull();
    expect(parseIsoWeek('2026-W5')).toBeNull();
    expect(parseIsoWeek(' 2026-W42')).toBeNull();
    expect(parseIsoWeek(undefined)).toBeNull();
    expect(formatIsoWeek({ year: 2026, week: 42 })).toBe('2026-W42');
    expect(formatIsoWeek({ year: 2027, week: 1 })).toBe('2027-W01');
  });

  it('weekStart is the wall Monday 00:00', () => {
    expect(weekStart({ year: 2026, week: 42 })).toEqual(W(2026, 10, 12));
    expect(weekStart({ year: 2026, week: 53 })).toEqual(W(2026, 12, 28));
    expect(weekStart({ year: 2027, week: 1 })).toEqual(W(2027, 1, 4));
    expect(weekStart({ year: 2026, week: 1 })).toEqual(W(2025, 12, 29));
  });

  it('shiftWeek crosses the year end both ways', () => {
    expect(shiftWeek({ year: 2026, week: 53 }, 1)).toEqual({
      year: 2027,
      week: 1,
    });
    expect(shiftWeek({ year: 2027, week: 1 }, -1)).toEqual({
      year: 2026,
      week: 53,
    });
    expect(shiftWeek({ year: 2026, week: 52 }, 3)).toEqual({
      year: 2027,
      week: 2,
    });
    expect(shiftWeek({ year: 2026, week: 42 }, 0)).toEqual({
      year: 2026,
      week: 42,
    });
  });

  it('nowWall converts a UTC instant to the Warsaw wall clock', () => {
    // CEST (UTC+2) and CET (UTC+1).
    expect(nowWall(new Date('2026-10-12T06:30:00Z'))).toEqual(
      W(2026, 10, 12, 8, 30),
    );
    expect(nowWall(new Date('2026-12-31T23:30:00Z'))).toEqual(
      W(2027, 1, 1, 0, 30),
    );
  });
});

describe('my groups', () => {
  it('parseMyGroups keeps numeric keys with integer values', () => {
    expect(parseMyGroups('{"3":7,"x":1,"4":"a"}')).toEqual({ '3': 7 });
    expect(parseMyGroups('nope')).toEqual({});
    expect(parseMyGroups(null)).toEqual({});
    expect(parseMyGroups('[1,2]')).toEqual({});
    expect(parseMyGroups('null')).toEqual({});
    expect(parseMyGroups('{"5":1.5,"6":-1,"7":0,"08":2,"9":3}')).toEqual({
      '9': 3,
    });
  });
  const mk = (classId: number | null, groupId: number | null, h = 9) =>
    S(W(2026, 10, 12, h), W(2026, 10, 12, h + 1), { classId, groupId });
  it('filterMyGroups keeps lectures and the picked group of picked classes only', () => {
    const lecture = mk(1, null, 8);
    const mine = mk(3, 7);
    const other = mk(3, 8);
    const unpicked = mk(4, 9);
    const noClass = mk(null, null, 11);
    const all = [lecture, mine, other, unpicked, noClass];
    expect(filterMyGroups(all, { '3': 7 })).toEqual([lecture, mine, noClass]);
    expect(hiddenByMyGroups(all, { '3': 7 })).toBe(2);
  });
  it('keeps everything when no groups are saved', () => {
    const all = [mk(1, null), mk(3, 7), mk(4, 9)];
    expect(filterMyGroups(all, {})).toEqual(all);
    expect(hiddenByMyGroups(all, {})).toBe(0);
    // stale-only picks count as none saved only after sanitising; raw {} here
    expect(hiddenByMyGroups(all, {}, { '3': [7] })).toBe(0);
  });
  it('treats a class whose only pick is stale as unpicked', () => {
    const a = mk(3, 7);
    const b = mk(3, 8);
    const u = mk(4, 9);
    const lec = mk(4, null);
    const valid = { '3': [7, 8], '4': [9] };
    // stale pick for class 3, valid pick for class 4: class 3 hidden
    expect(filterMyGroups([a, b, u, lec], { '3': 99, '4': 9 }, valid)).toEqual([
      u,
      lec,
    ]);
    expect(hiddenByMyGroups([a, b, u, lec], { '3': 99, '4': 9 }, valid)).toBe(
      2,
    );
    // only a stale pick: nothing saved after sanitising, nothing filtered
    expect(filterMyGroups([a, b, u], { '3': 99 }, valid)).toEqual([a, b, u]);
    expect(hiddenByMyGroups([a, b, u], { '3': 99 }, valid)).toBe(0);
    expect(filterMyGroups([a, b, u], { '3': 7 }, valid)).toEqual([a]);
    expect(sanitizeMyGroups({ '3': 99, '4': 9, '5': 1 }, valid)).toEqual({
      '4': 9,
      '5': 1,
    });
    expect(sanitizeMyGroups({ '3': 8 }, valid)).toEqual({ '3': 8 });
  });
});

describe('weekSessionsQuery', () => {
  it('binds the week bounds and optional filters', () => {
    const q = weekSessionsQuery({ year: 2026, week: 42 });
    expect(q.params).toEqual(['2026-10-12 00:00:00', '2026-10-19 00:00:00']);
    expect(q.sql).toContain('FROM v_class_sessions cs');
    const f = weekSessionsQuery({ year: 2026, week: 42 }, { subjectId: 3 });
    expect(f.params).toEqual(['2026-10-12 00:00:00', '2026-10-19 00:00:00', 3]);
    expect(f.sql).toContain('cs.subject_id = ?');
  });
});

describe('DB queries', () => {
  let db: Db;
  let pool: mysql.Pool;
  const id: Record<string, number> = {};
  let n = 0;
  const sess = async (
    start: Date,
    end: Date,
    o: { subjectId: number; classId?: number; groupId?: number },
  ) =>
    (
      await db
        .insert(classSessions)
        .values({
          uid: `uid${++n}`,
          occurrenceStart: start,
          startsAt: start,
          endsAt: end,
          label: 'L',
          subjectId: o.subjectId,
          classId: o.classId ?? null,
          groupId: o.groupId ?? null,
        })
        .$returningId()
    )[0].id;

  beforeAll(async () => {
    db = await resetTestDb();
    pool = createDb(process.env.TEST_DATABASE_URL as string).pool;
    const subj = async (name: string, code: string) =>
      (
        await db
          .insert(subjects)
          .values({ name, code, semester: 1, ects: 5 })
          .$returningId()
      )[0].id;
    id.fiz = await subj('Fizyka', 'FIZ');
    id.alg = await subj('Algebra', 'ALG');
    const cls = async (subjectId: number) =>
      (
        await db
          .insert(classes)
          .values({ subjectId, kind: 'cwiczenia', name: 'Ćwiczenia' })
          .$returningId()
      )[0].id;
    id.fizC = await cls(id.fiz);
    id.algC = await cls(id.alg);
    const grp = async (classId: number, number: number) =>
      (
        await db
          .insert(classGroups)
          .values({ classId, number, name: `Gr. ${number}` })
          .$returningId()
      )[0].id;
    id.fizC2 = await grp(id.fizC, 2);
    id.fizC1 = await grp(id.fizC, 1);
    id.algC1 = await grp(id.algC, 1);
    await db.insert(lecturers).values({ name: 'Jan Kowalski' });
    // Inserted out of order; the week is Mon 12.10 .. Sun 18.10.
    id.late = await sess(W(2026, 10, 14, 12), W(2026, 10, 14, 13), {
      subjectId: id.alg,
      classId: id.algC,
      groupId: id.algC1,
    });
    id.early = await sess(W(2026, 10, 12, 8), W(2026, 10, 12, 9, 30), {
      subjectId: id.fiz,
    });
    await sess(W(2026, 10, 11, 23, 30), W(2026, 10, 11, 23, 45), {
      subjectId: id.fiz,
    });
    await sess(W(2026, 10, 19, 0), W(2026, 10, 19, 1), { subjectId: id.fiz });
    // Class with groups outside week 42 (Fizyka: groups inserted out of order).
    await sess(W(2026, 10, 26, 10), W(2026, 10, 26, 11), {
      subjectId: id.fiz,
      classId: id.fizC,
      groupId: id.fizC1,
    });
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb(db);
  });

  it('listWeekSessionRows returns the whole week ordered by start', async () => {
    const rows = await listWeekSessionRows(pool, { year: 2026, week: 42 });
    expect(rows.map((r) => r.id)).toEqual([id.early, id.late]);
    expect(rows[0]).toMatchObject({
      startsAt: W(2026, 10, 12, 8),
      endsAt: W(2026, 10, 12, 9, 30),
      subjectName: 'Fizyka',
      subjectCode: 'FIZ',
      classId: null,
      status: 'confirmed',
    });
    expect(rows[1]).toMatchObject({
      groupName: 'Gr. 1',
      classKind: 'cwiczenia',
    });
  });

  it('listMyGroupOptions: classes with sessions and groups, by subject', async () => {
    expect(await listMyGroupOptions(pool)).toEqual([
      {
        classId: id.algC,
        subjectName: 'Algebra',
        className: 'Ćwiczenia',
        groups: [{ id: id.algC1, name: 'Gr. 1' }],
      },
      {
        classId: id.fizC,
        subjectName: 'Fizyka',
        className: 'Ćwiczenia',
        groups: [
          { id: id.fizC1, name: 'Gr. 1' },
          { id: id.fizC2, name: 'Gr. 2' },
        ],
      },
    ]);
  });
});
