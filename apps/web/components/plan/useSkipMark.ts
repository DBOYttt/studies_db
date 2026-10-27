'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { skipMarkAction, unskipMarkAction } from '@/lib/class-mark-actions';
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
  const { run, pending, error, setError } = useMarkDateAction(
    skipMarkAction,
    markId,
    onDate,
    onDone,
  );
  return { skip: run, pending, error, setError };
}

/** "Undo" of a skip in the session panel: the same flow, unskipping. */
export function useUndoSkip(
  markId: number,
  onDate: string,
  onDone?: () => void,
) {
  const { run, pending, error } = useMarkDateAction(
    unskipMarkAction,
    markId,
    onDate,
    onDone,
  );
  return { undo: run, pending, error };
}

function useMarkDateAction(
  action: typeof skipMarkAction,
  markId: number,
  onDate: string,
  onDone?: () => void,
) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(() => {
    if (pending) return;
    start(async () => {
      setError(null);
      const err = await markActionError(() => action(markId, onDate));
      if (err) {
        setError(err);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }, [pending, action, markId, onDate, onDone, router]);
  return { run, pending, error, setError };
}
