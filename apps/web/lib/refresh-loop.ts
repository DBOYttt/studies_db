/** Delays between refreshes of a running admin job: 3, 6, 12, then 30 s. */
export const REFRESH_DELAYS_MS = [3000, 6000, 12000, 30000] as const;

export const refreshDelay = (attempt: number): number =>
  REFRESH_DELAYS_MS[Math.min(attempt, REFRESH_DELAYS_MS.length - 1)] ?? 30000;

export type RefreshLoopEnv = {
  refresh: () => void;
  isHidden: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
};

/**
 * A back-off refresh timer. While the page is hidden nothing is scheduled;
 * `visibilityChanged()` restarts it from the first delay when the page shows
 * again (a hidden tab may have missed the result, so it is refreshed soon).
 */
export function createRefreshLoop(env: RefreshLoopEnv) {
  let timer: unknown = null;
  let attempt = 0;
  let stopped = true;
  const clear = () => {
    if (timer !== null) env.clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (stopped || env.isHidden()) return;
    timer = env.setTimer(() => {
      timer = null;
      if (env.isHidden()) return; // paused until visibilityChanged()
      env.refresh();
      attempt++;
      schedule();
    }, refreshDelay(attempt));
  };
  return {
    start() {
      stopped = false;
      attempt = 0;
      schedule();
    },
    stop() {
      stopped = true;
      clear();
    },
    visibilityChanged() {
      if (stopped) return;
      attempt = 0;
      schedule();
    },
  };
}
