'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { skipMarkAction } from '@/lib/class-mark-actions';
import { markActionError } from '@/lib/plan-view';

/**
 * "Not this week" for an entry quiz, shared by the badge popover and the
 * session panel: runs the action, keeps the error text, refreshes the page
 * on success (after `onDone`, e.g. to move focus off the vanishing control).
 */
export function useSkipMark(
  markId: number,
  onDate: string,
  onDone?: () => void,
) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const skip = useCallback(() => {
    if (pending) return;
    start(async () => {
      setError(null);
      const err = await markActionError(() => skipMarkAction(markId, onDate));
      if (err) {
        setError(err);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }, [pending, markId, onDate, onDone, router]);
  return { skip, pending, error, setError };
}
