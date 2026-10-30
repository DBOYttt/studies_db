import {
  classes,
  classGroups,
  classSessions,
  type Db,
  lecturers,
  listMarkableClasses,
  listUpcomingEvents,
  subjects,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RO_POOL_OPTIONS } from '../lib/db';
import {
  listMyGroupOptions,
  listWeekSessions,
  planListPage,
  sessionRange,
} from '../lib/plan-queries';
import { loadPlanWeek } from '../lib/plan-week-data';

/** Wall Date: UTC fields equal the Warsaw wall clock. */
const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi));

let db: Db;
let ro: mysql.Pool;
const id: Record<string, number> = {};
let n = 0;

async function mkSession(
  key: string,
  start: Date,
  end: Date,
  o: {
    subjectId: number;
    classId?: number | null;
    groupId?: number | null;
    lecturerId?: number | null;
    room?: string | null;
    label?: string;
    status?: 'confirmed' | 'cancelled';
  },
) {
  n++;
  const [r] = await db
    .insert(classSessions)
    .values({
      uid: `uid${n}`,
      occurrenceStart: start,
      startsAt: start,
      endsAt: end,
      label: o.label ?? key,
      subjectId: o.subjectId,
      classId: o.classId ?? null,
      groupId: o.groupId ?? null,
      lecturerId: o.lecturerId ?? null,
      room: o.room ?? null,
      status: o.status ?? 'confirmed',
    })
    .$returningId();
  id[key] = r.id;
}

beforeAll(async () => {
  db = await resetTestDb();
  ro = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 3,
  });
  const mkSubject = async (name: string, code: string) =>
    (
      await db
        .insert(subjects)
        .values({ name, code, semester: 1, ects: 5 })
        .$returningId()
    )[0].id;
  id.fiz = await mkSubject('Fizyka', 'FIZ');
  id.alg = await mkSubject('Algebra', 'ALG');
  id.mat = await mkSubject('Matematyka', 'MAT'); // no sessions
  const mkClass = async (
    subjectId: number,
    kind: 'wyklad' | 'cwiczenia' | 'laboratorium',
    name: string,
  ) =>
    (
      await db.insert(classes).values({ subjectId, kind, name }).$returningId()
    )[0].id;
  id.fizW = await mkClass(id.fiz, 'wyklad', 'Wykład');
  id.fizC = await mkClass(id.fiz, 'cwiczenia', 'Ćwiczenia');
  id.fizL = await mkClass(id.fiz, 'laboratorium', 'Laboratorium');
  id.algC = await mkClass(id.alg, 'cwiczenia', 'Ćwiczenia');
  id.matC = await mkClass(id.mat, 'cwiczenia', 'Ćwiczenia');
  const mkGroup = async (classId: number, number: number) =>
    (
      await db
        .insert(classGroups)
        .values({ classId, number, name: `Gr. ${number}` })
        .$returningId()
    )[0].id;
  id.fizC2 = await mkGroup(id.fizC, 2);
  id.fizC1 = await mkGroup(id.fizC, 1);
  id.fizL1 = await mkGroup(id.fizL, 1);
  id.algC1 = await mkGroup(id.algC, 1);
  id.matC1 = await mkGroup(id.matC, 1);
  id.kow = (
    await db
      .insert(lecturers)
      .values({ name: 'Jan Kowalski', title: 'dr' })
      .$returningId()
  )[0].id;
  id.now = (
    await db.insert(lecturers).values({ name: 'Anna Nowak' }).$returningId()
  )[0].id;

  // Week 2026-W42 = Mon 12.10 .. Sun 18.10.
  await mkSession(
    'sunBefore',
    W(2026, 10, 11, 23, 30),
    W(2026, 10, 11, 23, 45),
    {
      subjectId: id.fiz,
    },
  );
  await mkSession('monMidnight', W(2026, 10, 12, 0, 0), W(2026, 10, 12, 1), {
    subjectId: id.fiz,
  });
  await mkSession('lecture', W(2026, 10, 12, 8), W(2026, 10, 12, 9, 30), {
    subjectId: id.fiz,
    classId: id.fizW,
    lecturerId: id.kow,
    room: 'D-10 101',
    label: 'Wykład',
  });
  await mkSession('ex2', W(2026, 10, 13, 10), W(2026, 10, 13, 11, 30), {
    subjectId: id.fiz,
    classId: id.fizC,
    groupId: id.fizC2,
    lecturerId: id.now,
    status: 'cancelled',
  });
  await mkSession('algEx', W(2026, 10, 14, 12), W(2026, 10, 14, 13, 30), {
    subjectId: id.alg,
    classId: id.algC,
    groupId: id.algC1,
    lecturerId: id.kow,
  });
  await mkSession('nextMon', W(2026, 10, 19, 0, 0), W(2026, 10, 19, 1), {
    subjectId: id.fiz,
  });
  await mkSession('last', W(2027, 1, 29, 12), W(2027, 1, 29, 13), {
    subjectId: id.alg,
    classId: id.algC,
    groupId: id.algC1,
  });
});

afterAll(async () => {
  await ro.end();
  await closeTestDb(db);
});

const W42 = { year: 2026, week: 42 };

describe('listWeekSessions', () => {
  it('returns only that week: Mon 00:00 <= starts_at < next Mon', async () => {
    const { rows } = await listWeekSessions(ro, W42);
    expect(rows.map((r) => r.id)).toEqual([
      id.monMidnight,
      id.lecture,
      id.ex2,
      id.algEx,
    ]);
  });

  it('maps every field; times stay wall time', async () => {
    const { rows } = await listWeekSessions(ro, W42);
    expect(rows.find((r) => r.id === id.lecture)).toEqual({
      type: 'class',
      id: id.lecture,
      startsAt: W(2026, 10, 12, 8),
      endsAt: W(2026, 10, 12, 9, 30),
      subjectId: id.fiz,
      subjectName: 'Fizyka',
      subjectCode: 'FIZ',
      classId: id.fizW,
      classKind: 'wyklad',
      className: 'Wykład',
      groupId: null,
      groupName: null,
      lecturerId: id.kow,
      lecturerName: 'Jan Kowalski',
      room: 'D-10 101',
      label: 'Wykład',
      status: 'confirmed',
      sessionKind: 'class',
    });
    expect(rows.find((r) => r.id === id.ex2)).toMatchObject({
      classKind: 'cwiczenia',
      groupId: id.fizC2,
      groupName: 'Gr. 2',
      lecturerName: 'Anna Nowak',
      status: 'cancelled',
    });
    expect(rows.find((r) => r.id === id.monMidnight)).toMatchObject({
      classId: null,
      classKind: null,
      className: null,
      lecturerId: null,
      room: null,
    });
  });

  it('filters by subject and lecturer', async () => {
    const bySubject = await listWeekSessions(ro, W42, { subjectId: id.alg });
    expect(bySubject.rows.map((r) => r.id)).toEqual([id.algEx]);
    const byLecturer = await listWeekSessions(ro, W42, {
      lecturerId: id.kow,
    });
    expect(byLecturer.rows.map((r) => r.id)).toEqual([id.lecture, id.algEx]);
    const both = await listWeekSessions(ro, W42, {
      subjectId: id.fiz,
      lecturerId: id.kow,
    });
    expect(both.rows.map((r) => r.id)).toEqual([id.lecture]);
  });

  it('returns the SQL it ran, values inlined', async () => {
    const { sql } = await listWeekSessions(ro, W42, { subjectId: id.alg });
    expect(sql).toContain('FROM v_class_sessions');
    expect(sql).toContain("'2026-10-12 00:00:00'");
    expect(sql).toContain("'2026-10-19 00:00:00'");
    expect(sql).toContain(`subject_id = ${id.alg}`);
    expect(sql).not.toContain('?');
    const [r] = await ro.query<mysql.RowDataPacket[]>(sql);
    expect(r).toHaveLength(1);
  });

  it('works across the year end (2026-W53)', async () => {
    const { rows } = await listWeekSessions(ro, { year: 2026, week: 53 });
    expect(rows).toEqual([]);
  });
});

describe('sessionRange', () => {
  it('first and last start, optionally filtered', async () => {
    expect(await sessionRange(ro)).toEqual({
      first: W(2026, 10, 11, 23, 30),
      last: W(2027, 1, 29, 12),
    });
    expect(await sessionRange(ro, { subjectId: id.alg })).toEqual({
      first: W(2026, 10, 14, 12),
      last: W(2027, 1, 29, 12),
    });
    expect(await sessionRange(ro, { lecturerId: id.now })).toEqual({
      first: W(2026, 10, 13, 10),
      last: W(2026, 10, 13, 10),
    });
  });
  it('null when there are no sessions', async () => {
    expect(await sessionRange(ro, { subjectId: id.mat })).toBeNull();
  });
});

describe('class and event lists as studies_ro (views only)', () => {
  it('group options and markable classes: classes with sessions', async () => {
    const opts = (await listMyGroupOptions(ro)).map((o) => o.classId);
    expect(opts).toContain(id.fizC);
    expect(opts).not.toContain(id.matC);
    const mark = (await listMarkableClasses(ro)).map((c) => c.classId);
    expect(mark).toContain(id.fizW);
    expect(mark).not.toContain(id.matC);
  });
  it('upcoming events run on the views', async () => {
    expect(await listUpcomingEvents(ro, W(2026, 10, 1), 5)).toEqual([]);
  });
});

/** The RO pool, counting its query() calls. */
function counted(pool: mysql.Pool) {
  const c = { n: 0 };
  const p = new Proxy(pool, {
    get(t, k) {
      if (k === 'query')
        return (...a: Parameters<mysql.Pool['query']>) => {
          c.n++;
          return t.query(...a);
        };
      const v = Reflect.get(t, k);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return { pool: p, c };
}

describe('loadPlanWeek', () => {
  const W43 = { year: 2026, week: 43 };
  const ids = (rows: { id: number }[]) => rows.map((r) => r.id);

  it('without ?week reuses the opening week rows (no second fetch)', async () => {
    const { pool, c } = counted(ro);
    const r = await loadPlanWeek(pool, undefined, W(2026, 10, 13, 9), {});
    expect(r.week).toEqual(W42);
    expect(ids(r.classRows)).toEqual(
      ids((await listWeekSessions(ro, W42)).rows),
    );
    expect(r.events).toEqual([]);
    // range, the week's sessions, the week's events: once each
    expect(c.n).toBe(3);
  });

  it('with ?week loads that week, not the opening one', async () => {
    const { pool, c } = counted(ro);
    const r = await loadPlanWeek(pool, '2026-W43', W(2026, 10, 13, 9), {});
    expect(r.week).toEqual(W43);
    expect(ids(r.classRows)).toEqual([id.nextMon]);
    expect(c.n).toBe(2);
  });

  it('a finished current week moves on and loads the next week fresh', async () => {
    const { pool, c } = counted(ro);
    const r = await loadPlanWeek(pool, undefined, W(2026, 10, 15, 10), {});
    expect(r.week).toEqual(W43);
    expect(ids(r.classRows)).toEqual([id.nextMon]);
    expect(c.n).toBe(5);
  });

  it('keeps the filter on reused rows', async () => {
    const r = await loadPlanWeek(ro, undefined, W(2026, 10, 13, 9), {
      subjectId: id.alg,
    });
    expect(r.week).toEqual(W42);
    expect(ids(r.classRows)).toEqual([id.algEx]);
  });
});

describe('planListPage', () => {
  it('v_class_sessions ordered by starts_at, paged', async () => {
    const p = await planListPage(ro, { page: 1, perPage: 3 });
    expect(p.total).toBe(7);
    expect(p.pageCount).toBe(3);
    expect(p.columns[0]).toBe('id');
    expect(p.columns).toContain('starts_at');
    expect(p.rows.map((r) => r[0])).toEqual([
      id.sunBefore,
      id.monMidnight,
      id.lecture,
    ]);
    expect(p.sql).toContain('FROM v_class_sessions');
    expect(p.sql).toContain('ORDER BY starts_at');
    expect(p.sql).toContain('LIMIT 0, 3');
  });
  it('filters by subject and lecturer', async () => {
    const s = await planListPage(ro, {
      page: 1,
      perPage: 25,
      subjectId: id.alg,
    });
    expect(s.rows.map((r) => r[0])).toEqual([id.algEx, id.last]);
    expect(s.sql).toContain(`subject_id = ${id.alg}`);
    const l = await planListPage(ro, {
      page: 1,
      perPage: 25,
      lecturerId: id.now,
    });
    expect(l.rows.map((r) => r[0])).toEqual([id.ex2]);
  });
});
