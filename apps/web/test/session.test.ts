import {
  createLoginToken,
  type Db,
  getSessionUser,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { NextRequest } from 'next/server';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

let db: Db;

vi.mock('@/lib/db', () => ({ getDb: () => db }));

const { sessionCookieOptions } = await import('../lib/session');
const { GET } = await import('../app/auth/callback/route');
const { POST } = await import('../app/auth/logout/route');

beforeAll(async () => {
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sessionCookieOptions', () => {
  it('is not secure outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionCookieOptions()).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 30 * 24 * 3600,
      path: '/',
    });
  });

  it('is secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookieOptions().secure).toBe(true);
  });
});

describe('GET /auth/callback', () => {
  let token: string;
  beforeEach(async () => {
    const userId = await upsertUser(db, {
      discordUserId: 'u1',
      displayName: 'Ann',
      avatarUrl: null,
    });
    token = await createLoginToken(db, userId);
  });

  const call = (t: string | null) =>
    GET(
      new NextRequest(
        `http://localhost:3000/auth/callback${t ? `?token=${t}` : ''}`,
      ),
    );

  it('valid token sets the sid cookie and redirects to /', async () => {
    const res = await call(token);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
    const cookie = res.cookies.get('sid');
    expect(cookie?.value).toBeTruthy();
    expect(res.headers.get('set-cookie')).toMatch(/sid=/);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  });

  it('reused token redirects to /login-info?error=expired', async () => {
    await call(token);
    const res = await call(token);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login-info?error=expired');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('missing token redirects to expired', async () => {
    const res = await call(null);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login-info?error=expired');
  });
});

describe('POST /auth/logout', () => {
  it('deletes the session, clears the cookie, redirects relatively', async () => {
    const userId = await upsertUser(db, {
      discordUserId: 'u2',
      displayName: 'Bob',
      avatarUrl: null,
    });
    const login = await createLoginToken(db, userId);
    const cb = await GET(
      new NextRequest(`http://localhost:3000/auth/callback?token=${login}`),
    );
    const sid = cb.cookies.get('sid')?.value as string;
    expect(await getSessionUser(db, sid)).not.toBeNull();

    const res = await POST(
      new NextRequest('http://localhost:3000/auth/logout', {
        method: 'POST',
        headers: { cookie: `sid=${sid}` },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login-info');
    const set = res.headers.get('set-cookie') as string;
    expect(set).toMatch(/sid=;/);
    expect(set).toMatch(/Max-Age=0/i);
    expect(await getSessionUser(db, sid)).toBeNull();
  });
});
