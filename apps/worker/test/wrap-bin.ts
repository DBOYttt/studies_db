import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

let n = 0;

/**
 * The tools run with a minimal environment (see `childEnv`), so a test double
 * can't read settings from `process.env`: this writes a wrapper script in
 * `dir` that sets `env` and execs `target`.
 */
export async function wrapBin(
  dir: string,
  target: string,
  env: Record<string, string>,
): Promise<string> {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const path = join(dir, `wrap-${++n}.sh`);
  const exports = Object.entries(env)
    .map(([k, v]) => `export ${k}=${q(v)}`)
    .join('\n');
  await writeFile(path, `#!/bin/sh\n${exports}\nexec ${q(target)} "$@"\n`);
  await chmod(path, 0o755);
  return path;
}
