import { type FileHandle, open } from 'node:fs/promises';
import { run } from './exec.js';

export const MAX_TEXT_BYTES = 1_048_576;

export async function extractPdfText(
  pdfPath: string,
  opts: { timeoutMs?: number; bin?: string } = {},
): Promise<string> {
  const { stdout } = await run(
    opts.bin ?? process.env.PDFTOTEXT_BIN ?? 'pdftotext',
    ['-enc', 'UTF-8', pdfPath, '-'],
    opts.timeoutMs ?? 30_000,
  );
  return stdout;
}

export const MAX_READ_BYTES = 4 * 1024 * 1024;

export async function readTextFile(path: string): Promise<string> {
  const fh = await open(path, 'r');
  try {
    return await readTextHandle(fh);
  } finally {
    await fh.close();
  }
}

/** Reads at most MAX_READ_BYTES from an open file as (lossy) UTF-8. */
export async function readTextHandle(fh: FileHandle): Promise<string> {
  const buf = Buffer.alloc(MAX_READ_BYTES);
  let total = 0;
  while (total < MAX_READ_BYTES) {
    const { bytesRead } = await fh.read(
      buf,
      total,
      MAX_READ_BYTES - total,
      total,
    );
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(
    buf.subarray(0, total),
  );
}

export function truncateUtf8(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s) <= maxBytes) return s;
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = Buffer.byteLength(ch);
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return out;
}
