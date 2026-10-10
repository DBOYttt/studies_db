import { resolveStorageDir } from '@studies/db';

/** Absolute storage directory (R22: thin wrapper; see task-1 report). */
export function storageDir(): string {
  return resolveStorageDir(process.env.STORAGE_DIR ?? './storage');
}
