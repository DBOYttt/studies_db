import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Db,
  insertMaterial,
  materials,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
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

const { parseRange, contentDisposition, handleFileRequest } = await import(
  '../lib/http-files'
);
const { GET } = await import('../app/files/[id]/[variant]/route');

describe('parseRange', () => {
  it('parses forms', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=990-5000', 1000)).toEqual({
      start: 990,
      end: 999,
    });
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange(null, 1000)).toBeNull();
  });
  it('flags invalid', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 1000)).toBe('invalid');
    expect(parseRange('bytes=5-2', 1000)).toBe('invalid');
    expect(parseRange('bytes=-0', 1000)).toBe('invalid');
    expect(parseRange('bytes=-', 1000)).toBe('invalid');
    expect(parseRange('bytes=0-1', 0)).toBe('invalid');
  });
});

describe('contentDisposition', () => {
  it('encodes non-ASCII per RFC 5987 with ASCII fallback', () => {
    const v = contentDisposition('attachment', 'Sprawozdanie – ćw. 3.docx');
    expect(v).toContain(
      "filename*=UTF-8''Sprawozdanie%20%E2%80%93%20%C4%87w.%203.docx",
    );
    const m = /filename="([^"]*)"/.exec(v);
    expect(m?.[1]).toBe('Sprawozdanie _ _w. 3.docx');
    expect(v.startsWith('attachment;')).toBe(true);
  });
  it('strips quotes', () => {
    expect(contentDisposition('inline', 'a"b.txt')).toContain(
      'filename="ab.txt"',
    );
  });
});

describe('file route', () => {
  let storage: string;
  let userId: number;
  let sid: string;
  let topicId: number;
  let seq = 0;
  const body = Buffer.from('0123456789'.repeat(10)); // 100 bytes

  beforeAll(async () => {
    db = await resetTestDb();
    const [s] = await db.insert(subjects).values({
      name: 'A',
      code: 'A',
      semester: 1,
      ects: 1,
      discordChannelId: 'f1',
    });
    const [t] = await db
      .insert(topics)
      .values({ subjectId: s.insertId, title: 'T', discordThreadId: 't1' });
    topicId = t.insertId;
    userId = await upsertUser(db, {
      discordUserId: 'u1',
      displayName: 'Ann',
      avatarUrl: null,
    });
    const { createLoginToken, consumeLoginToken } = await import('@studies/db');
    const token = await createLoginToken(db, userId);
    const r = await consumeLoginToken(db, token);
    sid = (r as { sessionToken: string }).sessionToken;
  });
  afterAll(async () => {
    await closeTestDb(db);
  });
  beforeEach(async () => {
    storage = await mkdtemp(join(tmpdir(), 'web-files-'));
    vi.stubEnv('STORAGE_DIR', storage);
    await mkdir(join(storage, 'originals'), { recursive: true });
    await mkdir(join(storage, 'previews'), { recursive: true });
    cookieSid = sid;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(storage, { recursive: true, force: true });
  });

  async function seed(over: Partial<typeof materials.$inferInsert> = {}) {
    seq++;
    await writeFile(join(storage, 'originals', `f${seq}`), body);
    const { materialId } = await insertMaterial(
      db,
      {
        topicId,
        uploaderId: userId,
        discordMessageId: `m${seq}`,
        discordAttachmentId: `a${seq}`,
        originalFilename: 'doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: body.length,
        sha256: 'a'.repeat(64),
        storagePath: `originals/f${seq}`,
        previewKind: 'pdf',
        ...over,
      },
      [],
    );
    return materialId;
  }
  const call = (id: number | string, variant: string, range?: string) =>
    GET(
      new Request(`http://localhost/files/${id}/${variant}`, {
        headers: range ? { range } : {},
      }),
      { params: Promise.resolve({ id: String(id), variant }) },
    ) as Promise<Response>;

  it('200 full original with attachment headers', async () => {
    const id = await seed({ originalFilename: 'ćw.pdf' });
    const res = await call(id, 'original');
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(body);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it('empty mime falls back to octet-stream', async () => {
    const id = await seed({ mimeType: '', previewKind: 'none' });
    const res = await call(id, 'original');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('206 with range', async () => {
    const id = await seed();
    const res = await call(id, 'original', 'bytes=10-19');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('0123456789');
  });

  it('416 for unsatisfiable range', async () => {
    const id = await seed();
    const res = await call(id, 'original', 'bytes=100-');
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */100');
  });

  it('pdf preview falls back to the original, inline', async () => {
    const id = await seed();
    const res = await call(id, 'preview');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('pdf preview uses preview_path when set', async () => {
    const id = await seed({ previewPath: 'previews/p.pdf' });
    await writeFile(join(storage, 'previews', 'p.pdf'), 'PREVIEW');
    const res = await call(id, 'preview');
    expect(await res.text()).toBe('PREVIEW');
  });

  it('text preview is text/plain', async () => {
    const id = await seed({
      previewKind: 'text',
      mimeType: 'text/html',
      originalFilename: 'a.txt',
    });
    const res = await call(id, 'preview');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('svg preview gets CSP; png does not', async () => {
    const svg = await seed({ previewKind: 'image', mimeType: 'image/svg+xml' });
    const r1 = await call(svg, 'preview');
    expect(r1.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(r1.headers.get('x-content-type-options')).toBe('nosniff');
    const png = await seed({ previewKind: 'image', mimeType: 'image/png' });
    const r2 = await call(png, 'preview');
    expect(r2.headers.get('content-security-policy')).toBeNull();
    expect(r2.headers.get('content-type')).toBe('image/png');
  });

  it('404 for preview kind none, soft-deleted, missing, bad id, bad variant', async () => {
    const none = await seed({ previewKind: 'none' });
    expect((await call(none, 'preview')).status).toBe(404);
    const del = await seed();
    await db
      .update(materials)
      .set({ deletedAt: new Date() })
      .where(eq(materials.id, del));
    expect((await call(del, 'original')).status).toBe(404);
    expect((await call(999999, 'original')).status).toBe(404);
    expect((await call('abc', 'original')).status).toBe(404);
    expect((await call('0', 'original')).status).toBe(404);
    expect((await call('1.5', 'original')).status).toBe(404);
    const ok = await seed();
    expect((await call(ok, 'bogus')).status).toBe(404);
  });

  it('404 when file missing on disk or path escapes storage', async () => {
    const id = await seed({ storagePath: 'originals/nope' });
    expect((await call(id, 'original')).status).toBe(404);
    const esc = await seed({ storagePath: '../../etc/passwd' });
    expect((await call(esc, 'original')).status).toBe(404);
  });

  it('redirects to /login-info without a session cookie', async () => {
    const id = await seed();
    cookieSid = undefined;
    await expect(call(id, 'original')).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*\/login-info;/),
    });
  });

  it('handleFileRequest is callable directly', async () => {
    const id = await seed();
    const res = await handleFileRequest(
      new Request('http://x/'),
      String(id),
      'original',
      { id: userId, displayName: 'Ann', avatarUrl: null },
    );
    expect(res.status).toBe(200);
  });
});
