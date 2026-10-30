import {
  consumeLoginToken,
  createLoginToken,
  type Db,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { modeTarget } from '../lib/mode';
import {
  parseSemesterValue,
  semesterFromRequest,
  withoutSem,
} from '../lib/semester';

let db: Db;
let sid: string | undefined;
vi.mock('@/lib/db', () => ({ getDb: () => db }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && sid ? { name: n, value: sid } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

describe('parseSemesterValue', () => {
  it('accepts exactly 1-7, first value only', () => {
    expect(parseSemesterValue('3')).toBe(3);
    expect(parseSemesterValue(['5', '2'])).toBe(5);
    for (const bad of ['0', '8', '1;drop', ' 3', '03', '', 'all', undefined])
      expect(parseSemesterValue(bad)).toBeNull();
    expect(parseSemesterValue([])).toBeNull();
  });
});

describe('semesterFromRequest', () => {
  it('?sem wins; all clears; a bad ?sem falls back to the cookie', () => {
    expect(semesterFromRequest({ sem: 'all' }, '4')).toBeNull();
    expect(semesterFromRequest({ sem: '9' }, '4')).toBe(4);
    expect(semesterFromRequest({ sem: '2' }, '4')).toBe(2);
    expect(semesterFromRequest({}, '4')).toBe(4);
    expect(semesterFromRequest({}, 'x')).toBeNull();
    expect(semesterFromRequest({}, undefined)).toBeNull();
  });
});

describe('withoutSem', () => {
  it('drops sem and keeps the rest', () => {
    expect(withoutSem('/s/plan?sem=5&week=2026-W44')).toBe(
      '/s/plan?week=2026-W44',
    );
    expect(withoutSem('/s/plan?sem=5')).toBe('/s/plan');
    expect(withoutSem('/s')).toBe('/s');
    expect(withoutSem('/s?x=1#a')).toBe('/s?x=1#a');
    expect(withoutSem('/s?sem=2#a')).toBe('/s#a');
  });
});

describe('modeTarget', () => {
  it('keeps sem when mapping a page', () => {
    expect(modeTarget('advanced', '/s/plan?sem=3')).toBe('/plan?sem=3');
    expect(modeTarget('simple', '/plan?week=2026-W44&sem=all')).toBe(
      '/s/plan?week=2026-W44&sem=all',
    );
    expect(modeTarget('advanced', '/s/plan?sem=9')).toBe('/plan');
  });
});

describe('GET /semester', () => {
  beforeAll(async () => {
    db = await resetTestDb();
    const uid = await upsertUser(db, {
      discordUserId: 'u1',
      displayName: 'Ala',
      avatarUrl: null,
    });
    const token = await createLoginToken(db, uid);
    const r = await consumeLoginToken(db, token);
    sid = (r as { sessionToken: string }).sessionToken;
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  const call = async (qs: string) => {
    const { GET } = await import('../app/semester/route');
    const { NextRequest } = await import('next/server');
    return GET(new NextRequest(`http://localhost/semester?${qs}`));
  };

  it('sets the cookie and strips sem from next', async () => {
    const res = await call(
      `to=3&next=${encodeURIComponent('/s/plan?sem=5&week=2026-W44')}`,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/s/plan?week=2026-W44');
    const c = res.cookies.get('studiesdb.semester');
    expect(c?.value).toBe('3');
    expect(c?.httpOnly).toBeFalsy();
  });

  it('refuses an unsafe next', async () => {
    const res = await call('to=2&next=//evil.com');
    expect(res.headers.get('location')).toBe('/s');
  });

  it('all deletes the cookie; anything else leaves it', async () => {
    const all = await call('to=all&next=/s');
    expect(all.cookies.get('studiesdb.semester')?.value).toBe('');
    const bad = await call('to=9&next=/s');
    expect(bad.cookies.get('studiesdb.semester')).toBeUndefined();
  });

  it('redirects to login without a session', async () => {
    const keep = sid;
    sid = undefined;
    await expect(call('to=3&next=/s')).rejects.toThrow(/REDIRECT:\/login-info/);
    sid = keep;
  });
});
