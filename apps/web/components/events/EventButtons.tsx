'use client';

import {
  ArrowCounterClockwise,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { deleteEventAction, restoreEventAction } from '@/lib/event-actions';

const btn =
  'inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-panel px-3 text-accent-ink hover:border-accent disabled:opacity-60';

/**
 * Edit / Delete (two steps) for a live event, Restore for a deleted one.
 * Delete and Restore redirect with a notice; only a refusal comes back.
 * The delete question is a disclosure under Delete: Cancel or Escape closes
 * it and puts focus back on Delete.
 */
export function EventButtons({
  id,
  base,
  editHref,
  deleted,
  inSeries = false,
  version,
}: {
  id: number;
  base: 'simple' | 'advanced';
  editHref: string;
  deleted: boolean;
  inSeries?: boolean;
  /** Row version when the page was rendered; a stale delete is refused. */
  version?: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const cancel = () => {
    setConfirming(false);
    deleteRef.current?.focus();
  };
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
          onClick={() => run(() => restoreEventAction(id, base))}
        >
          <ArrowCounterClockwise size={15} aria-hidden />
          Restore
        </button>
        {error && (
          <span role="alert" className="text-err-fg">
            {error}
          </span>
        )}
      </div>
    );
  }
  const danger = `${btn} border-err-fg text-err-fg`;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape from the buttons inside
    <div
      className="flex flex-col gap-1.5"
      onKeyDown={(e) => {
        if (confirming && e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link href={editHref} className={btn}>
          <PencilSimple size={15} aria-hidden />
          Edit
        </Link>
        <button
          ref={deleteRef}
          type="button"
          className={btn}
          aria-expanded={confirming}
          aria-controls={confirming ? questionId : undefined}
          onClick={() => setConfirming(true)}
        >
          <Trash size={15} aria-hidden />
          Delete
        </button>
      </div>
      {/* The question gets its own row, so the buttons above never move. */}
      {confirming && (
        <fieldset
          id={questionId}
          aria-label="Delete this event?"
          className="m-0 flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-err-line bg-err-bg px-3 py-2"
        >
          <span className="w-full font-semibold text-err-fg sm:w-auto">
            Delete this event?
          </span>
          {inSeries ? (
            <>
              <button
                type="button"
                disabled={pending}
                className={danger}
                onClick={() =>
                  run(() => deleteEventAction(id, base, 'one', version))
                }
              >
                Only this one
              </button>
              <button
                type="button"
                disabled={pending}
                className={danger}
                onClick={() =>
                  run(() => deleteEventAction(id, base, 'following', version))
                }
              >
                This and following
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              className={danger}
              onClick={() =>
                run(() => deleteEventAction(id, base, 'one', version))
              }
            >
              Yes, delete
            </button>
          )}
          <button type="button" className={btn} onClick={cancel}>
            Cancel
          </button>
        </fieldset>
      )}
      {error && (
        <span role="alert" className="text-err-fg">
          {error}
        </span>
      )}
    </div>
  );
}
