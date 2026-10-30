import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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
let fakeDb: unknown;
vi.mock('@/lib/db', () => ({ getDb: () => fakeDb ?? db }));

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));

const { parseRange, contentDisposition, handleFileRequest } = await import(
  '../lib/http-files'
);
const { GET } = await import('../app/files/[id]/[variant]/route');
const { contentSecurityPolicy } = await import('../lib/security-headers');
const APP_CSP = contentSecurityPolicy(process.env.NODE_ENV);

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
  const call = (
    id: number | string,
    variant: string,
    range?: string,
    extra: Record<string, string> = {},
  ) =>
    GET(
      new Request(`http://localhost/files/${id}/${variant}`, {
        headers: { ...(range ? { range } : {}), ...extra },
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
    // no object-src/default-src: the browser's PDF viewer must still open it
    expect(res.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    );
  });

  it('pdf preview of a not-yet-converted non-PDF original is 404', async () => {
    const docx = await seed({
      originalFilename: 'notatki.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      status: 'pending',
    });
    expect((await call(docx, 'preview')).status).toBe(404);
    // the original is still downloadable
    expect((await call(docx, 'original')).status).toBe(200);
  });

  it('pdf preview falls back to an original that sniffs as PDF', async () => {
    const id = await seed({
      originalFilename: 'skan',
      mimeType: 'application/octet-stream',
    });
    expect((await call(id, 'preview')).status).toBe(404); // body is digits
    await writeFile(join(storage, 'originals', `f${seq}`), '%PDF-1.7 ...');
    const res = await call(id, 'preview');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('%PDF-1.7 ...');
    // extension alone is enough
    const byExt = await seed({
      originalFilename: 'Wykład.PDF',
      mimeType: 'application/octet-stream',
    });
    expect((await call(byExt, 'preview')).status).toBe(200);
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
    // next.config leaves /files/ to the route, which sends the app CSP itself.
    expect(res.headers.get('content-security-policy')).toBe(APP_CSP);
    expect(res.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('svg preview gets the sandbox CSP; png gets the app CSP', async () => {
    const svg = await seed({ previewKind: 'image', mimeType: 'image/svg+xml' });
    const r1 = await call(svg, 'preview');
    expect(r1.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(r1.headers.get('x-content-type-options')).toBe('nosniff');
    const png = await seed({ previewKind: 'image', mimeType: 'image/png' });
    const r2 = await call(png, 'preview');
    expect(r2.headers.get('content-security-policy')).toBe(APP_CSP);
    expect(r2.headers.get('content-type')).toBe('image/png');
  });

  it('original of a type a browser would render as active content is octet-stream', async () => {
    for (const mimeType of [
      'text/html',
      'text/html; charset=utf-8',
      'TEXT/HTML',
      'application/xhtml+xml',
      'image/svg+xml',
      'text/javascript',
      'application/javascript',
      'application/x-javascript',
      'application/ecmascript',
      'text/xml',
      'application/xml',
      'application/rss+xml',
      'text/xsl',
      'multipart/x-mixed-replace; boundary=x',
    ]) {
      const id = await seed({ mimeType, previewKind: 'none' });
      const res = await call(id, 'original');
      expect(res.status, mimeType).toBe(200);
      expect(res.headers.get('content-type'), mimeType).toBe(
        'application/octet-stream',
      );
      expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    }
    for (const mimeType of [
      'application/pdf',
      'image/png',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]) {
      const id = await seed({ mimeType, previewKind: 'none' });
      const res = await call(id, 'original');
      expect(res.headers.get('content-type'), mimeType).toBe(mimeType);
    }
  });

  it('404 for files of a soft-deleted topic', async () => {
    const [t] = await db
      .insert(topics)
      .values({ title: 'Gone', discordThreadId: `gone-${seq}` });
    const id = await seed({ topicId: t.insertId });
    expect((await call(id, 'original')).status).toBe(200);
    await db
      .update(topics)
      .set({ deletedAt: new Date() })
      .where(eq(topics.id, t.insertId));
    expect((await call(id, 'original')).status).toBe(404);
    expect((await call(id, 'preview')).status).toBe(404);
  });

  it('image preview with non-image mime is 404; unknown kind is 404', async () => {
    const html = await seed({ previewKind: 'image', mimeType: 'text/html' });
    expect((await call(html, 'preview')).status).toBe(404);
    const unk = await seed();
    const [real] = await db
      .select()
      .from(materials)
      .where(eq(materials.id, unk));
    const where = () => ({
      limit: async () => [{ ...real, previewKind: 'weird' }],
    });
    fakeDb = {
      select: () => ({
        from: () => ({ where, innerJoin: () => ({ where }) }),
      }),
    };
    try {
      const res = await handleFileRequest(
        new Request('http://x/'),
        String(unk),
        'preview',
        { id: userId, displayName: 'Ann', avatarUrl: null, isAdmin: false },
      );
      expect(res.status).toBe(404);
    } finally {
      fakeDb = undefined;
    }
  });

  it('nosniff on 404 and 416', async () => {
    const r404 = await call(999999, 'original');
    expect(r404.status).toBe(404);
    expect(r404.headers.get('x-content-type-options')).toBe('nosniff');
    const id = await seed();
    const r416 = await call(id, 'original', 'bytes=100-');
    expect(r416.status).toBe(416);
    expect(r416.headers.get('x-content-type-options')).toBe('nosniff');
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

  it('404 for a preview that is a symlink (to a file outside storage)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'web-outside-'));
    try {
      await writeFile(join(outside, 'secret.pdf'), '%PDF-secret');
      await symlink(
        join(outside, 'secret.pdf'),
        join(storage, 'previews', 'link.pdf'),
      );
      const id = await seed({ previewPath: 'previews/link.pdf' });
      expect((await call(id, 'preview')).status).toBe(404);
      await symlink('/etc/hosts', join(storage, 'originals', 'hosts'));
      const orig = await seed({ storagePath: 'originals/hosts' });
      expect((await call(orig, 'original')).status).toBe(404);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('404 through a symlinked directory or for a non-regular file', async () => {
    await symlink('/etc', join(storage, 'etc'));
    const viaDir = await seed({ storagePath: 'etc/hosts' });
    expect((await call(viaDir, 'original')).status).toBe(404);
    const dir = await seed({ storagePath: 'previews' });
    expect((await call(dir, 'original')).status).toBe(404);
  });

  it('redirects to /login-info without a session cookie', async () => {
    const id = await seed();
    cookieSid = undefined;
    await expect(call(id, 'original')).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*\/login-info;/),
    });
  });

  describe('caching', () => {
    const SHA = 'b'.repeat(64);

    it('an original is immutable with a sha256 ETag', async () => {
      const id = await seed({ sha256: SHA });
      const res = await call(id, 'original');
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe(`"${SHA}"`);
      expect(res.headers.get('cache-control')).toBe(
        'private, max-age=31536000, immutable',
      );
    });

    it('If-None-Match with the ETag is 304 without a body', async () => {
      const id = await seed({ sha256: SHA });
      for (const inm of [`"${SHA}"`, `W/"${SHA}"`, `"x", "${SHA}"`, '*']) {
        const res = await call(id, 'original', undefined, {
          'if-none-match': inm,
        });
        expect(res.status).toBe(304);
        expect(res.body).toBeNull();
        expect(res.headers.get('etag')).toBe(`"${SHA}"`);
        expect(res.headers.get('cache-control')).toBe(
          'private, max-age=31536000, immutable',
        );
      }
      const other = await call(id, 'original', undefined, {
        'if-none-match': '"other"',
      });
      expect(other.status).toBe(200);
    });

    it('a preview revalidates; its ETag changes once the conversion lands', async () => {
      const id = await seed({ sha256: SHA });
      const before = await call(id, 'preview');
      expect(before.headers.get('cache-control')).toBe('private, no-cache');
      const etag = before.headers.get('etag');
      expect(etag).toMatch(new RegExp(`^"${SHA}`));
      expect(
        (await call(id, 'preview', undefined, { 'if-none-match': `${etag}` }))
          .status,
      ).toBe(304);
      await writeFile(join(storage, 'previews', 'c.pdf'), 'CONVERTED');
      await db
        .update(materials)
        .set({ previewPath: 'previews/c.pdf' })
        .where(eq(materials.id, id));
      const after = await call(id, 'preview', undefined, {
        'if-none-match': `${etag}`,
      });
      expect(after.status).toBe(200);
      expect(await after.text()).toBe('CONVERTED');
      expect(after.headers.get('etag')).not.toBe(etag);
      // PDF previews keep the frame-ancestors-only CSP on a 304 too
      const again = await call(id, 'preview', undefined, {
        'if-none-match': `${after.headers.get('etag')}`,
      });
      expect(again.status).toBe(304);
      expect(again.headers.get('content-security-policy')).toBe(
        "frame-ancestors 'none'",
      );
    });

    it('Range still works, and If-Range with another ETag sends the whole file', async () => {
      const id = await seed({ sha256: SHA });
      const ranged = await call(id, 'original', 'bytes=10-19', {
        'if-range': `"${SHA}"`,
      });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('etag')).toBe(`"${SHA}"`);
      expect(Buffer.from(await ranged.arrayBuffer()).toString()).toBe(
        '0123456789',
      );
      const stale = await call(id, 'original', 'bytes=10-19', {
        'if-range': '"old"',
      });
      expect(stale.status).toBe(200);
      expect(stale.headers.get('content-length')).toBe('100');
    });

    it('reads only the columns it needs (never extracted_text)', async () => {
      const id = await seed();
      const select = vi.spyOn(db, 'select');
      try {
        expect((await call(id, 'original')).status).toBe(200);
        const fileQuery = select.mock.calls.find(
          ([cols]) => cols !== undefined && 'storagePath' in (cols as object),
        );
        expect(fileQuery).toBeDefined();
        expect(Object.keys(fileQuery?.[0] as object).sort()).toEqual(
          [
            'id',
            'mimeType',
            'originalFilename',
            'previewKind',
            'previewPath',
            'sha256',
            'storagePath',
          ].sort(),
        );
      } finally {
        select.mockRestore();
      }
    });
  });

  it('handleFileRequest is callable directly', async () => {
    const id = await seed();
    const res = await handleFileRequest(
      new Request('http://x/'),
      String(id),
      'original',
      { id: userId, displayName: 'Ann', avatarUrl: null, isAdmin: false },
    );
    expect(res.status).toBe(200);
  });
});
