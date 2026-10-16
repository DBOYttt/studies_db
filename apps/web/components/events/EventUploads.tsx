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
  queued: 'wysyłanie…',
  posting: 'wysyłanie…',
  done: 'gotowe',
  failed: 'błąd',
};

const btn =
  'inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-panel px-3 text-accent-ink hover:border-accent disabled:opacity-60';

/** "Dodaj pliki" plus the status of the event's recent uploads. */
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
      setError('Nie udało się ponowić wysyłania.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const files = Array.from(input.current?.files ?? []);
    setError(null);
    if (files.length === 0) return setError('Nie wybrano plików.');
    if (files.length > MAX_UPLOAD_FILES) {
      return setError(
        `Możesz wysłać najwyżej ${MAX_UPLOAD_FILES} plików naraz.`,
      );
    }
    if (files.some((f) => f.size > MAX_UPLOAD_BYTES)) {
      return setError(
        `Plik jest za duży (maks. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`,
      );
    }
    if (files.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_TOTAL_BYTES) {
      return setError(
        `Łącznie maks. ${MAX_UPLOAD_TOTAL_BYTES / 1024 / 1024} MB na raz.`,
      );
    }
    const form = new FormData();
    for (const f of files) form.append('files', f);
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Nie udało się wysłać plików.');
        return;
      }
      const added = (body.uploads as { id: number; name: string }[]).map(
        (u): UploadItem => ({ ...u, status: 'queued', error: null }),
      );
      setItems((cur) => [...added.reverse(), ...cur]);
      if (input.current) input.current.value = '';
    } catch {
      setError('Nie udało się wysłać plików.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-2">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          name="files"
          multiple
          aria-label="Pliki do dodania"
          className="max-w-full text-[13px]"
        />
        <button type="submit" disabled={busy} className={btn}>
          <UploadSimple size={15} aria-hidden />
          Dodaj pliki
        </button>
      </form>
      <p className="m-0 text-xs text-faint">
        Do {MAX_UPLOAD_FILES} plików, każdy do {MAX_UPLOAD_BYTES / 1024 / 1024}{' '}
        MB, łącznie do {MAX_UPLOAD_TOTAL_BYTES / 1024 / 1024} MB. Trafią do
        wątku wydarzenia na Discordzie.
      </p>
      {error && (
        <span role="alert" className="text-err-fg">
          {error}
        </span>
      )}
      {canRetry && items.some((i) => i.status === 'failed') && (
        <button type="button" onClick={retry} disabled={busy} className={btn}>
          Spróbuj ponownie
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
