import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type Db, materials, previewRelPath } from '@studies/db';
import { eq } from 'drizzle-orm';
import { convertToPdf } from './convert.js';
import { extractPdfText, readTextFile, truncateUtf8 } from './extract.js';
import {
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  type Job,
  requeueStale,
} from './queue.js';

export type WorkerDeps = {
  db: Db;
  storageDir: string;
  sofficeBin: string;
  pdftotextBin: string;
  now?: () => Date;
};

const CONVERT_TIMEOUT_MS = 120_000;
const EXTRACT_TIMEOUT_MS = 30_000;
const MAX_TEXT_BYTES = 1_048_576;
const REQUEUE_EVERY_MS = 60_000;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return false;
      throw e;
    },
  );

/** Runs one job; throws on failure (the caller records it via failJob). */
export async function runJob(deps: WorkerDeps, job: Job): Promise<void> {
  const [m] = await deps.db
    .select()
    .from(materials)
    .where(eq(materials.id, job.materialId));
  if (!m || m.deletedAt) return;
  const original = join(deps.storageDir, m.storagePath);

  if (job.type === 'convert') {
    const rel = previewRelPath(m.sha256);
    const preview = join(deps.storageDir, rel);
    if (!(await exists(preview))) {
      await convertToPdf(original, preview, {
        timeoutMs: CONVERT_TIMEOUT_MS,
        bin: deps.sofficeBin,
      });
    }
    await deps.db
      .update(materials)
      .set({ previewPath: rel })
      .where(eq(materials.id, m.id));
    // Queue the sibling before the caller completes this job, so finalize
    // does not mark the material ready too early.
    await enqueueJob(deps.db, m.id, 'extract_text');
    return;
  }

  let text: string;
  const pdfOpts = { timeoutMs: EXTRACT_TIMEOUT_MS, bin: deps.pdftotextBin };
  if (m.previewKind === 'pdf' && m.previewPath) {
    text = await extractPdfText(join(deps.storageDir, m.previewPath), pdfOpts);
  } else if (m.previewKind === 'pdf') {
    text = await extractPdfText(original, pdfOpts);
  } else if (m.previewKind === 'text') {
    text = await readTextFile(original);
  } else {
    throw new Error(`no text source for preview_kind=${m.previewKind}`);
  }
  await deps.db
    .update(materials)
    .set({ extractedText: truncateUtf8(text, MAX_TEXT_BYTES) })
    .where(eq(materials.id, m.id));
}

/** Claims and runs one job. Returns whether a job was claimed. */
export async function processOne(deps: WorkerDeps): Promise<boolean> {
  const now = deps.now ?? (() => new Date());
  const job = await claimJob(deps.db, now());
  if (!job) return false;
  const started = Date.now();
  try {
    await runJob(deps, job);
    if (await completeJob(deps.db, job)) {
      console.log(
        `Worker: przetworzono job ${job.id} (${job.type}) w ${Date.now() - started} ms`,
      );
    } else {
      console.info(
        `Worker: job ${job.id} (${job.type}) przejęty przez inny worker`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Worker: błąd job ${job.id} (${job.type}): ${message}`);
    const outcome = await failJob(deps.db, job, err, now());
    if (outcome === 'lost') {
      console.info(
        `Worker: job ${job.id} (${job.type}) przejęty przez inny worker`,
      );
    }
  }
  return true;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

export async function startWorker(
  deps: WorkerDeps,
  opts: { concurrency: number; pollMs: number; signal: AbortSignal },
): Promise<void> {
  const { signal } = opts;
  const now = deps.now ?? (() => new Date());

  const loop = async () => {
    while (!signal.aborted) {
      let worked = false;
      try {
        worked = await processOne(deps);
      } catch (err) {
        console.error('Worker: błąd pętli:', err);
      }
      if (!worked) await sleep(opts.pollMs, signal);
    }
  };

  const requeue = async () => {
    while (!signal.aborted) {
      try {
        const n = await requeueStale(deps.db, now());
        if (n > 0) console.log(`Worker: wznowiono ${n} zawieszonych jobów`);
      } catch (err) {
        console.error('Worker: błąd requeueStale:', err);
      }
      await sleep(REQUEUE_EVERY_MS, signal);
    }
  };

  await Promise.all([
    requeue(),
    ...Array.from({ length: Math.max(1, opts.concurrency) }, loop),
  ]);
}
