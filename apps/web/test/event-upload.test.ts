import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
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
  headers: async () => new Headers(),
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
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
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
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const SAME_ORIGIN_HEADERS = (h: Record<string, string>) =>
  'origin' in h ? h : { ...SAME_ORIGIN, ...h };
const post = (
  files: (readonly [Uint8Array, string])[],
  id: number | string = eventId,
  headers: Record<string, string> = {},
) =>
  POST(
    new Request(`http://x/api/wydarzenia/${id}/pliki`, {
      method: 'POST',
      body: body(files),
      headers: SAME_ORIGIN_HEADERS(headers),
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
      new Request('http://x/', {
        method: 'POST',
        body: body(one()),
        headers: SAME_ORIGIN,
      }),
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

  it('refuses a request with no Origin and no Sec-Fetch-Site', async () => {
    const uid = await login();
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

  it('400 for 11 files and leaves nothing behind', async () => {
    await login();
    const before = stored().length;
    const res = await post(
      Array.from({ length: 11 }, (_, i) => file(10, `f${i}.txt`)),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at most 10 files/);
    expect(stored().length).toBe(before);
  });

  it('accepts exactly 10 MB and rejects 10 MB + 1 byte (partial file deleted)', async () => {
    await login();
    expect((await post([file(10 * MB, 'ok.bin')])).status).toBe(200);
    const before = stored().length;
    const res = await post([file(10 * MB + 1, 'big.bin'), file(5, 'x.txt')]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/);
    expect(stored().length).toBe(before);
  });

  it('rejects an empty file and a request without files', async () => {
    await login();
    const before = stored().length;
    const empty = await post([file(0, 'empty.txt'), file(5, 'x.txt')]);
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/empty/);
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
        headers: { 'content-type': 'application/json', ...SAME_ORIGIN },
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
      .where(eq(webUploads.userId, uid))
      .orderBy(webUploads.id);
    expect(rows.map((r) => r.originalFilename)).toEqual([
      'x.pdf',
      'y.pdf',
      'ąę ł.pdf',
      `${'z'.repeat(196)}.pdf`,
    ]);
    for (const r of rows)
      expect(r.storagePath).toMatch(/^uploads\/[0-9a-f-]{36}$/);
  });

  it('keeps the selection order even when a later file finishes first', async () => {
    const uid = await login();
    const res = await post([
      file(9 * MB, 'big.bin'),
      file(3, 'small.txt'),
      file(2 * MB, 'mid.bin'),
    ]);
    expect(res.status).toBe(200);
    expect(
      (await res.json()).uploads.map((u: { name: string }) => u.name),
    ).toEqual(['big.bin', 'small.txt', 'mid.bin']);
    const rows = await db
      .select()
      .from(webUploads)
      .where(eq(webUploads.userId, uid))
      .orderBy(webUploads.id);
    expect(rows.map((r) => r.originalFilename)).toEqual([
      'big.bin',
      'small.txt',
      'mid.bin',
    ]);
  });

  /** The multipart body sent chunked: no Content-Length. */
  async function chunked(
    prefixBytes: number,
    files: (readonly [Uint8Array, string])[],
  ) {
    const r = new Response(body(files));
    const type = r.headers.get('content-type') as string;
    const bytes = new Uint8Array(await r.arrayBuffer());
    let sentPrefix = 0;
    let sentBody = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sentPrefix < prefixBytes) {
          const n = Math.min(MB, prefixBytes - sentPrefix);
          sentPrefix += n;
          c.enqueue(new Uint8Array(n).fill(65));
        } else if (!sentBody) {
          sentBody = true;
          c.enqueue(bytes);
        } else c.close();
      },
    });
    return POST(
      new Request(`http://x/api/wydarzenia/${eventId}/pliki`, {
        method: 'POST',
        body: stream,
        headers: { 'content-type': type, ...SAME_ORIGIN },
        duplex: 'half',
      } as RequestInit),
      { params: Promise.resolve({ id: String(eventId) }) },
    );
  }

  it('counts the bytes of a chunked body and stops above the limit', async () => {
    await login();
    const before = stored().length;
    const res = await chunked(97 * MB, one());
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('Max 95 MB in total at once.');
    expect(stored().length).toBe(before);
  });

  it('accepts a small chunked body', async () => {
    await login();
    expect((await chunked(0, one())).status).toBe(200);
  });

  it('caps the total of one request at 95 MB', async () => {
    await login();
    const before = stored().length;
    const res = await chunked(
      0,
      Array.from({ length: 10 }, (_, i) => file(9.6 * MB, `f${i}.bin`)),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('Max 95 MB in total at once.');
    expect(stored().length).toBe(before);
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
    // A stale tab's upload says why it went nowhere; a deleted and an unknown
    // id answer alike, so nothing is revealed.
    for (const id of [gone, 99999]) {
      expect((await (await post(one(), id)).json()).error).toBe(
        'This event was deleted.',
      );
    }
    expect(stored().length).toBe(before);
  });

  it('503 when STORAGE_DIR is not set', async () => {
    const uid = await login();
    const res = await handleEventUpload(
      new Request('http://x/', {
        method: 'POST',
        body: body(one()),
        headers: SAME_ORIGIN,
      }),
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

describe('retryUploadsAction', () => {
  const retryUploadsAction = async (id: number) =>
    (await import('../lib/event-actions')).retryUploadsAction(id);

  async function failedUpload(withFile: boolean) {
    const res = await post(one('r.pdf'));
    const { uploads } = (await res.json()) as { uploads: { id: number }[] };
    const [row] = await db
      .select()
      .from(webUploads)
      .where(eq(webUploads.id, uploads[0].id));
    await db
      .update(webUploads)
      .set({
        status: 'failed',
        error: 'Nie udało się wysłać pliku na Discorda.',
      })
      .where(eq(webUploads.id, row.id));
    if (!withFile) unlinkSync(join(storage, row.storagePath));
    return row.id;
  }

  it('requeues failed uploads whose file remains and enqueues a request', async () => {
    const uid = await login();
    const keep = await failedUpload(true);
    const lost = await failedUpload(false);
    await db.delete(botRequests);
    const r = await retryUploadsAction(eventId);
    expect(r.ok).toBe(true);
    const [a] = await db
      .select()
      .from(webUploads)
      .where(eq(webUploads.id, keep));
    const [b] = await db
      .select()
      .from(webUploads)
      .where(eq(webUploads.id, lost));
    expect(a).toMatchObject({ status: 'queued', error: null });
    expect(b.status).toBe('failed');
    const reqs = await db.select().from(botRequests);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({
      kind: 'event_upload',
      target: `upload:${keep}`,
      status: 'queued',
    });
    expect(reqs[0].payload).toEqual({
      eventId,
      uploadIds: [keep],
    });
    expect(uid).toBeGreaterThan(0);
    const audit = (await db.select().from(adminAudit)).filter(
      (x) => x.action === 'event.upload_retry',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: uid, target: String(eventId) });
    expect(audit[0].details).toMatchObject({ source: 'web', count: 1 });
  });

  it('says so when nothing can be retried', async () => {
    await login();
    await db.delete(webUploads);
    const r = await retryUploadsAction(eventId);
    expect(r).toMatchObject({
      ok: false,
      message: 'No files to retry.',
    });
  });

  it('refuses a banned user', async () => {
    const uid = await login();
    await failedUpload(true);
    await db.update(users).set({ isBanned: true }).where(eq(users.id, uid));
    await db.delete(botRequests);
    const r = await retryUploadsAction(eventId).catch(() => null);
    expect(r?.ok ?? false).toBe(false);
    expect(await db.select().from(botRequests)).toHaveLength(0);
  });
});
