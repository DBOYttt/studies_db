import { useEffect, useRef, useState } from 'react';

/** How long a preview may load before it offers the download instead. */
export const PREVIEW_TIMEOUT_MS = 15_000;

export type PreviewStatus = 'loading' | 'shown' | 'failed';

export type PreviewWatchdogEnv = {
  onFail: () => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
};

/**
 * Gives a loading preview `timeoutMs` to show its first render. A load error
 * or the timeout fails it (once); after the first render nothing fails it.
 */
export function createPreviewWatchdog(
  env: PreviewWatchdogEnv,
  timeoutMs = PREVIEW_TIMEOUT_MS,
) {
  let status: PreviewStatus = 'loading';
  let timer: unknown = null;
  const clear = () => {
    if (timer !== null) env.clearTimer(timer);
    timer = null;
  };
  const fail = () => {
    if (status !== 'loading') return;
    clear();
    status = 'failed';
    env.onFail();
  };
  return {
    status: () => status,
    start() {
      clear();
      if (status === 'loading') timer = env.setTimer(fail, timeoutMs);
    },
    rendered() {
      if (status !== 'loading') return;
      clear();
      status = 'shown';
    },
    failed: fail,
    stop: clear,
  };
}

/**
 * The watchdog for one preview (`key`: its URL; null while none is shown).
 * Returns whether it failed, and the callbacks the viewer calls on its first
 * render and on a load error.
 * The watchdog is made on first use, so a render reported before this
 * component's effect ran (a cached image) still counts.
 */
export function usePreviewWatchdog(key: string | null) {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const ref = useRef<{
    key: string;
    dog: ReturnType<typeof createPreviewWatchdog>;
  } | null>(null);
  const get = (key: string) => {
    if (ref.current?.key !== key) {
      ref.current?.dog.stop();
      const dog = createPreviewWatchdog({
        onFail: () => setFailedKey(key),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      });
      ref.current = { key, dog };
    }
    return ref.current.dog;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `get` only reads the ref
  useEffect(() => {
    if (key === null) return;
    const dog = get(key);
    dog.start();
    return () => dog.stop();
  }, [key]);
  return {
    failed: key !== null && failedKey === key,
    rendered: () => key !== null && get(key).rendered(),
    onError: () => key !== null && get(key).failed(),
  };
}
