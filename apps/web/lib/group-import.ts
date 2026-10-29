import { IMPORT_MAX_BYTES } from '@studies/db';
import { createRateLimiter } from './rate-limit';

export const FILE_TOO_LARGE = 'The file is too large (max 2 MB).';
export const NOTHING_TO_IMPORT = 'Paste a UniTime link or choose a .ics file.';
export const TOO_MANY_IMPORTS = 'Too many imports. Try again in a few minutes.';
export const IMPORT_FAILED = 'Could not read the calendar.';

/** Previews (links and uploads) per user: 6 per 10 minutes. */
export const groupImportLimiter = createRateLimiter(6, 10 * 60_000);

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
