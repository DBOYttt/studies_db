import {
  type Db,
  type JobType,
  jobs,
  materials,
  StorageAccessError,
  StoragePathError,
} from '@studies/db';
import { and, eq, inArray, lt, lte, notInArray, sql } from 'drizzle-orm';

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

/** Atomically claims the earliest due queued job (SKIP LOCKED), or null. */
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
      // Matches idx_jobs_status_run_after, so LIMIT 1 reads and locks one row.
      .orderBy(jobs.runAfter, jobs.id)
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

/** Marks a pending material ready once all of its jobs are done. */
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
    .where(and(eq(materials.id, materialId), eq(materials.status, 'pending')));
}

/**
 * Sweeps pending materials whose jobs are all done (e.g. the process lost its
 * DB connection between completeJob and finalizeMaterial) to ready. Materials
 * without any jobs are left alone. Returns the number of materials updated.
 */
export async function finalizeStuckMaterials(db: Db): Promise<number> {
  const res = await db
    .update(materials)
    .set({ status: 'ready' })
    .where(
      and(
        eq(materials.status, 'pending'),
        sql`exists (select 1 from ${jobs} where ${jobs.materialId} = ${materials.id})`,
        sql`not exists (select 1 from ${jobs} where ${jobs.materialId} = ${materials.id} and ${jobs.status} <> 'done')`,
      ),
    );
  return affected(res);
}

// attempts acts as a fencing token: a worker that lost its lock (stale
// requeue + re-claim) no longer matches and its transitions become no-ops.
const owns = (job: Job) =>
  and(
    eq(jobs.id, job.id),
    eq(jobs.status, 'running'),
    eq(jobs.attempts, job.attempts),
  );

const affected = (res: unknown): number =>
  (res as [{ affectedRows: number }])[0].affectedRows;

/** Returns false if this worker no longer owns the job. */
export async function completeJob(db: Db, job: Job): Promise<boolean> {
  const res = await db
    .update(jobs)
    .set({ status: 'done', lockedAt: null })
    .where(owns(job));
  if (affected(res) === 0) return false;
  await finalizeMaterial(db, job.materialId);
  return true;
}

export async function enqueueJob(
  db: Db,
  materialId: number,
  type: JobType,
): Promise<void> {
  await db.insert(jobs).values({ materialId, type });
}

/** Errors that retrying cannot fix: the job fails on the first attempt. */
const isPermanent = (err: unknown) =>
  err instanceof StoragePathError || err instanceof StorageAccessError;

export async function failJob(
  db: Db,
  job: Job,
  err: unknown,
  now: Date = new Date(),
): Promise<'retry' | 'failed' | 'lost'> {
  const message = (err instanceof Error ? err.message : String(err)).slice(
    0,
    MAX_ERROR_LENGTH,
  );
  if (job.attempts < MAX_ATTEMPTS && !isPermanent(err)) {
    const delay = BACKOFF_MS[job.attempts - 1] ?? BACKOFF_MS.at(-1) ?? 0;
    const res = await db
      .update(jobs)
      .set({
        status: 'queued',
        lastError: message,
        runAfter: new Date(now.getTime() + delay),
        lockedAt: null,
      })
      .where(owns(job));
    return affected(res) === 0 ? 'lost' : 'retry';
  }
  return db.transaction(async (tx) => {
    const res = await tx
      .update(jobs)
      .set({ status: 'failed', lastError: message, lockedAt: null })
      .where(owns(job));
    if (affected(res) === 0) return 'lost' as const;
    await tx
      .update(materials)
      .set({ status: 'failed' })
      .where(eq(materials.id, job.materialId));
    return 'failed' as const;
  });
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
        .set({
          status: 'queued',
          runAfter: now,
          lockedAt: null,
          lastError: 'stale lock requeued',
        })
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

/** Finished jobs are kept this long. */
export const JOB_KEEP_MS = 30 * 24 * 3600_000;

/**
 * Deletes `done`/`failed` jobs last scheduled (`run_after`) more than
 * `keepMs` before `now`. Queued and running jobs stay, and so do the jobs of
 * a still pending material: finalizeStuckMaterials needs them to see that
 * every job is done. Returns how many were deleted.
 */
export async function pruneJobs(
  db: Db,
  now: Date,
  keepMs = JOB_KEEP_MS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - keepMs);
  const res = await db
    .delete(jobs)
    .where(
      and(
        inArray(jobs.status, ['done', 'failed']),
        lt(jobs.runAfter, cutoff),
        notInArray(
          jobs.materialId,
          db
            .select({ id: materials.id })
            .from(materials)
            .where(eq(materials.status, 'pending')),
        ),
      ),
    );
  return affected(res);
}
