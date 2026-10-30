'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { createRefreshLoop } from '@/lib/refresh-loop';

/**
 * Re-renders the page from the server while `active`: after 3, 6, 12, then
 * every 30 s; paused while the tab is hidden and restarted when it shows.
 */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const loop = createRefreshLoop({
      refresh: () => router.refresh(),
      isHidden: () => document.hidden,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    });
    const onVisibility = () => loop.visibilityChanged();
    document.addEventListener('visibilitychange', onVisibility);
    loop.start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      loop.stop();
    };
  }, [active, router]);
  return null;
}
