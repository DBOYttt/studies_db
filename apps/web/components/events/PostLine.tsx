'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { retryPostAction } from '@/lib/event-actions';

const btn =
  'inline-flex h-7 items-center rounded border border-line-strong bg-panel px-2.5 text-[13px] text-accent-ink hover:border-accent disabled:opacity-60';

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
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setError(null);
    setBusy(true);
    try {
      const r = await retryPostAction(eventId);
      if (!r.ok) return setError(r.message);
      router.refresh();
    } catch {
      setError('Could not retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="m-0 text-muted">{text}</p>
      {canRetry && (
        <button type="button" onClick={retry} disabled={busy} className={btn}>
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
