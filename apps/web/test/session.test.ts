import {
  consumeLoginToken,
  createLoginToken,
  type Db,
  getSessionUser,
  upsertUser,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
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

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));

const { requireAdmin, sessionCookieOptions } = await import('../lib/session');
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

const SAME = { 'sec-fetch-site': 'same-origin' };

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
  const post = (t: string | null, headers: Record<string, string> = SAME) =>
    CALLBACK(
      new NextRequest('http://localhost:3000/auth/callback', {
        method: 'POST',
        headers,
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
    expect(html).toContain('Sign in to Studies DB');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toMatch(/<form method="post" action="\/auth\/callback">/);
    expect(html).toContain(`name="token" value="${token}"`);
    expect(html).toMatch(/<button[^>]*>Sign in<\/button>/);
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
        headers: { ...SAME, 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    );
    expect(notForm.headers.get('location')).toBe('/login-info?error=expired');
  });

  it('POST from another origin is refused and keeps the token', async () => {
    vi.stubEnv('WEB_BASE_URL', 'http://localhost:3000');
    for (const headers of <Record<string, string>[]>[
      { origin: 'http://evil.example' },
      { origin: 'null', 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'cross-site' },
      {},
    ]) {
      const res = await post(token, headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    const ok = await post(token, { origin: 'http://localhost:3000' });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/');
    expect(ok.cookies.get('sid')?.value).toBeTruthy();
  });

  it('POST from the no-referrer confirmation page (Origin: null) works', async () => {
    const res = await post(token, {
      origin: 'null',
      'sec-fetch-site': 'same-origin',
    });
    expect(res.status).toBe(303);
    expect(res.cookies.get('sid')?.value).toBeTruthy();
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
        headers: SAME,
        body: new URLSearchParams({ token: login }),
      }),
    );
    const sid = cb.cookies.get('sid')?.value as string;
    expect(await getSessionUser(db, sid)).not.toBeNull();

    const res = await POST(
      new NextRequest('http://localhost:3000/auth/logout', {
        method: 'POST',
        headers: { ...SAME, cookie: `sid=${sid}` },
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

describe('POST /auth/logout from another origin', () => {
  it('is refused with 403 and keeps the session', async () => {
    vi.stubEnv('WEB_BASE_URL', 'http://localhost:3000');
    const userId = await upsertUser(db, {
      discordUserId: 'u3',
      displayName: 'Cid',
      avatarUrl: null,
    });
    const sid = (
      await consumeLoginToken(db, await createLoginToken(db, userId))
    )?.sessionToken as string;
    for (const headers of <Record<string, string>[]>[
      { origin: 'http://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
      {},
    ]) {
      const res = await POST(
        new NextRequest('http://localhost:3000/auth/logout', {
          method: 'POST',
          headers: { ...headers, cookie: `sid=${sid}` },
        }),
      );
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    expect(await getSessionUser(db, sid)).not.toBeNull();
    const ok = await POST(
      new NextRequest('http://localhost:3000/auth/logout', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', cookie: `sid=${sid}` },
      }),
    );
    expect(ok.status).toBe(303);
    expect(await getSessionUser(db, sid)).toBeNull();
  });
});

describe('requireAdmin', () => {
  const expect404 = async () => {
    try {
      await requireAdmin();
      expect.unreachable();
    } catch (e) {
      expect(String((e as { digest?: string }).digest)).toBe(
        'NEXT_HTTP_ERROR_FALLBACK;404',
      );
    }
  };

  it('returns the admin, 404s for non-admins and anonymous users', async () => {
    const userId = await upsertUser(db, {
      discordUserId: 'adm1',
      displayName: 'Ada',
      avatarUrl: null,
    });
    const r = await consumeLoginToken(db, await createLoginToken(db, userId));
    cookieSid = (r as { sessionToken: string }).sessionToken;
    try {
      await expect404();

      await db.update(users).set({ isAdmin: true }).where(eq(users.id, userId));
      expect(await requireAdmin()).toMatchObject({
        id: userId,
        displayName: 'Ada',
        isAdmin: true,
      });

      await db
        .update(users)
        .set({ isAdmin: false })
        .where(eq(users.id, userId));
      await expect404();

      cookieSid = undefined;
      await expect404();
    } finally {
      cookieSid = undefined;
    }
  });
});
