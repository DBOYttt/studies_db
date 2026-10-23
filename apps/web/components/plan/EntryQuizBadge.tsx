'use client';

import { PencilSimple, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { createPortal } from 'react-dom';
import { skipMarkAction } from '@/lib/class-mark-actions';

const POP_W = 240;
const GAP = 4;
const EDGE = 8;

const actionBtn =
  'inline-flex h-7 items-center gap-1 rounded border border-line-strong bg-panel px-2.5 text-accent-ink hover:border-accent disabled:opacity-60';

/**
 * Entry quiz badge on a session block: a button that opens a small popover
 * with the note, "Not this week" (skips the mark on the session's date) and
 * "Edit" (the class section of the subject page). The popover is portalled
 * and fixed below the badge, so the block's clipping does not cut it off.
 * Escape or a click outside closes it and focus returns to the badge.
 */
export function EntryQuizBadge({
  markId,
  note,
  onDate,
  dateLabel,
  editHref,
  className,
}: {
  markId: number;
  note: string | null;
  /** Session date, `YYYY-MM-DD`. */
  onDate: string;
  /** e.g. "Tue 13 Oct". */
  dateLabel: string;
  editHref: string;
  className: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const popId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setError(null);
    if (refocus) btnRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const h = popRef.current?.offsetHeight ?? 0;
    const left = Math.max(
      EDGE,
      Math.min(b.left, window.innerWidth - POP_W - EDGE),
    );
    const below = b.bottom + GAP;
    const top =
      below + h > window.innerHeight - EDGE && b.top - GAP - h > EDGE
        ? b.top - GAP - h
        : below;
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Keeps the session panel open behind the popover.
      e.preventDefault();
      close(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, close]);

  const skip = () =>
    start(async () => {
      setError(null);
      const r = await skipMarkAction(markId, onDate);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      // The badge goes away with the refresh: park focus on its block.
      btnRef.current
        ?.closest('[data-testid="plan-block"]')
        ?.querySelector<HTMLElement>('[data-block-main]')
        ?.focus();
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        title={note ? `Entry quiz: ${note}` : 'Entry quiz'}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={className}
      >
        Entry quiz
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            role="dialog"
            aria-labelledby={headingId}
            className="fixed z-50 flex flex-col gap-2 rounded-md border border-line-strong bg-panel p-3 text-[13px] text-fg shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
            style={{
              width: POP_W,
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 id={headingId} className="m-0 text-[13px] font-semibold">
                  Entry quiz
                </h3>
                <div className="font-mono text-xs text-muted">{dateLabel}</div>
              </div>
              <button
                type="button"
                onClick={() => close(true)}
                aria-label="Close"
                title="Close (Esc)"
                className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-line hover:text-fg"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
            <p className="m-0 break-words text-muted">
              {note ?? 'Every session of this class starts with one.'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-autofocus
                disabled={pending}
                onClick={skip}
                className={actionBtn}
              >
                Not this week
              </button>
              <Link href={editHref} className={actionBtn}>
                <PencilSimple size={13} aria-hidden />
                Edit
              </Link>
            </div>
            {error && (
              <p role="alert" className="m-0 text-err-fg">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
