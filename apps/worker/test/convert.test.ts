import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertToPdf } from '../src/convert.js';
import { extractPdfText } from '../src/extract.js';
import { wrapBin } from './wrap-bin.js';

const fx = (n: string) =>
  fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'conv-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('convertToPdf', () => {
  it('converts docx to pdf and text is extractable', async () => {
    const out = join(dir, 'nested', 'a.pdf');
    await convertToPdf(fx('sample.docx'), out);
    expect((await readFile(out)).subarray(0, 4).toString()).toBe('%PDF');
    expect(await extractPdfText(out)).toContain('sterownik');
  }, 60_000);

  it('converts pptx to pdf', async () => {
    const out = join(dir, 'b.pdf');
    await convertToPdf(fx('sample.pptx'), out);
    expect((await readFile(out)).subarray(0, 4).toString()).toBe('%PDF');
  }, 60_000);

  it('rejects on corrupt input', async () => {
    await expect(
      convertToPdf(fx('corrupt.docx'), join(dir, 'c.pdf')),
    ).rejects.toThrow();
  }, 60_000);

  it('kills the whole process tree and rejects on timeout', async () => {
    const pidFile = join(dir, 'grandchild.pid');
    const bin = await wrapBin(dir, fx('fake-soffice.sh'), {
      FAKE_PIDFILE: pidFile,
    });
    const t = Date.now();
    await expect(
      convertToPdf(fx('sample.docx'), join(dir, 'd.pdf'), {
        bin,
        // Room for macOS to scan the freshly written wrapper on first exec.
        timeoutMs: 1500,
      }),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - t).toBeLessThan(2500);
    const childPid = Number((await readFile(pidFile, 'utf8')).trim());
    expect(childPid).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(childPid, 0)).toThrow(/ESRCH/);
  });
});
