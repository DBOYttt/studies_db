import { createLoginToken, type Db, upsertUser } from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

const { GET, POST } = await import('../app/auth/callback/route');

beforeAll(async () => {
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

async function freshToken() {
  const id = await upsertUser(db, {
    discordUserId: `u-${Math.random()}`,
    displayName: 'Ann',
    avatarUrl: null,
  });
  return createLoginToken(db, id);
}

const post = (token: string, next?: string) => {
  const body = new URLSearchParams({ token });
  if (next !== undefined) body.set('next', next);
  return POST(
    new NextRequest('http://localhost:3000/auth/callback', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin' },
      body,
    }),
  );
};

describe('/auth/callback next', () => {
  it('POST with next=/admin redirects there and sets advanced mode', async () => {
    const res = await post(await freshToken(), '/admin');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin');
    expect(res.cookies.get('sid')?.value).toBeTruthy();
    expect(res.cookies.get('studiesdb.mode')?.value).toBe('advanced');
  });

  it('POST with an unsafe next goes to / without the mode cookie', async () => {
    for (const next of ['//evil.com', 'https://evil.com', '/s', '/admin//x']) {
      const res = await post(await freshToken(), next);
      expect(res.headers.get('location')).toBe('/');
      expect(res.cookies.get('sid')?.value).toBeTruthy();
      expect(res.cookies.get('studiesdb.mode')).toBeUndefined();
    }
  });

  it('POST with a non-ASCII next still logs in and goes to /', async () => {
    const res = await post(await freshToken(), '/admin/ż');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
    expect(res.cookies.get('sid')?.value).toBeTruthy();
    expect(res.cookies.get('studiesdb.mode')).toBeUndefined();
  });

  it('POST without next keeps going to /', async () => {
    const res = await post(await freshToken());
    expect(res.headers.get('location')).toBe('/');
    expect(res.cookies.get('studiesdb.mode')).toBeUndefined();
  });

  it('GET renders next as an escaped hidden field', async () => {
    const res = await GET(
      new NextRequest(
        `http://localhost:3000/auth/callback?token=abc&next=${encodeURIComponent('/admin/"><x')}`,
      ),
    );
    const html = await res.text();
    expect(html).toContain('name="next" value="/admin/&quot;&gt;&lt;x"');
    expect(html).not.toContain('<x');
  });

  it('GET drops an invalid next', async () => {
    for (const next of ['//evil.com', '/admin/ż', '/s']) {
      const res = await GET(
        new NextRequest(
          `http://localhost:3000/auth/callback?token=abc&next=${encodeURIComponent(next)}`,
        ),
      );
      expect(await res.text()).not.toContain('name="next"');
    }
  });

  it('GET omits the next field when absent', async () => {
    const res = await GET(
      new NextRequest('http://localhost:3000/auth/callback?token=abc'),
    );
    expect(await res.text()).not.toContain('name="next"');
  });
});
