import {
  type Db,
  insertMaterial,
  jobs,
  materials,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKOFF_MS,
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  finalizeMaterial,
  MAX_ATTEMPTS,
  requeueStale,
} from '../src/queue.js';

let db: Db;
let topicId: number;
let uploaderId: number;
let seq = 0;

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
});

async function seed(types: ('convert' | 'extract_text')[] = ['convert']) {
  seq++;
  const { materialId } = await insertMaterial(
    db,
    {
      topicId,
      uploaderId,
      discordMessageId: `m${seq}`,
      discordAttachmentId: `a${seq}`,
      originalFilename: `f${seq}.docx`,
      mimeType: 'application/octet-stream',
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
      storagePath: `p${seq}`,
      previewKind: 'none',
    },
    types,
  );
  return materialId;
}

const jobRows = (materialId: number) =>
  db
    .select()
    .from(jobs)
    .where(eq(jobs.materialId, materialId))
    .orderBy(jobs.id);
const materialStatus = async (id: number) =>
  (await db.select().from(materials).where(eq(materials.id, id)))[0].status;

const T0 = new Date('2030-01-01T12:00:00Z');
const plus = (ms: number) => new Date(T0.getTime() + ms);

describe('claimJob', () => {
  it('concurrent claims on one job yield exactly one', async () => {
    await seed();
    const res = await Promise.all([claimJob(db, T0), claimJob(db, T0)]);
    expect(res.filter((r) => r !== null)).toHaveLength(1);
    const [row] = await db.select().from(jobs);
    expect(row.status).toBe('running');
    expect(row.attempts).toBe(1);
    expect(row.lockedAt).toEqual(T0);
  });

  it('does not claim a job with future run_after', async () => {
    const m = await seed();
    await db.update(jobs).set({ runAfter: plus(60_000) });
    expect(await claimJob(db, T0)).toBeNull();
    const job = await claimJob(db, plus(60_000));
    expect(job).toMatchObject({ materialId: m, type: 'convert', attempts: 1 });
  });

  it('returns null when empty', async () => {
    expect(await claimJob(db, T0)).toBeNull();
  });
});

describe('failJob', () => {
  it('retries with backoff then fails job and material', async () => {
    const m = await seed();
    await db.update(jobs).set({ runAfter: T0 });
    for (let i = 0; i < 3; i++) {
      const job = await claim();
      expect(job.attempts).toBe(i + 1);
      expect(await failJob(db, job, new Error('boom'), T0)).toBe('retry');
      const [row] = await jobRows(m);
      expect(row.status).toBe('queued');
      expect(row.lockedAt).toBeNull();
      expect(row.lastError).toBe('boom');
      expect(row.runAfter).toEqual(plus(BACKOFF_MS[i]));
      await db.update(jobs).set({ runAfter: T0 });
    }
    expect(BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000]);
    const last = await claim();
    expect(last.attempts).toBe(MAX_ATTEMPTS);
    expect(await failJob(db, last, 'x'.repeat(3000), T0)).toBe('failed');
    const [row] = await jobRows(m);
    expect(row.status).toBe('failed');
    expect(row.lockedAt).toBeNull();
    expect(row.lastError).toHaveLength(2000);
    expect(await materialStatus(m)).toBe('failed');
  });
});

describe('completeJob / finalizeMaterial', () => {
  it('last job done -> material ready', async () => {
    const m = await seed();
    const job = await claim();
    await completeJob(db, job);
    const [row] = await jobRows(m);
    expect(row.status).toBe('done');
    expect(row.lockedAt).toBeNull();
    expect(await materialStatus(m)).toBe('ready');
  });

  it('not ready while a sibling job is queued', async () => {
    const m = await seed(['convert', 'extract_text']);
    const job = await claim();
    await completeJob(db, job);
    expect(await materialStatus(m)).toBe('pending');
    const job2 = await claim();
    await completeJob(db, job2);
    expect(await materialStatus(m)).toBe('ready');
  });

  it('finalizeMaterial leaves material pending if a job failed', async () => {
    const m = await seed(['convert', 'extract_text']);
    await db
      .update(jobs)
      .set({ status: 'failed' })
      .where(eq(jobs.type, 'convert'));
    await db
      .update(jobs)
      .set({ status: 'done' })
      .where(eq(jobs.type, 'extract_text'));
    await finalizeMaterial(db, m);
    expect(await materialStatus(m)).toBe('pending');
  });
});

describe('enqueueJob', () => {
  it('inserts a queued job', async () => {
    const m = await seed([]);
    await enqueueJob(db, m, 'extract_text');
    const [row] = await jobRows(m);
    expect(row).toMatchObject({
      type: 'extract_text',
      status: 'queued',
      attempts: 0,
    });
  });
});

describe('requeueStale', () => {
  it('requeues only locks older than 10 minutes', async () => {
    const a = await seed();
    const b = await seed();
    await db
      .update(jobs)
      .set({ status: 'running', attempts: 1, lockedAt: plus(-11 * 60_000) })
      .where(eq(jobs.materialId, a));
    await db
      .update(jobs)
      .set({ status: 'running', attempts: 1, lockedAt: plus(-5 * 60_000) })
      .where(eq(jobs.materialId, b));
    expect(await requeueStale(db, T0)).toBe(1);
    const [ja] = await jobRows(a);
    expect(ja.status).toBe('queued');
    expect(ja.lockedAt).toBeNull();
    expect(ja.runAfter).toEqual(T0);
    expect((await jobRows(b))[0].status).toBe('running');
  });

  it('fails job and material when attempts exhausted', async () => {
    const m = await seed();
    await db.update(jobs).set({
      status: 'running',
      attempts: MAX_ATTEMPTS,
      lockedAt: plus(-11 * 60_000),
    });
    expect(await requeueStale(db, T0)).toBe(0);
    const [row] = await jobRows(m);
    expect(row.status).toBe('failed');
    expect(row.lockedAt).toBeNull();
    expect(row.lastError).toBe('stale lock after max attempts');
    expect(await materialStatus(m)).toBe('failed');
  });
});

async function claim() {
  const job = await claimJob(db, T0);
  if (!job) throw new Error('expected a job');
  return job;
}
