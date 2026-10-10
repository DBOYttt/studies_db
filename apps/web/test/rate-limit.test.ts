import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../lib/rate-limit';

describe('createRateLimiter', () => {
  it('allows `limit` hits per window, then blocks, then recovers', () => {
    const rl = createRateLimiter(30, 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(rl.check('u1', t0 + i)).toBe(true);
    expect(rl.check('u1', t0 + 30)).toBe(false);
    // other keys are independent
    expect(rl.check('u2', t0 + 30)).toBe(true);
    // still blocked just before the first hit leaves the window
    expect(rl.check('u1', t0 + 59_999)).toBe(false);
    // sliding: the first hit expires, one slot frees up
    expect(rl.check('u1', t0 + 60_000)).toBe(true);
    expect(rl.check('u1', t0 + 60_000)).toBe(false);
    // whole window later: fully allowed again
    for (let i = 0; i < 30; i++) {
      expect(rl.check('u1', t0 + 200_000 + i)).toBe(true);
    }
  });

  it('rejected hits do not extend the block', () => {
    const rl = createRateLimiter(1, 1000);
    expect(rl.check('k', 0)).toBe(true);
    for (let t = 1; t < 1000; t += 100) expect(rl.check('k', t)).toBe(false);
    expect(rl.check('k', 1000)).toBe(true);
  });
});
