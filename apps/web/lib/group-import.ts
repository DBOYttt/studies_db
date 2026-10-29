import {
  GROUP_IMPORT_LIMIT,
  GROUP_IMPORT_WINDOW_MS,
  IMPORT_MAX_BYTES,
} from '@studies/db';
import { createRateLimiter } from './rate-limit';

export { IMPORT_FAILED, TOO_MANY_IMPORTS } from '@studies/db';

export const FILE_TOO_LARGE = 'The file is too large (max 2 MB).';
export const NOTHING_TO_IMPORT = 'Paste a UniTime link or choose a .ics file.';

/** Previews (links and uploads) per user: 6 per 10 minutes. */
export const groupImportLimiter = createRateLimiter(
  GROUP_IMPORT_LIMIT,
  GROUP_IMPORT_WINDOW_MS,
);

/**
 * Reads an uploaded calendar in memory (it is never written to disk), or
 * says why it cannot be used.
 */
export async function readIcsFile(
  file: File | null,
): Promise<string | { error: string }> {
  if (!file || file.size === 0) return { error: NOTHING_TO_IMPORT };
  if (file.size > IMPORT_MAX_BYTES) return { error: FILE_TOO_LARGE };
  return file.text();
}
