export interface RateLimiter {
  /** Records a hit and returns true if allowed; false (not recorded) if over the limit. */
  check(key: string, now?: number): boolean;
}

/** In-memory sliding-window log limiter (single process). */
export function createRateLimiter(
  limit: number,
  windowMs: number,
): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  function prune(list: number[], now: number): number[] {
    let i = 0;
    while (i < list.length && list[i] <= now - windowMs) i++;
    return i === 0 ? list : list.slice(i);
  }

  return {
    check(key, now = Date.now()) {
      // Occasionally drop idle keys so the map can't grow without bound.
      if (now - lastSweep > windowMs) {
        lastSweep = now;
        for (const [k, list] of hits) {
          const kept = prune(list, now);
          if (kept.length === 0) hits.delete(k);
          else hits.set(k, kept);
        }
      }
      const list = prune(hits.get(key) ?? [], now);
      if (list.length >= limit) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      return true;
    },
  };
}
