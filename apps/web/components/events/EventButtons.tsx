'use client';

import {
  ArrowCounterClockwise,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteEventAction, restoreEventAction } from '@/lib/event-actions';

const btn =
  'inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-panel px-3 text-accent-ink hover:border-accent disabled:opacity-60';

/** Edytuj / Usuń (two steps) for a live event, Przywróć for a deleted one. */
export function EventButtons({
  id,
  base,
  editHref,
  deleted,
  inSeries = false,
}: {
  id: number;
  base: 'simple' | 'advanced';
  editHref: string;
  deleted: boolean;
  inSeries?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (
    fn: () => Promise<{ ok: boolean; message: string } | undefined>,
  ) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r && !r.ok) setError(r.message);
      else if (r) router.refresh();
    });

  if (deleted) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={pending}
          className={`${btn} self-start`}
          onClick={() => run(() => restoreEventAction(id))}
        >
          <ArrowCounterClockwise size={15} aria-hidden />
          Przywróć
        </button>
        {error && (
          <span role="alert" className="text-err-fg">
            {error}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={editHref} className={btn}>
          <PencilSimple size={15} aria-hidden />
          Edytuj
        </Link>
        {confirming ? (
          <>
            <span className="text-muted">Usunąć to wydarzenie?</span>
            {inSeries ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  className={`${btn} border-err-fg text-err-fg`}
                  onClick={() => run(() => deleteEventAction(id, base, 'one'))}
                >
                  Tylko to
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className={`${btn} border-err-fg text-err-fg`}
                  onClick={() =>
                    run(() => deleteEventAction(id, base, 'following'))
                  }
                >
                  To i następne
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={pending}
                className={`${btn} border-err-fg text-err-fg`}
                onClick={() => run(() => deleteEventAction(id, base))}
              >
                Tak, usuń
              </button>
            )}
            <button
              type="button"
              className={btn}
              onClick={() => setConfirming(false)}
            >
              Anuluj
            </button>
          </>
        ) : (
          <button
            type="button"
            className={btn}
            onClick={() => setConfirming(true)}
          >
            <Trash size={15} aria-hidden />
            Usuń
          </button>
        )}
      </div>
      {error && (
        <span role="alert" className="text-err-fg">
          {error}
        </span>
      )}
    </div>
  );
}
