'use client';

import { PencilSimple, X } from '@phosphor-icons/react';
import Link from 'next/link';
import {
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useSkipMark } from './useSkipMark';

const POP_W = 240;
const GAP = 4;
const EDGE = 8;

const actionBtn =
  'inline-flex h-7 items-center gap-1 rounded border border-line-strong bg-panel px-2.5 text-accent-ink hover:border-accent aria-disabled:opacity-60';

/**
 * Entry quiz badge on a session block: a button that opens a small popover
 * with the note, "Not this week" (skips the mark on the session's date; for
 * an all-groups mark "Not this week (all groups)", every group) and
 * "Edit" (the class section of the subject page). The popover is portalled
 * and fixed below the badge, so the block's clipping does not cut it off.
 * Escape or a click outside closes it and focus returns to the badge. Tab
 * past its last control (or Shift+Tab before its first) closes it and
 * returns focus to the badge too, so the user keeps their place in the grid
 * (the popover is portalled to the end of <body>); focus leaving both the
 * popover and the badge otherwise closes it.
 * After a skip `onSkipped` runs (the timetable opens the session panel with
 * an Undo); without it focus parks on the block.
 */
export function EntryQuizBadge({
  markId,
  note,
  allGroups,
  onDate,
  dateLabel,
  editHref,
  label,
  onSkipped,
  className,
  children = 'Entry quiz',
}: {
  markId: number;
  note: string | null;
  /** The mark covers every group: "Not this week" skips them all. */
  allGroups: boolean;
  /** Session date, `YYYY-MM-DD`. */
  onDate: string;
  /** e.g. "Tue 13 Oct". */
  dateLabel: string;
  editHref: string;
  /** Accessible name, e.g. "Entry quiz: Rozdział 2" (the bar may shorten). */
  label?: string;
  onSkipped?: () => void;
  className: string;
  /** Visible content; its text must be part of `label` (label in name). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const popId = useId();

  // The badge goes away with the refresh: park focus on its block first.
  const parkFocus = useCallback(() => {
    if (onSkipped) onSkipped();
    else
      btnRef.current
        ?.closest('[data-testid="plan-block"]')
        ?.querySelector<HTMLElement>('[data-block-main]')
        ?.focus();
    setOpen(false);
  }, [onSkipped]);
  const { skip, pending, error, setError } = useSkipMark(
    markId,
    onDate,
    parkFocus,
  );

  const close = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      setError(null);
      if (refocus) btnRef.current?.focus();
    },
    [setError],
  );

  /** Focus moved somewhere outside both the popover and the badge. */
  const onFocusOut = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && (popRef.current?.contains(to) || btnRef.current?.contains(to)))
      return;
    close(false);
  };

  /** Tab off either end of the popover: close it, back to the badge. */
  const onPopKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const list =
      popRef.current?.querySelectorAll<HTMLElement>('button, a[href]');
    if (!list || list.length === 0) return;
    const cur = document.activeElement;
    const edge = e.shiftKey ? list[0] : list[list.length - 1];
    // From the popover box itself only Shift+Tab leaves it.
    if (cur === popRef.current ? !e.shiftKey : cur !== edge) return;
    e.preventDefault();
    close(true);
  };

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

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={label}
        title={note ? `Entry quiz: ${note}` : 'Entry quiz'}
        onClick={() => (open ? close(false) : setOpen(true))}
        onBlur={open ? onFocusOut : undefined}
        className={className}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            role="dialog"
            aria-labelledby={headingId}
            // Clicks on text inside keep focus in the dialog (no focusout).
            tabIndex={-1}
            onBlur={onFocusOut}
            onKeyDown={onPopKey}
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
            {note ? (
              <p lang="pl" className="m-0 break-words text-muted">
                {note}
              </p>
            ) : (
              <p className="m-0 break-words text-muted">
                Every session of this class starts with one.
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-autofocus
                // aria-disabled, not disabled: a disabled button drops focus.
                aria-disabled={pending}
                onClick={skip}
                className={actionBtn}
              >
                {allGroups ? 'Not this week (all groups)' : 'Not this week'}
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
