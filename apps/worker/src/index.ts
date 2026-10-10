import { createDb, resolveStorageDir } from '@studies/db';
import { startWorker } from './handlers.js';
import { checkTools } from './tools.js';

const databaseUrl = process.env.DATABASE_URL;
const storageDirEnv = process.env.STORAGE_DIR;
if (!databaseUrl || !storageDirEnv) {
  console.error('Worker: brak DATABASE_URL lub STORAGE_DIR');
  process.exit(1);
}
const parsed = Number.parseInt(process.env.WORKER_CONCURRENCY ?? '', 10);
const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;

const sofficeBin = process.env.SOFFICE_BIN || 'soffice';
const pdftotextBin = process.env.PDFTOTEXT_BIN || 'pdftotext';
try {
  await checkTools({ sofficeBin, pdftotextBin });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const { db, pool } = createDb(databaseUrl);
const ac = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`Worker: ${sig}, kończę...`);
    ac.abort();
  });
}

console.log(`Worker: start (concurrency ${concurrency})`);
try {
  await startWorker(
    {
      db,
      storageDir: resolveStorageDir(storageDirEnv),
      sofficeBin,
      pdftotextBin,
    },
    { concurrency, pollMs: 3000, signal: ac.signal },
  );
} finally {
  await pool.end();
}
console.log('Worker: zatrzymany');
