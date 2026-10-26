/**
 * A small in-process cache for one value that is expensive to compute and
 * may be a little stale (nav counts, subject-card aggregates). Concurrent
 * callers share one load; a failed load, or a value `keep` rejects, is not
 * kept. `invalidate()` makes the next `get()` load again (a load that was
 * already running then no longer updates the cache).
 */
export type TtlCache<T> = {
  get(): Promise<T>;
  invalidate(): void;
};

export function ttlCache<T>(
  ttlMs: number,
  load: () => Promise<T>,
  opts: { now?: () => number; keep?: (value: T) => boolean } = {},
): TtlCache<T> {
  const now = opts.now ?? Date.now;
  const keep = opts.keep ?? (() => true);
  let value: { v: T; at: number } | null = null;
  let inFlight: Promise<T> | null = null;
  let generation = 0;

  return {
    get() {
      if (value && now() - value.at < ttlMs) return Promise.resolve(value.v);
      if (inFlight) return inFlight;
      const gen = generation;
      const p = load().then(
        (v) => {
          if (gen === generation) {
            inFlight = null;
            if (keep(v)) value = { v, at: now() };
          }
          return v;
        },
        (err) => {
          if (gen === generation) inFlight = null;
          throw err;
        },
      );
      inFlight = p;
      return p;
    },
    invalidate() {
      generation++;
      value = null;
      inFlight = null;
    },
  };
}
