import { execFile } from 'node:child_process';

export function run(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr ?? '')
            .trim()
            .slice(0, 2000);
          const killed = (err as { killed?: boolean }).killed
            ? ` (timed out after ${timeoutMs}ms)`
            : '';
          reject(
            new Error(
              `${bin} failed${killed}: ${err.message}${detail ? `\n${detail}` : ''}`,
            ),
          );
          return;
        }
        resolve({ stdout });
      },
    );
  });
}
