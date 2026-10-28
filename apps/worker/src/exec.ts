import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * The environment of a conversion tool: PATH, a throwaway HOME, LANG and
 * TMPDIR only. The tools read untrusted documents, so they never see the
 * worker's secrets (DATABASE_URL, feed URLs).
 */
export function childEnv(
  env: NodeJS.ProcessEnv,
  home: string,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {
    PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    LANG: env.LANG || 'C.UTF-8',
  };
  if (env.TMPDIR) out.TMPDIR = env.TMPDIR;
  return out;
}

export function run(
  bin: string,
  args: string[],
  timeoutMs: number,
  opts: { home?: string } = {},
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    // detached => child leads its own process group, so the whole tree can be killed.
    const child = spawn(bin, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv(process.env, opts.home ?? tmpdir()),
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
