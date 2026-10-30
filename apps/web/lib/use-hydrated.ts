import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False on the server and in the first client render, true after
 * hydration. Lets a client-handled form keep its submit disabled until the
 * handler is attached.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
