import { readFile } from 'node:fs/promises';
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

export async function readTextFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
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
