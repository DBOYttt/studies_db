import { run } from './exec.js';

/** Verifies the external binaries are runnable; rejects naming the bad one. */
export async function checkTools(deps: {
  sofficeBin: string;
  pdftotextBin: string;
}): Promise<void> {
  const checks: [string, string[]][] = [
    [deps.sofficeBin, ['--version']],
    [deps.pdftotextBin, ['-v']],
  ];
  for (const [bin, args] of checks) {
    try {
      await run(bin, args, 30_000);
    } catch (e) {
      throw new Error(
        `Worker: brak narzędzia ${bin}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
