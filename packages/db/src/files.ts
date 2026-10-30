import { constants } from 'node:fs';
import { type FileHandle, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldStroke } from './text.js';

export type PreviewKind = 'pdf' | 'image' | 'text' | 'none';
export type JobType = 'convert' | 'extract_text';

const OFFICE_EXTS = new Set([
  'doc',
  'docx',
  'odt',
  'rtf',
  'ppt',
  'pptx',
  'odp',
  'xls',
  'xlsx',
  'ods',
]);
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'c',
  'h',
  'cpp',
  'hpp',
  'py',
  'js',
  'ts',
  'java',
  'm',
  'tex',
  'log',
  'ini',
]);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

export function fileExtension(filename: string): string {
  const base = filename.slice(
    Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1,
  );
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

/**
 * Filename with `_`, `-`, `.` turned into spaces so FULLTEXT can tokenize it,
 * and `ł` folded (foldStroke) like the other diacritics.
 */
export function searchNameFor(filename: string): string {
  return foldStroke(filename)
    .replace(/[_.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function planProcessing(
  filename: string,
  mime: string,
): { previewKind: PreviewKind; jobs: JobType[] } {
  const ext = fileExtension(filename);
  mime = mime.split(';')[0].trim().toLowerCase();

  if (ext === 'pdf' || mime === 'application/pdf') {
    return { previewKind: 'pdf', jobs: ['extract_text'] };
  }
  if (OFFICE_EXTS.has(ext)) {
    return { previewKind: 'pdf', jobs: ['convert'] };
  }
  if (
    TEXT_EXTS.has(ext) ||
    (!IMAGE_EXTS.has(ext) && mime.startsWith('text/'))
  ) {
    return { previewKind: 'text', jobs: ['extract_text'] };
  }
  if (IMAGE_EXTS.has(ext) || mime.startsWith('image/')) {
    return { previewKind: 'image', jobs: [] };
  }
  return { previewKind: 'none', jobs: [] };
}

/**
 * A stored file path that would leave STORAGE_DIR (or is built from a
 * malformed sha256). The message is deliberately generic: it ends up in
 * `jobs.last_error`, which the admin console can read.
 */
export class StoragePathError extends Error {
  constructor() {
    super('Invalid file path');
    this.name = 'StoragePathError';
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;

function checkSha256(sha256: string): string {
  if (!SHA256_RE.test(sha256)) throw new StoragePathError();
  return sha256;
}

export function originalRelPath(sha256: string, ext: string): string {
  checkSha256(sha256);
  return ext === '' ? `originals/${sha256}` : `originals/${sha256}.${ext}`;
}

export function previewRelPath(sha256: string): string {
  return `previews/${checkSha256(sha256)}.pdf`;
}

/**
 * Resolves a storage-relative path (as stored in `materials`) against the
 * storage root; throws StoragePathError if the result is not strictly inside
 * it. Paths in the DB are not trusted: the admin SQL console can write rows.
 */
export function resolveInStorage(root: string, rel: string): string {
  const base = resolve(root);
  const abs = resolve(base, rel);
  if (!abs.startsWith(base + sep)) throw new StoragePathError();
  return abs;
}

/**
 * A stored file that may not be read: outside STORAGE_DIR (also through a
 * symlinked directory), a symlink itself, not a regular file, or missing.
 * Callers answer it as "not found". The message never echoes the path.
 */
export class StorageAccessError extends Error {
  constructor() {
    super('File not available');
    this.name = 'StorageAccessError';
  }
}

// O_NOFOLLOW: a symlink as the last component fails the open (ELOOP).
// O_NONBLOCK: opening a FIFO must not wait for a writer; it is refused by
// the fstat check below, and has no effect on reads of a regular file.
const OPEN_FLAGS =
  constants.O_RDONLY |
  (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);

/**
 * Opens a storage-relative path for reading, refusing anything that is not a
 * regular file really inside the storage root: the path is resolved with
 * resolveInStorage, its realpath must stay under the root's realpath (so a
 * symlinked directory such as `uploads -> /etc` is refused), the open does not
 * follow a symlink, and fstat must report a regular file. The caller owns the
 * handle (close it, or stream with `handle.createReadStream()`, which closes
 * it at the end). Throws StorageAccessError otherwise.
 */
export async function openInStorage(
  root: string,
  rel: string,
): Promise<{ handle: FileHandle; size: number }> {
  let abs: string;
  let realRoot: string;
  let realAbs: string;
  try {
    abs = resolveInStorage(root, rel);
    realRoot = await realpath(resolve(root));
    realAbs = await realpath(abs);
  } catch {
    throw new StorageAccessError();
  }
  if (!realAbs.startsWith(realRoot + sep)) throw new StorageAccessError();
  let handle: FileHandle;
  try {
    handle = await open(abs, OPEN_FLAGS);
  } catch {
    throw new StorageAccessError();
  }
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw new StorageAccessError();
    return { handle, size: st.size };
  } catch {
    await handle.close().catch(() => {});
    throw new StorageAccessError();
  }
}

/** Absolute paths pass through; relative ones resolve against the monorepo root. */
export function resolveStorageDir(dir: string): string {
  if (isAbsolute(dir)) return dir;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `STORAGE_DIR must be an absolute path in production (got "${dir}"), e.g. /data/storage`,
    );
  }
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  return resolve(root, dir);
}
