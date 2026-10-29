'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { retryPostAction } from '@/lib/event-actions';

const btn =
  'inline-flex h-7 items-center rounded border border-line-strong bg-panel px-2.5 text-[13px] text-accent-ink hover:border-accent';

/** "Discord post: …", with "Try again" when it failed or is missing. */
export function PostLine({
  eventId,
  text,
  canRetry,
}: {
  eventId: number;
  text: string;
  canRetry: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const retrying = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    // aria-disabled keeps focus on the button while retrying.
    if (busy || retrying.current) return;
    retrying.current = true;
    setError(null);
    setBusy(true);
    try {
      const r = await retryPostAction(eventId);
      if (!r.ok) return setError(r.message);
      router.refresh();
    } catch {
      setError('Could not retry.');
    } finally {
      retrying.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="m-0 text-muted">{text}</p>
      {canRetry && (
        <button
          type="button"
          onClick={retry}
          aria-disabled={busy}
          className={`${btn} ${busy ? 'opacity-60' : ''}`}
        >
          Try again
        </button>
      )}
      {error && (
        <span role="alert" className="text-err-fg">
          {error}
        </span>
      )}
    </div>
  );
}
