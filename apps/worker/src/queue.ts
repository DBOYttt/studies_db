import { type Db, type JobType, jobs, materials } from '@studies/db';
import { and, eq, inArray, lt, lte, sql } from 'drizzle-orm';

export type Job = {
  id: number;
  materialId: number;
  type: JobType;
  attempts: number;
};

export const MAX_ATTEMPTS = 4;
export const BACKOFF_MS = [60_000, 300_000, 1_800_000];
export const STALE_LOCK_MS = 600_000;

const MAX_ERROR_LENGTH = 2000;

/** Atomically claims the oldest due queued job (SKIP LOCKED), or null. */
export async function claimJob(
  db: Db,
  now: Date = new Date(),
): Promise<Job | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: jobs.id,
        materialId: jobs.materialId,
        type: jobs.type,
        attempts: jobs.attempts,
      })
      .from(jobs)
      .where(and(eq(jobs.status, 'queued'), lte(jobs.runAfter, now)))
      .orderBy(jobs.id)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return null;
    await tx
      .update(jobs)
      .set({
        status: 'running',
        lockedAt: now,
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(eq(jobs.id, row.id));
    return { ...row, attempts: row.attempts + 1 };
  });
}

/** Marks the material ready once none of its jobs are pending or failed. */
export async function finalizeMaterial(
  db: Db,
  materialId: number,
): Promise<void> {
  const rows = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.materialId, materialId));
  if (rows.some((r) => r.status !== 'done')) return;
  await db
    .update(materials)
    .set({ status: 'ready' })
    .where(eq(materials.id, materialId));
}

export async function completeJob(db: Db, job: Job): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'done', lockedAt: null })
    .where(eq(jobs.id, job.id));
  await finalizeMaterial(db, job.materialId);
}

export async function enqueueJob(
  db: Db,
  materialId: number,
  type: JobType,
): Promise<void> {
  await db.insert(jobs).values({ materialId, type });
}

export async function failJob(
  db: Db,
  job: Job,
  err: unknown,
  now: Date = new Date(),
): Promise<'retry' | 'failed'> {
  const message = (err instanceof Error ? err.message : String(err)).slice(
    0,
    MAX_ERROR_LENGTH,
  );
  if (job.attempts < MAX_ATTEMPTS) {
    const delay = BACKOFF_MS[job.attempts - 1] ?? BACKOFF_MS.at(-1) ?? 0;
    await db
      .update(jobs)
      .set({
        status: 'queued',
        lastError: message,
        runAfter: new Date(now.getTime() + delay),
        lockedAt: null,
      })
      .where(eq(jobs.id, job.id));
    return 'retry';
  }
  await db.transaction(async (tx) => {
    await tx
      .update(jobs)
      .set({ status: 'failed', lastError: message, lockedAt: null })
      .where(eq(jobs.id, job.id));
    await tx
      .update(materials)
      .set({ status: 'failed' })
      .where(eq(materials.id, job.materialId));
  });
  return 'failed';
}

/**
 * Recovers `running` jobs whose lock is older than STALE_LOCK_MS. Jobs that
 * have exhausted their attempts are failed instead. Returns the number
 * re-queued.
 */
export async function requeueStale(
  db: Db,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_LOCK_MS);
  return db.transaction(async (tx) => {
    const stale = await tx
      .select({
        id: jobs.id,
        materialId: jobs.materialId,
        attempts: jobs.attempts,
      })
      .from(jobs)
      .where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, cutoff)))
      .for('update');
    const dead = stale.filter((j) => j.attempts >= MAX_ATTEMPTS);
    const alive = stale.filter((j) => j.attempts < MAX_ATTEMPTS);
    if (dead.length > 0) {
      await tx
        .update(jobs)
        .set({
          status: 'failed',
          lockedAt: null,
          lastError: 'stale lock after max attempts',
        })
        .where(
          inArray(
            jobs.id,
            dead.map((j) => j.id),
          ),
        );
      await tx
        .update(materials)
        .set({ status: 'failed' })
        .where(
          inArray(
            materials.id,
            dead.map((j) => j.materialId),
          ),
        );
    }
    if (alive.length > 0) {
      await tx
        .update(jobs)
        .set({ status: 'queued', runAfter: now, lockedAt: null })
        .where(
          inArray(
            jobs.id,
            alive.map((j) => j.id),
          ),
        );
    }
    return alive.length;
  });
}
