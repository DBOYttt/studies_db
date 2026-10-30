'use client';

import {
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ActionState } from '@/lib/admin-forms';
import { useCardStatus } from './CardStatus';
import { primaryBtn } from './form-styles';

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export const secondaryBtn =
  'inline-flex h-8 items-center gap-[5px] rounded border border-line-strong bg-panel px-2.5 text-accent-ink transition-colors hover:border-accent active:translate-y-px aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
const dangerBtn =
  'inline-flex h-8 items-center gap-[5px] rounded border border-err-fg bg-panel px-2.5 font-semibold text-err-fg transition-colors hover:bg-err-bg active:translate-y-px aria-disabled:cursor-progress aria-disabled:opacity-60';

/**
 * One button that runs an admin Server Action with fixed hidden `fields`.
 * With `confirm` the first click only asks (the events' inline confirm
 * pattern): a second, explicit button runs it, and Cancel or Escape backs
 * out.
 * `disabled` keeps the button focusable but `aria-disabled`, and a submit
 * then does nothing; `disabledText` says why. The result goes to a polite
 * `role="status"` or a `role="alert"`. Callers key it on what the button
 * means (e.g. blocked or not), so a toggled button starts with no message.
 * With `cardStatus` inside a `CardStatus`, the result goes to the card's
 * status area instead, which outlives a row this action removes.
 */
export function ActionButton({
  action,
  fields = {},
  label,
  ariaLabel,
  pendingLabel = 'Working…',
  icon,
  variant = 'secondary',
  confirm,
  disabled = false,
  disabledText,
  className,
  cardStatus = false,
  onResult,
}: {
  action: Action;
  fields?: Record<string, string>;
  label: string;
  /** Accessible name of the trigger when `label` alone is ambiguous. */
  ariaLabel?: string;
  pendingLabel?: string;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary';
  confirm?: { question: string; confirmLabel: string };
  disabled?: boolean;
  disabledText?: string;
  className?: string;
  /** Report to the enclosing `CardStatus` (see above). */
  cardStatus?: boolean;
  /** Called with every result, even if this button unmounts meanwhile. */
  onResult?: (r: ActionState) => void;
}) {
  const card = useCardStatus();
  const report = cardStatus ? card : null;
  // Reported from the call itself: the row (and this button) may unmount in
  // the same commit that delivers the result. Any button in a card clears
  // the card's last message when it starts.
  const act = async (prev: ActionState, form: FormData) => {
    card?.(null);
    const r = await action(prev, form);
    report?.(r);
    onResult?.(r);
    return r;
  };
  const [state, formAction, pending] = useActionState(act, null);
  const [asking, setAsking] = useState(false);
  // The last result is hidden once a new question opens, so an old message
  // never sits beside it; a new result shows again.
  const [stale, setStale] = useState(false);
  const busy = useRef(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Focus follows the question: to "Confirm …" when it opens, back to the
  // trigger when it closes (Cancel or a result).
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) askRef.current?.focus();
    else if (wasAsking.current) triggerRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);
  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending]);
  useEffect(() => {
    if (state) {
      setAsking(false);
      setStale(false);
    }
  }, [state]);

  const off = disabled || pending;
  const run = (form: HTMLFormElement) => {
    if (busy.current || off) return;
    busy.current = true;
    const data = new FormData(form);
    startTransition(() => formAction(data));
  };
  const btn = variant === 'primary' ? primaryBtn : secondaryBtn;

  return (
    <form
      method="post"
      className={className ?? 'flex flex-col items-start'}
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {confirm && !asking ? (
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          aria-disabled={off || undefined}
          title={disabled ? disabledText : undefined}
          className={btn}
          onClick={() => {
            if (off) return;
            setAsking(true);
            setStale(true);
          }}
        >
          {icon}
          {pending ? pendingLabel : label}
        </button>
      ) : confirm ? (
        <fieldset
          aria-label={confirm.question}
          // Escape backs out like Cancel (focus goes back to the trigger).
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setAsking(false);
            }
          }}
          className="m-0 flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-err-line bg-err-bg px-3 py-2"
        >
          <span className="w-full font-semibold text-err-fg sm:w-auto">
            {confirm.question}
          </span>
          <button
            ref={askRef}
            type="submit"
            aria-disabled={off || undefined}
            className={dangerBtn}
          >
            {pending ? pendingLabel : confirm.confirmLabel}
          </button>
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => setAsking(false)}
          >
            Cancel
          </button>
        </fieldset>
      ) : (
        <button
          type="submit"
          aria-label={ariaLabel}
          aria-disabled={off || undefined}
          title={disabled ? disabledText : undefined}
          className={btn}
        >
          {icon}
          {pending ? pendingLabel : label}
        </button>
      )}
      {!report && (
        <div role="status" className="text-ok-fg not-empty:mt-1.5">
          {state?.ok && !pending && !stale ? state.message : null}
        </div>
      )}
      {!report && state && !state.ok && !pending && !stale && (
        <p role="alert" className="m-0 mt-1.5 text-err-fg">
          {state.message}
        </p>
      )}
    </form>
  );
}
