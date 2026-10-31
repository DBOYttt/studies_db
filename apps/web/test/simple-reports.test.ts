import {
  consumeLoginToken,
  createLoginToken,
  type Db,
  events,
  subjects,
  upsertUser,
} from '@studies/db';
import { nowWall } from '@studies/db/plan';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import { eq, inArray } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
let roPool: mysql.Pool;

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db')>()),
  getDb: () => db,
  getRoPool: () => roPool,
}));

let cookieSid: string | undefined;
let cookieSem: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid
        ? { name: n, value: cookieSid }
        : n === 'studiesdb.semester' && cookieSem
          ? { name: n, value: cookieSem }
          : undefined,
  }),
}));

const { RO_POOL_OPTIONS } = await import('../lib/db');
const { GET } = await import('../app/(simple)/s/reports/csv/route');
const { parseReportIndex, REPORT_SLUGS } = await import('../lib/simple');
const { reportQuery } = await import('../lib/example-queries');
const { runReadonlyQuery } = await import('../lib/sql-console');

let sid: string;
let userId: number;
const call = (r?: string, extra = '') =>
  GET(
    new Request(
      `http://x/s/reports/csv${r === undefined ? '' : `?r=${r}`}${extra}`,
    ),
  );

beforeAll(async () => {
  db = await resetTestDb();
  roPool = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 3,
  });
  await db.insert(subjects).values({
    name: 'Mechanika',
    code: 'MECH',
    semester: 1,
    ects: 5,
    discordChannelId: 'c1',
  });
  userId = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ann',
    avatarUrl: null,
  });
  // Report 2 lists Test and Exam events of the next 30 days, nothing else.
  const [{ id: mechId }] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .limit(1);
  // events.starts_at is Warsaw wall time: build the edge cases from wall now.
  const wall = nowWall();
  const inDays = (d: number) => new Date(wall.getTime() + d * 86_400_000);
  const late = inDays(2);
  late.setUTCHours(23, 30, 0, 0);
  await db.insert(events).values([
    {
      kind: 'kolokwium',
      title: 'Kolokwium 1',
      subjectId: mechId,
      startsAt: inDays(3),
      createdBy: userId,
    },
    {
      kind: 'egzamin',
      title: 'Egzamin',
      subjectId: mechId,
      startsAt: inDays(20),
      createdBy: userId,
    },
    {
      kind: 'inne',
      title: 'Spotkanie',
      subjectId: mechId,
      startsAt: inDays(4),
      createdBy: userId,
    },
    {
      kind: 'kolokwium',
      title: 'Stare',
      subjectId: mechId,
      startsAt: inDays(-5),
      createdBy: userId,
    },
    {
      // Late in the evening: still listed, on its own wall date.
      kind: 'kolokwium',
      title: 'Wieczorem',
      subjectId: mechId,
      startsAt: late,
      createdBy: userId,
    },
    {
      // Started 30 min ago (wall): no longer upcoming.
      kind: 'kolokwium',
      title: 'Trwa',
      subjectId: mechId,
      startsAt: new Date(wall.getTime() - 30 * 60_000),
      createdBy: userId,
    },
    {
      // 30 min before the end of the 30-day window: still inside it.
      kind: 'egzamin',
      title: 'Na granicy',
      subjectId: mechId,
      startsAt: new Date(wall.getTime() + 30 * 86_400_000 - 30 * 60_000),
      createdBy: userId,
    },
    {
      kind: 'kolokwium',
      title: 'Daleko',
      subjectId: mechId,
      startsAt: inDays(40),
      createdBy: userId,
    },
  ]);
  const r = await consumeLoginToken(db, await createLoginToken(db, userId));
  sid = (r as { sessionToken: string }).sessionToken;
  cookieSid = sid;
});
afterAll(async () => {
  await roPool.end();
  await closeTestDb(db);
});

describe('parseReportIndex', () => {
  it('accepts 0..2, everything else is 0', () => {
    expect(parseReportIndex('0')).toBe(0);
    expect(parseReportIndex('1')).toBe(1);
    expect(parseReportIndex('2')).toBe(2);
    for (const bad of [
      '7',
      '3',
      '-1',
      '1.5',
      'abc',
      '',
      '01',
      '1e0',
      undefined,
    ])
      expect(parseReportIndex(bad), String(bad)).toBe(0);
    expect(parseReportIndex(['2', '1'])).toBe(2);
  });
});

describe('GET /s/reports/csv', () => {
  it('redirects to login without a session', async () => {
    cookieSid = undefined;
    try {
      await call('1');
      expect.unreachable();
    } catch (e) {
      expect(String((e as { digest?: string }).digest)).toContain(
        '/login-info',
      );
    }
    cookieSid = sid;
  });
  it('r=1 has English labels as the header row and a slug filename', async () => {
    const res = await call('1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${REPORT_SLUGS[1]}.csv"`,
    );
    const text = await res.text();
    expect(text.replace(/^﻿/, '').split('\r\n')[0]).toBe('Author,Files');
  });
  it('invalid r falls back to report 0', async () => {
    const res = await call('9');
    expect((await res.text()).replace(/^﻿/, '').split('\r\n')[0]).toBe(
      'Code,Subject,Files',
    );
  });
  it('r=2 lists the Tests and Exams of the next 30 days', async () => {
    const res = await call('2');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="tests-exams-next-30-days.csv"',
    );
    const lines = (await res.text()).replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('When,Type,Subject,Title');
    const body = lines.slice(1).filter(Boolean);
    expect(body).toHaveLength(4);
    for (const line of body) {
      const when = line.split(',')[0];
      expect(when).not.toMatch(/Z$/);
      expect(when).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
    expect(body[0].split(',')[0].slice(11, 16)).toBe('23:30');
    expect(body[0]).toMatch(/,Test,MECH,Wieczorem$/);
    expect(body[1]).toMatch(/,Test,MECH,Kolokwium 1$/);
    expect(body[2]).toMatch(/,Exam,MECH,Egzamin$/);
    expect(body[3]).toMatch(/,Exam,MECH,Na granicy$/);
  });
});

describe('reports with a semester', () => {
  const body = async (r: string, extra = '') =>
    (await (await call(r, extra)).text())
      .replace(/^\uFEFF/, '')
      .split('\r\n')
      .slice(1)
      .filter(Boolean);

  it('reportQuery binds the semester as a parameter', () => {
    for (const i of [0, 1, 2]) {
      expect(reportQuery(i, null).values).toBeUndefined();
      const q = reportQuery(i, 3);
      expect(q.values).toEqual([3]);
      expect(q.sql).toContain('s.semester = ?');
      expect(q.sql).not.toMatch(/semester = 3/);
    }
  });

  it('every filtered report runs on the read-only pool', async () => {
    for (const i of [0, 1, 2]) {
      const q = reportQuery(i, 1);
      const r = await runReadonlyQuery(roPool, q.sql, { values: q.values });
      expect(r, String(i)).toMatchObject({ ok: true });
    }
  });

  it('the CSV follows the cookie and ?sem, and keeps subject-less events', async () => {
    const [{ id: optId }] = await db
      .insert(subjects)
      .values({
        name: 'Optyka',
        code: 'OPT',
        semester: 3,
        ects: 2,
        discordChannelId: 'c3',
      })
      .$returningId();
    const soon = new Date(nowWall().getTime() + 5 * 86_400_000);
    await db.insert(events).values([
      {
        kind: 'kolokwium',
        title: 'Optyka test',
        subjectId: optId,
        startsAt: soon,
        createdBy: userId,
      },
      {
        kind: 'egzamin',
        title: 'Bez przedmiotu',
        subjectId: null,
        startsAt: soon,
        createdBy: userId,
      },
    ]);
    try {
      cookieSem = '3';
      expect(await body('0')).toEqual(['OPT,Optyka,0']);
      const r2 = await body('2');
      expect(r2.map((l) => l.split(',').slice(2).join(','))).toEqual([
        'OPT,Optyka test',
        ',Bez przedmiotu',
      ]);
      // ?sem wins over the cookie.
      expect(await body('0', '&sem=1')).toEqual(['MECH,Mechanika,0']);
      cookieSem = undefined;
      expect(await body('0')).toHaveLength(2);
      expect(await body('2')).toHaveLength(6);
    } finally {
      cookieSem = undefined;
      await db
        .delete(events)
        .where(inArray(events.title, ['Optyka test', 'Bez przedmiotu']));
      await db.delete(subjects).where(eq(subjects.id, optId));
    }
  });
});
