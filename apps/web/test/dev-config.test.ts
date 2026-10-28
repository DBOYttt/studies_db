import { describe, expect, it } from 'vitest';
import { onDemandEntriesFromEnv } from '../lib/dev-config';

describe('onDemandEntriesFromEnv', () => {
  it('is unset without the env (Next defaults)', () => {
    expect(onDemandEntriesFromEnv({ NODE_ENV: 'development' })).toBeUndefined();
  });
  it('reads the buffer and max age in dev', () => {
    expect(
      onDemandEntriesFromEnv({
        NODE_ENV: 'development',
        NEXT_DEV_PAGES_BUFFER: '25',
        NEXT_DEV_MAX_INACTIVE_MS: '600000',
      }),
    ).toEqual({ pagesBufferLength: 25, maxInactiveAge: 600_000 });
    expect(onDemandEntriesFromEnv({ NEXT_DEV_PAGES_BUFFER: '10' })).toEqual({
      pagesBufferLength: 10,
    });
  });
  it('ignores it in production and drops invalid values', () => {
    expect(
      onDemandEntriesFromEnv({
        NODE_ENV: 'production',
        NEXT_DEV_PAGES_BUFFER: '25',
      }),
    ).toBeUndefined();
    expect(
      onDemandEntriesFromEnv({
        NEXT_DEV_PAGES_BUFFER: 'x',
        NEXT_DEV_MAX_INACTIVE_MS: '-1',
      }),
    ).toBeUndefined();
  });
});
