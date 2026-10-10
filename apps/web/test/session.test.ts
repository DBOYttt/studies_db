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
const { GET, POST: CALLBACK } = await import('../app/auth/callback/route');
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

describe('/auth/callback', () => {
  let token: string;
  beforeEach(async () => {
    const userId = await upsertUser(db, {
      discordUserId: 'u1',
      displayName: 'Ann',
      avatarUrl: null,
    });
    token = await createLoginToken(db, userId);
  });

  const get = (t: string | null) =>
    GET(
      new NextRequest(
        `http://localhost:3000/auth/callback${t ? `?token=${encodeURIComponent(t)}` : ''}`,
      ),
    );
  const post = (t: string | null) =>
    CALLBACK(
      new NextRequest('http://localhost:3000/auth/callback', {
        method: 'POST',
        body:
          t === null
            ? new URLSearchParams()
            : new URLSearchParams({ token: t }),
      }),
    );

  it('GET renders a confirmation form and does not consume the token', async () => {
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('set-cookie')).toBeNull();
    const html = await res.text();
    expect(html).toContain('Zaloguj się do Studies DB');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toMatch(/<form method="post" action="\/auth\/callback">/);
    expect(html).toContain(`name="token" value="${token}"`);
    expect(html).toMatch(/<button[^>]*>Zaloguj się<\/button>/);
  });

  it('GET twice (link preview) leaves the token usable by POST', async () => {
    await get(token);
    await get(token);
    const res = await post(token);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
  });

  it('GET escapes the token into the HTML', async () => {
    const html = await (await get('"><script>x</script>')).text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('GET without a token redirects to expired', async () => {
    const res = await get(null);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login-info?error=expired');
  });

  it('POST with a valid token sets the sid cookie and redirects to /', async () => {
    const res = await post(token);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
    const cookie = res.cookies.get('sid');
    expect(cookie?.value).toBeTruthy();
    expect(res.headers.get('set-cookie')).toMatch(/sid=/);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(await getSessionUser(db, cookie?.value as string)).toMatchObject({
      displayName: 'Ann',
    });
  });

  it('POST with a reused token redirects to /login-info?error=expired', async () => {
    await post(token);
    const res = await post(token);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login-info?error=expired');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('POST with a missing or bogus token redirects to expired', async () => {
    for (const t of [null, '', 'nope']) {
      const res = await post(t);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/login-info?error=expired');
    }
    const notForm = await CALLBACK(
      new NextRequest('http://localhost:3000/auth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    );
    expect(notForm.headers.get('location')).toBe('/login-info?error=expired');
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
    const cb = await CALLBACK(
      new NextRequest('http://localhost:3000/auth/callback', {
        method: 'POST',
        body: new URLSearchParams({ token: login }),
      }),
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
