import { spawn } from 'node:child_process';

const MAX_BUFFER = 64 * 1024 * 1024;

export function run(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    // detached => child leads its own process group, so the whole tree can be killed.
    const child = spawn(bin, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;

    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
    };
    const stderrText = () =>
      Buffer.concat(err).toString('utf8').trim().slice(0, 2000);
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup();
      const detail = stderrText();
      reject(new Error(`${bin} ${msg}${detail ? `\n${detail}` : ''}`));
    };

    const timer = setTimeout(
      () => fail(`timed out after ${timeoutMs}ms`),
      timeoutMs,
    );

    child.stdout.on('data', (b: Buffer) => {
      outBytes += b.length;
      if (outBytes > MAX_BUFFER) return fail('stdout exceeded maxBuffer');
      out.push(b);
    });
    child.stderr.on('data', (b: Buffer) => {
      if (errBytes < MAX_BUFFER) {
        errBytes += b.length;
        err.push(b);
      }
    });
    child.on('error', (e) => fail(`failed: ${e.message}`));
    child.on('close', (code, signal) => {
      if (settled) return;
      if (code === 0) {
        settled = true;
        clearTimeout(timer);
        killGroup(); // reap any stragglers left in the group
        resolve({ stdout: Buffer.concat(out).toString('utf8') });
      } else {
        fail(`failed (${signal ? `signal ${signal}` : `exit code ${code}`})`);
      }
    });
  });
}
