import { afterEach, describe, expect, it } from 'vitest';
import { childEnv, run } from '../src/exec.js';

describe('childEnv (R7)', () => {
  it('passes only PATH, HOME, LANG and TMPDIR', () => {
    const env = childEnv(
      {
        PATH: '/usr/bin',
        LANG: 'pl_PL.UTF-8',
        TMPDIR: '/tmp/x',
        DATABASE_URL: 'mysql://u:secret@db/studies',
        UNITIME_ICAL_URL: 'https://secret',
        HOME: '/root',
      },
      '/tmp/run-1',
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/tmp/run-1',
      LANG: 'pl_PL.UTF-8',
      TMPDIR: '/tmp/x',
    });
  });

  it('defaults LANG to C.UTF-8 and leaves out unset values', () => {
    expect(childEnv({ PATH: '/bin' }, '/h')).toEqual({
      PATH: '/bin',
      HOME: '/h',
      LANG: 'C.UTF-8',
    });
  });
});

describe('run', () => {
  const saved = process.env.DATABASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  it('does not hand the worker environment to the tool', async () => {
    process.env.DATABASE_URL = 'mysql://u:secret@db/studies';
    const { stdout } = await run('/usr/bin/env', [], 5_000, {
      home: '/tmp/run-home',
    });
    expect(stdout).not.toContain('DATABASE_URL');
    expect(stdout).not.toContain('secret');
    expect(stdout).toContain('HOME=/tmp/run-home');
  });
});
