import { describe, expect, it, vi } from 'vitest';
import { ttlCache } from '../lib/ttl-cache';

function clock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('ttlCache', () => {
  it('serves the cached value until the TTL has passed', async () => {
    const c = clock();
    let n = 0;
    const load = vi.fn(async () => ++n);
    const cache = ttlCache(60_000, load, { now: c.now });
    expect(await cache.get()).toBe(1);
    c.advance(59_999);
    expect(await cache.get()).toBe(1);
    c.advance(1);
    expect(await cache.get()).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between concurrent callers', async () => {
    let resolve!: (v: number) => void;
    const load = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
    );
    const cache = ttlCache(60_000, load, { now: clock().now });
    const a = cache.get();
    const b = cache.get();
    resolve(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed load', async () => {
    const load = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(3);
    const cache = ttlCache(60_000, load, { now: clock().now });
    await expect(cache.get()).rejects.toThrow('down');
    expect(await cache.get()).toBe(3);
  });

  it('does not keep a value the keep predicate rejects', async () => {
    const load = vi
      .fn<() => Promise<number | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(5);
    const cache = ttlCache(60_000, load, {
      now: clock().now,
      keep: (v) => v !== null,
    });
    expect(await cache.get()).toBeNull();
    expect(await cache.get()).toBe(5);
    expect(await cache.get()).toBe(5);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidate makes the next get load again, also over a load in flight', async () => {
    let n = 0;
    const gates: (() => void)[] = [];
    const load = vi.fn(
      () =>
        new Promise<number>((r) => {
          const v = ++n;
          gates.push(() => r(v));
        }),
    );
    const cache = ttlCache(60_000, load, { now: clock().now });
    const first = cache.get();
    cache.invalidate();
    const second = cache.get();
    for (const g of gates) g();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    // the older load finishing must not overwrite the newer value
    expect(await cache.get()).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
