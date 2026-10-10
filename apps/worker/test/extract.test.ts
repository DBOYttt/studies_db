import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractPdfText, readTextFile, truncateUtf8 } from '../src/extract.js';

const fx = (n: string) =>
  fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));

describe('extract', () => {
  it('extracts pdf text', async () => {
    expect(await extractPdfText(fx('sample.pdf'))).toContain(
      'Przemysł 4.0 sterownik',
    );
  }, 30_000);

  it('readTextFile does not throw on cp1250', async () => {
    expect(typeof (await readTextFile(fx('cp1250.txt')))).toBe('string');
  });

  it('readTextFile reads at most 4 MiB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rt-'));
    try {
      const f = join(dir, 'big.txt');
      await writeFile(f, 'a'.repeat(6 * 1024 * 1024));
      const t = await readTextFile(f);
      expect(Buffer.byteLength(t)).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(t.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('truncateUtf8 respects char boundaries', () => {
    expect(truncateUtf8('ż'.repeat(10), 5)).toBe('żż');
    expect(truncateUtf8('abc', 10)).toBe('abc');
    const big = truncateUtf8('ą'.repeat(1_000_000), 1_048_576);
    expect(Buffer.byteLength(big)).toBeLessThanOrEqual(1_048_576);
    expect(big).not.toContain('�');
  });
});
