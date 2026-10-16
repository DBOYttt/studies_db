import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  adminAudit,
  botRequests,
  consumeLoginToken,
  createLoginToken,
  type Db,
  events,
  upsertUser,
  users,
  webUploads,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));

const storage = mkdtempSync(join(tmpdir(), 'studies-upload-'));
process.env.STORAGE_DIR = storage;

const { POST, GET } = await import('../app/api/wydarzenia/[id]/pliki/route');
const { handleEventUpload, sanitizeFilename } = await import(
  '../lib/event-upload'
);

const MB = 1024 * 1024;
let seq = 0;
let eventId: number;

async function login() {
  seq++;
  const id = await upsertUser(db, {
    discordUserId: `up${seq}`,
    displayName: `U${seq}`,
    avatarUrl: null,
  });
  const r = await consumeLoginToken(db, await createLoginToken(db, id));
  cookieSid = (r as { sessionToken: string }).sessionToken;
  return id;
}
async function newEvent() {
  const [e] = await db.insert(events).values({
    kind: 'inne',
    title: 'E',
    startsAt: new Date(Date.now() + 86_400_000),
    allDay: false,
  });
  return e.insertId;
}
const file = (bytes: number | Uint8Array, name: string) =>
  [
    typeof bytes === 'number' ? new Uint8Array(bytes).fill(7) : bytes,
    name,
  ] as const;
function body(files: (readonly [Uint8Array, string])[]) {
  const f = new FormData();
  for (const [data, name] of files) {
    f.append('files', new Blob([data as BlobPart]), name);
  }
  return f;
}
const post = (
  files: (readonly [Uint8Array, string])[],
  id: number | string = eventId,
  headers: Record<string, string> = {},
) =>
  POST(
    new Request(`http://x/api/wydarzenia/${id}/pliki`, {
      method: 'POST',
      body: body(files),
      headers,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
const stored = () =>
  existsSync(join(storage, 'uploads'))
    ? readdirSync(join(storage, 'uploads'))
    : [];
const one = (name = 'a.pdf') => [file(100, name)];

beforeAll(async () => {
  db = await resetTestDb();
  eventId = await newEvent();
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('POST /api/wydarzenia/[id]/pliki', () => {
  it('stores files under uploads/<uuid>, records rows, audit and one bot request', async () => {
    const uid = await login();
    const before = stored().length;
    const res = await post([
      file(Uint8Array.from([1, 2, 3, 4]), 'a.pdf'),
      file(10, 'b.txt'),
    ]);
    expect(res.status).toBe(200);
    const { uploads } = await res.json();
    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toMatchObject({ name: 'a.pdf', status: 'queued' });
    expect(stored().length).toBe(before + 2);
    const rows = await db
      .select()
      .from(webUploads)
      .where(eq(webUploads.userId, uid));
    expect(rows).toHaveLength(2);
    expect(rows[0].storagePath).toMatch(/^uploads\/[0-9a-f-]{36}$/);
    expect(rows[0].sizeBytes).toBe(4);
    expect([...readFileSync(join(storage, rows[0].storagePath))]).toEqual([
      1, 2, 3, 4,
    ]);
    const [audit] = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.userId, uid));
    expect(audit.action).toBe('event.upload');
    expect(audit.target).toBe(String(eventId));
    expect(audit.details).toMatchObject({ source: 'web', count: 2 });
    const reqs = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.kind, 'event_upload'));
    const mine = reqs.find((r) => r.target === `upload:${rows[0].id}`);
    expect(mine?.status).toBe('queued');
    expect(mine?.payload).toEqual({
      eventId,
      uploadIds: rows.map((r) => r.id),
    });
  });

  it('a second batch is not dropped while the first is queued', async () => {
    await login();
    await post(one());
    await post(one());
    const reqs = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.kind, 'event_upload'));
    expect(new Set(reqs.map((r) => r.target)).size).toBe(reqs.length);
  });

  it('refuses a banned user with nothing stored', async () => {
    const uid = await login();
    await db.update(users).set({ isBanned: true }).where(eq(users.id, uid));
    const before = stored().length;
    const res = await handleEventUpload(
      new Request('http://x/', { method: 'POST', body: body(one()) }),
      { id: uid },
      String(eventId),
      { db, storageRoot: storage },
    );
    expect(res.status).toBe(403);
    expect(stored().length).toBe(before);
  });

  it('refuses a request without a session', async () => {
    cookieSid = undefined;
    await expect(post(one())).rejects.toThrow('redirect:');
  });

  it('refuses a foreign Origin', async () => {
    await login();
    const before = stored().length;
    const res = await post(one(), eventId, { origin: 'http://evil.example' });
    expect(res.status).toBe(403);
    expect(stored().length).toBe(before);
  });

  it('400 for 11 files and leaves nothing behind', async () => {
    await login();
    const before = stored().length;
    const res = await post(
      Array.from({ length: 11 }, (_, i) => file(10, `f${i}.txt`)),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/10 plików/);
    expect(stored().length).toBe(before);
  });

  it('accepts exactly 10 MB and rejects 10 MB + 1 byte (partial file deleted)', async () => {
    await login();
    expect((await post([file(10 * MB, 'ok.bin')])).status).toBe(200);
    const before = stored().length;
    const res = await post([file(10 * MB + 1, 'big.bin'), file(5, 'x.txt')]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/za duży/);
    expect(stored().length).toBe(before);
  });

  it('rejects an empty file and a request without files', async () => {
    await login();
    const before = stored().length;
    const empty = await post([file(0, 'empty.txt'), file(5, 'x.txt')]);
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/pusty/);
    const none = await post([]);
    expect(none.status).toBe(400);
    expect(stored().length).toBe(before);
  });

  it('rejects a body that is not multipart', async () => {
    await login();
    const res = await POST(
      new Request('http://x/', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: String(eventId) }) },
    );
    expect(res.status).toBe(400);
  });

  it('429 on the 31st file within an hour, counted from the audit log', async () => {
    const uid = await login();
    await db.insert(adminAudit).values({
      userId: uid,
      action: 'event.upload',
      target: String(eventId),
      details: { source: 'web', count: 29 },
    });
    const before = stored().length;
    const two = await post([file(5, 'a.txt'), file(5, 'b.txt')]);
    expect(two.status).toBe(429);
    expect(stored().length).toBe(before);
    expect((await post(one())).status).toBe(200); // the 30th
    const res = await post(one()); // the 31st
    expect(res.status).toBe(429);
    expect(stored().length).toBe(before + 1);
  });

  it('keeps only the base name and stores under a generated path', async () => {
    const uid = await login();
    const res = await post([
      file(5, '../../x.pdf'),
      file(5, 'C:\\evil\\y.pdf'),
      file(5, 'ąę ł.pdf'),
      file(5, `${'z'.repeat(300)}.pdf`),
    ]);
    expect(await res.clone().json()).toMatchObject({
      uploads: expect.any(Array),
    });
    const rows = await db
      .select()
      .from(webUploads)
      .where(eq(webUploads.userId, uid));
    expect(rows.map((r) => r.originalFilename)).toEqual([
      'x.pdf',
      'y.pdf',
      'ąę ł.pdf',
      `${'z'.repeat(196)}.pdf`,
    ]);
    for (const r of rows)
      expect(r.storagePath).toMatch(/^uploads\/[0-9a-f-]{36}$/);
  });

  it('404 for a deleted, unknown or malformed event id', async () => {
    await login();
    const gone = await newEvent();
    await db
      .update(events)
      .set({ deletedAt: new Date() })
      .where(eq(events.id, gone));
    const before = stored().length;
    for (const id of [gone, 99999, 'abc', '0', '1e3']) {
      expect((await post(one(), id)).status).toBe(404);
    }
    expect(stored().length).toBe(before);
  });

  it('503 when STORAGE_DIR is not set', async () => {
    const uid = await login();
    const res = await handleEventUpload(
      new Request('http://x/', { method: 'POST', body: body(one()) }),
      { id: uid },
      String(eventId),
      { db, storageRoot: null },
    );
    expect(res.status).toBe(503);
  });
});

describe('sanitizeFilename', () => {
  it('strips separators of both kinds, control and bidi characters', () => {
    expect(sanitizeFilename('a\u0001b\u202ec.txt')).toBe('abc.txt');
    expect(sanitizeFilename('..\\..\\/x.pdf')).toBe('x.pdf');
    expect(sanitizeFilename('  ')).toBe('plik');
    expect(sanitizeFilename('..')).toBe('plik');
    expect(sanitizeFilename('😀'.repeat(250))).toBe('😀'.repeat(200));
  });
});

describe('GET /api/wydarzenia/[id]/pliki', () => {
  it('lists recent uploads and needs a session', async () => {
    await login();
    await post(one('status.pdf'));
    const res = await GET(new Request('http://x/'), {
      params: Promise.resolve({ id: String(eventId) }),
    });
    expect(res.status).toBe(200);
    const { uploads } = await res.json();
    expect(uploads[0]).toMatchObject({ name: 'status.pdf', status: 'queued' });
    cookieSid = undefined;
    await expect(
      GET(new Request('http://x/'), {
        params: Promise.resolve({ id: String(eventId) }),
      }),
    ).rejects.toThrow('redirect:');
  });
});
