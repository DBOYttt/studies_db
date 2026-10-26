import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  botRequests,
  consumeLoginToken,
  createLoginToken,
  type Db,
  getSessionUser,
  insertMaterial,
  jobs,
  loginTokens,
  materials,
  originalRelPath,
  planProcessing,
  sessions,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processOne, startWorker, type WorkerDeps } from '../src/handlers.js';
import { BACKOFF_MS } from '../src/queue.js';
import { wrapBin } from './wrap-bin.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

let db: Db;
let topicId: number;
let uploaderId: number;
let storageDir: string;
let countFile: string;
let seq = 0;
let countingSoffice: string;

beforeAll(async () => {
  db = await resetTestDb();
  const [s] = await db.insert(subjects).values({
    name: 'Algebra',
    code: 'ALG',
    semester: 1,
    ects: 5,
    discordChannelId: 'forum1',
  });
  const [t] = await db
    .insert(topics)
    .values({ subjectId: s.insertId, title: 'T', discordThreadId: 't1' });
  topicId = t.insertId;
  uploaderId = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'U',
    avatarUrl: null,
  });
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  await db.delete(jobs);
  await db.delete(materials);
  storageDir = await mkdtemp(join(tmpdir(), 'worker-test-'));
  countFile = join(storageDir, 'soffice-count');
  countingSoffice = await wrapBin(
    storageDir,
    join(fixtures, 'count-soffice.sh'),
    {
      SOFFICE_COUNT_FILE: countFile,
    },
  );
});

const deps = (over: Partial<WorkerDeps> = {}): WorkerDeps => ({
  db,
  storageDir,
  sofficeBin: countingSoffice,
  pdftotextBin: 'pdftotext',
  ...over,
});

async function ingest(
  fixture: string,
  filename: string,
  mime: string,
  bytesOverride?: Buffer,
) {
  seq++;
  const bytes = bytesOverride ?? (await readFile(join(fixtures, fixture)));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ext = filename.includes('.') ? (filename.split('.').pop() ?? '') : '';
  const storagePath = originalRelPath(sha256, ext);
  await mkdir(join(storageDir, 'originals'), { recursive: true });
  await writeFile(join(storageDir, storagePath), bytes);
  const plan = planProcessing(filename, mime);
  const { materialId } = await insertMaterial(
    db,
    {
      topicId,
      uploaderId,
      discordMessageId: `m${seq}`,
      discordAttachmentId: `a${seq}`,
      originalFilename: filename,
      mimeType: mime,
      sizeBytes: bytes.length,
      sha256,
      storagePath,
      previewKind: plan.previewKind,
    },
    plan.jobs,
  );
  return { materialId, sha256 };
}

const material = async (id: number) =>
  (await db.select().from(materials).where(eq(materials.id, id)))[0];
const drain = async (d: WorkerDeps) => {
  for (let i = 0; i < 20 && (await processOne(d)); i++);
};
const sofficeCalls = async () =>
  (await readFile(countFile, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean).length;

describe('processOne', () => {
  it('docx goes pending -> ready with preview and text', async () => {
    const { materialId, sha256 } = await ingest(
      'sample.docx',
      'sample.docx',
      'application/octet-stream',
    );
    await drain(deps());
    const m = await material(materialId);
    expect(m.status).toBe('ready');
    expect(m.previewPath).toBe(`previews/${sha256}.pdf`);
    expect(m.extractedText).toContain('sterownik');
  });

  it('pdf gets text without conversion', async () => {
    const { materialId } = await ingest(
      'sample.pdf',
      'sample.pdf',
      'application/pdf',
    );
    await drain(deps());
    const m = await material(materialId);
    expect(m.status).toBe('ready');
    expect(m.extractedText?.trim().length).toBeGreaterThan(0);
    expect(await sofficeCalls()).toBe(0);
  });

  it('pdf without extension gets text', async () => {
    const { materialId } = await ingest(
      'sample.pdf',
      'skan',
      'application/pdf',
    );
    await drain(deps());
    const m = await material(materialId);
    expect(m.storagePath).not.toContain('.');
    expect(m.status).toBe('ready');
    expect(m.extractedText?.trim().length).toBeGreaterThan(0);
  });

  it('markdown gets text, preview_kind text', async () => {
    const { materialId } = await ingest(
      'x',
      'notes.md',
      'text/markdown',
      Buffer.from('# Tytuł\n\nzażółć gęślą jaźń\n'),
    );
    await drain(deps());
    const m = await material(materialId);
    expect(m.status).toBe('ready');
    expect(m.previewKind).toBe('text');
    expect(m.extractedText).toContain('zażółć gęślą jaźń');
  });

  it('two materials with same docx content share one preview', async () => {
    const a = await ingest('sample.docx', 'a.docx', 'application/octet-stream');
    const b = await ingest('sample.docx', 'b.docx', 'application/octet-stream');
    await drain(deps());
    expect((await material(a.materialId)).status).toBe('ready');
    expect((await material(b.materialId)).status).toBe('ready');
    expect((await material(b.materialId)).previewPath).toBe(
      `previews/${a.sha256}.pdf`,
    );
    expect(await sofficeCalls()).toBe(1);
  });

  it('corrupt docx ends failed after 4 attempts', async () => {
    const { materialId } = await ingest(
      'corrupt.docx',
      'corrupt.docx',
      'application/octet-stream',
    );
    let t = Date.now();
    const d = deps({ now: () => new Date(t) });
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(await processOne(d)).toBe(true);
      t += (BACKOFF_MS[attempt] ?? 0) + 1000;
    }
    expect(await processOne(d)).toBe(false);
    const m = await material(materialId);
    expect(m.status).toBe('failed');
    const [j] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.materialId, materialId));
    expect(j.status).toBe('failed');
    expect(j.attempts).toBe(4);
    expect(j.lastError?.length).toBeGreaterThan(0);
  }, 60_000);

  it('skips soft-deleted materials without work', async () => {
    const { materialId } = await ingest(
      'sample.docx',
      'sample.docx',
      'application/octet-stream',
    );
    await db
      .update(materials)
      .set({ deletedAt: new Date() })
      .where(eq(materials.id, materialId));
    await drain(deps());
    expect(await sofficeCalls()).toBe(0);
    const [j] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.materialId, materialId));
    expect(j.status).toBe('done');
  });
});

describe('storage containment', () => {
  const jobOf = async (materialId: number) =>
    (await db.select().from(jobs).where(eq(jobs.materialId, materialId)))[0];

  // What the admin SQL console could do: repoint a row at a file outside
  // STORAGE_DIR and queue a job for it.
  it('fails an extract_text job whose storage_path escapes, without reading it', async () => {
    const secret = join(dirname(storageDir), `secret-${seq}.txt`);
    await writeFile(secret, 'SECRET=hunter2\n');
    try {
      const { materialId } = await ingest(
        'x',
        'notes.txt',
        'text/plain',
        Buffer.from('ok'),
      );
      const rel = join('..', `secret-${seq}.txt`);
      await db
        .update(materials)
        .set({ storagePath: rel })
        .where(eq(materials.id, materialId));
      expect(await processOne(deps())).toBe(true);
      const m = await material(materialId);
      expect(m.extractedText).toBeNull();
      expect(m.status).toBe('failed');
      const j = await jobOf(materialId);
      expect(j.status).toBe('failed');
      expect(j.attempts).toBe(1);
      expect(j.lastError).toBe('Invalid file path');
      expect(await processOne(deps())).toBe(false);
    } finally {
      await rm(secret, { force: true });
    }
  });

  it('refuses an absolute storage_path', async () => {
    const { materialId } = await ingest(
      'x',
      'notes.txt',
      'text/plain',
      Buffer.from('ok'),
    );
    await db
      .update(materials)
      .set({ storagePath: '/etc/passwd' })
      .where(eq(materials.id, materialId));
    await processOne(deps());
    expect((await material(materialId)).extractedText).toBeNull();
    expect((await jobOf(materialId)).lastError).toBe('Invalid file path');
  });

  it('refuses a preview_path that escapes', async () => {
    const { materialId } = await ingest(
      'x',
      'notes.txt',
      'text/plain',
      Buffer.from('ok'),
    );
    await db
      .update(materials)
      .set({ previewKind: 'pdf', previewPath: '../../etc/x.pdf' })
      .where(eq(materials.id, materialId));
    await processOne(deps());
    const j = await jobOf(materialId);
    expect(j.status).toBe('failed');
    expect(j.lastError).toBe('Invalid file path');
  });

  it('refuses convert when sha256 is malformed', async () => {
    const { materialId } = await ingest(
      'sample.docx',
      'sample.docx',
      'application/octet-stream',
    );
    const outside = `../../../${'x'.repeat(10)}`;
    await db
      .update(materials)
      .set({ sha256: outside })
      .where(eq(materials.id, materialId));
    expect(await processOne(deps())).toBe(true);
    expect(await sofficeCalls()).toBe(0);
    const m = await material(materialId);
    expect(m.previewPath).toBeNull();
    expect(m.status).toBe('failed');
    const j = await jobOf(materialId);
    expect(j.status).toBe('failed');
    expect(j.attempts).toBe(1);
    expect(j.lastError).toBe('Invalid file path');
  });
});

describe('startWorker', () => {
  it('stops on abort', async () => {
    const ac = new AbortController();
    const p = startWorker(deps(), {
      concurrency: 2,
      pollMs: 50,
      signal: ac.signal,
    });
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    ac.abort();
    await p;
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('purges expired sessions and login tokens when it starts', async () => {
    const t0 = new Date(Date.now() - 40 * 24 * 3600_000);
    const stale = await consumeLoginToken(
      db,
      await createLoginToken(db, uploaderId, t0),
      t0,
    );
    await createLoginToken(db, uploaderId, t0);
    const live = await consumeLoginToken(
      db,
      await createLoginToken(db, uploaderId),
    );
    const count = async () =>
      (await db.select().from(sessions)).length +
      (await db.select().from(loginTokens)).length;
    expect(await count()).toBe(5);

    const ac = new AbortController();
    const p = startWorker(deps(), {
      concurrency: 1,
      pollMs: 50,
      signal: ac.signal,
    });
    for (let i = 0; i < 50 && (await count()) > 2; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    ac.abort();
    await p;
    // left: the live session and the (used) token it came from
    expect(await count()).toBe(2);
    expect(stale).not.toBeNull();
    expect(
      await getSessionUser(db, (live as { sessionToken: string }).sessionToken),
    ).not.toBeNull();
  });

  it('prunes finished bot requests and jobs older than 30 days when it starts', async () => {
    const old = new Date(Date.now() - 40 * 24 * 3600_000);
    await db.delete(botRequests);
    await db.insert(botRequests).values([
      {
        kind: 'k',
        target: 'old',
        status: 'done',
        createdAt: old,
        finishedAt: old,
      },
      { kind: 'k', target: 'queued', status: 'queued', createdAt: old },
    ]);
    const { materialId } = await ingest('cp1250.txt', 'a.txt', 'text/plain');
    await db
      .update(jobs)
      .set({ status: 'done', runAfter: old })
      .where(eq(jobs.materialId, materialId));
    const counts = async () => [
      (await db.select().from(botRequests)).length,
      (await db.select().from(jobs)).length,
    ];
    const ac = new AbortController();
    const p = startWorker(deps(), {
      concurrency: 1,
      pollMs: 50,
      signal: ac.signal,
    });
    for (let i = 0; i < 50 && (await counts()).join() !== '1,0'; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    ac.abort();
    await p;
    expect(await counts()).toEqual([1, 0]);
    const [left] = await db.select().from(botRequests);
    expect(left.target).toBe('queued');
    await db.delete(botRequests);
  });

  it('processes queued jobs while running', async () => {
    const { materialId } = await ingest(
      'sample.pdf',
      'sample.pdf',
      'application/pdf',
    );
    const ac = new AbortController();
    const p = startWorker(deps(), {
      concurrency: 2,
      pollMs: 50,
      signal: ac.signal,
    });
    for (let i = 0; i < 100; i++) {
      if ((await material(materialId)).status === 'ready') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    ac.abort();
    await p;
    expect((await material(materialId)).status).toBe('ready');
  });
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
});
