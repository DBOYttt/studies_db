'use client';

import {
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
} from 'react';
import type { ActionState } from '@/lib/admin-forms';
import { primaryBtn } from './form-styles';

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * The admin forms' wrapper around `useActionState`: the result goes to a
 * polite `role="status"` line (success) or a `role="alert"` (refusal), and
 * the submit button is `aria-disabled` while the action runs; a second
 * submit then does nothing. Submitting goes through `onSubmit`, so a refused
 * form keeps what was typed (a form `action` would reset it); with
 * `resetOnSuccess` an applied change (not an `unchanged` one) clears the
 * form for the next entry. `onSaved` gets the submitted data of an applied
 * change (an edit form advances its orig snapshot with it).
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = 'Saving…',
  successText,
  resetOnSuccess = false,
  onSaved,
  label,
  className,
  children,
}: {
  action: Action;
  submitLabel: string;
  pendingLabel?: string;
  /** Shown instead of the action's message when it succeeded. */
  successText?: (message: string) => ReactNode;
  resetOnSuccess?: boolean;
  /** Called with the submitted data after an applied (not `unchanged`) save. */
  onSaved?: (data: FormData) => void;
  /** The form's accessible name (makes it a `form` landmark). */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  // Read synchronously: a second click in the same tick must not see a
  // stale `pending`.
  const busy = useRef(false);
  // The data of the submit whose result `state` is.
  const submitted = useRef<FormData | null>(null);

  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending]);

  // Each result is handled once, even if the effect re-runs for its deps.
  const handled = useRef<ActionState>(null);

  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    const data = submitted.current;
    submitted.current = null;
    if (!state?.ok || state.unchanged) return;
    if (data) onSaved?.(data);
    if (resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess, onSaved]);

  return (
    <form
      method="post"
      ref={formRef}
      aria-label={label}
      className={className ?? 'flex flex-col gap-3 px-3 py-3'}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy.current || pending) return;
        busy.current = true;
        const data = new FormData(e.currentTarget);
        submitted.current = data;
        startTransition(() => formAction(data));
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="submit"
          aria-disabled={pending || undefined}
          className={primaryBtn}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        <div role="status" className="min-w-0 text-ok-fg">
          {state?.ok && !pending
            ? (successText?.(state.message) ?? state.message)
            : null}
        </div>
      </div>
      {state && !state.ok && !pending && (
        <p
          role="alert"
          className="m-0 rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
