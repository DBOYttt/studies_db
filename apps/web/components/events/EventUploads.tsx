'use client';

import { UploadSimple } from '@phosphor-icons/react';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
} from '@studies/db/constants';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { retryUploadsAction } from '@/lib/event-actions';

export type UploadItem = {
  id: number;
  name: string;
  status: 'queued' | 'posting' | 'done' | 'failed';
  error: string | null;
};

const POLL_MS = 3000;
const LABEL: Record<UploadItem['status'], string> = {
  queued: 'sending…',
  posting: 'sending…',
  done: 'done',
  failed: 'failed',
};

const btn =
  'inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-panel px-3 text-accent-ink hover:border-accent disabled:opacity-60';

/** "Add files" (one control: picking files sends them) plus the status of the event's recent uploads. */
export function EventUploads({
  eventId,
  initial,
  canRetry,
}: {
  eventId: number;
  initial: UploadItem[];
  canRetry: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read synchronously by send(): a pick in the same tick as the first one
  // must not see a stale `busy`.
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const url = `/api/wydarzenia/${eventId}/pliki`;
  const active = items.some(
    (i) => i.status === 'queued' || i.status === 'posting',
  );

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { uploads: UploadItem[] };
        setItems(body.uploads);
      } catch {
        // Offline for a moment: try again on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, url]);

  async function retry() {
    setError(null);
    setBusy(true);
    try {
      const r = await retryUploadsAction(eventId);
      if (!r.ok) return setError(r.message);
      setItems((cur) =>
        cur.map((i) =>
          i.status === 'failed' ? { ...i, status: 'queued', error: null } : i,
        ),
      );
      router.refresh();
    } catch {
      setError('Could not retry sending.');
    } finally {
      setBusy(false);
    }
  }

  // One control: choosing files sends them straight away.
  async function send() {
    const files = Array.from(input.current?.files ?? []);
    // Cleared at once, so choosing the same file again (after a refusal)
    // still fires a change.
    if (input.current) input.current.value = '';
    // aria-disabled (not disabled) keeps focus on the input while sending,
    // so a pick made meanwhile is ignored here.
    if (busy || sending.current) return;
    setError(null);
    if (files.length === 0) return;
    if (files.length > MAX_UPLOAD_FILES) {
      return setError(
        `You can send at most ${MAX_UPLOAD_FILES} files at once.`,
      );
    }
    if (files.some((f) => f.size > MAX_UPLOAD_BYTES)) {
      return setError(
        `A file is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`,
      );
    }
    if (files.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_TOTAL_BYTES) {
      return setError(
        `Max ${MAX_UPLOAD_TOTAL_BYTES / 1024 / 1024} MB in total at once.`,
      );
    }
    const form = new FormData();
    for (const f of files) form.append('files', f);
    sending.current = true;
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not send the files.');
        return;
      }
      const added = (body.uploads as { id: number; name: string }[]).map(
        (u): UploadItem => ({ ...u, status: 'queued', error: null }),
      );
      setItems((cur) => [...added.reverse(), ...cur]);
    } catch {
      setError('Could not send the files.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-2">
      <label
        className={`${btn} self-start cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
          busy ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        <UploadSimple size={15} aria-hidden />
        {busy ? 'Sending…' : 'Add files'}
        <input
          ref={input}
          type="file"
          name="files"
          multiple
          aria-disabled={busy}
          onChange={send}
          className="sr-only"
        />
      </label>
      <p className="m-0 text-xs text-faint">
        Up to {MAX_UPLOAD_FILES} files, each up to{' '}
        {MAX_UPLOAD_BYTES / 1024 / 1024} MB,{' '}
        {MAX_UPLOAD_TOTAL_BYTES / 1024 / 1024} MB in total. They go to the
        event's thread on Discord.
      </p>
      {error && (
        <span role="alert" className="text-err-fg">
          {error}
        </span>
      )}
      {canRetry && items.some((i) => i.status === 'failed') && (
        <button type="button" onClick={retry} disabled={busy} className={btn}>
          Try again
        </button>
      )}
      {items.length > 0 && (
        <ul
          aria-live="polite"
          className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-lg border border-line-strong p-0"
        >
          {items.map((u) => (
            <li key={u.id} className="bg-panel px-3.5 py-2">
              <span className="break-all">{u.name}</span>{' '}
              <span
                className={u.status === 'failed' ? 'text-err-fg' : 'text-muted'}
              >
                · {LABEL[u.status]}
              </span>
              {u.status === 'failed' && u.error && (
                <div className="text-xs text-err-fg">{u.error}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
