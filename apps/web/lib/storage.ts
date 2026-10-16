import { stat } from 'node:fs/promises';
import { resolveInStorage, resolveStorageDir } from '@studies/db';

/** Absolute storage directory (R22: thin wrapper; see task-1 report). */
export function storageDir(): string {
  return resolveStorageDir(process.env.STORAGE_DIR ?? './storage');
}

/** Whether the temp file of an upload (`uploads/<uuid>`) is still on disk. */
export async function uploadFileExists(rel: string): Promise<boolean> {
  try {
    return (await stat(resolveInStorage(storageDir(), rel))).isFile();
  } catch {
    return false;
  }
}
