import {
  consumeLoginToken,
  createLoginToken,
  type Db,
  events,
  subjects,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
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
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));

const { RO_POOL_OPTIONS } = await import('../lib/db');
const { GET } = await import('../app/(simple)/s/reports/csv/route');
const { parseReportIndex, REPORT_SLUGS } = await import('../lib/simple');

let sid: string;
const call = (r?: string) =>
  GET(new Request(`http://x/s/reports/csv${r === undefined ? '' : `?r=${r}`}`));

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
  const userId = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ann',
    avatarUrl: null,
  });
  // Report 2 lists Test and Exam events of the next 30 days, nothing else.
  const [{ id: mechId }] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .limit(1);
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
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
    expect(body).toHaveLength(2);
    expect(body[0]).toMatch(/,Test,MECH,Kolokwium 1$/);
    expect(body[1]).toMatch(/,Exam,MECH,Egzamin$/);
  });
});
