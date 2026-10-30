import { randomBytes } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './exec.js';
import { writeHardenedProfile } from './soffice-profile.js';

/** A larger produced PDF fails the job and never reaches previews/. */
export const MAX_PREVIEW_BYTES = 200 * 1024 * 1024;

export async function convertToPdf(
  inputPath: string,
  outputPath: string,
  opts: { timeoutMs?: number; bin?: string; maxPreviewBytes?: number } = {},
): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'soffice-'));
  try {
    const ext = extname(inputPath)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '');
    const safeInput = join(tmp, `input${ext}`);
    await copyFile(inputPath, safeInput);
    const outDir = join(tmp, 'out');
    await mkdir(outDir);
    // A fresh profile per run, seeded so linked content is never updated
    // and macros never run.
    const profile = join(tmp, 'profile');
    await writeHardenedProfile(profile);
    await run(
      opts.bin ?? process.env.SOFFICE_BIN ?? 'soffice',
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        safeInput,
      ],
      opts.timeoutMs ?? 120_000,
      { home: tmp },
    );
    const produced = join(outDir, 'input.pdf');
    if (!(await readdir(outDir)).includes('input.pdf')) {
      throw new Error('soffice produced no PDF');
    }
    // Checked in the temp dir, before anything is written next to outputPath.
    if (
      (await stat(produced)).size > (opts.maxPreviewBytes ?? MAX_PREVIEW_BYTES)
    ) {
      await rm(produced, { force: true });
      throw new Error('Preview too large.');
    }
    await mkdir(dirname(outputPath), { recursive: true });
    const staged = `${outputPath}.tmp-${randomBytes(6).toString('hex')}`;
    try {
      await rename(produced, staged);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
      try {
        await copyFile(produced, staged);
        await unlink(produced);
      } catch (e2) {
        await rm(staged, { force: true });
        throw e2;
      }
    }
    try {
      await rename(staged, outputPath);
    } catch (e) {
      await rm(staged, { force: true });
      throw e;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
