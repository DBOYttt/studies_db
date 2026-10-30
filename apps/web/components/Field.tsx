import type { ReactNode } from 'react';
import { fieldErrorId } from '@/lib/field-errors';

/** The error a form is showing, and the id prefix of its field messages. */
export type FormError = { message: string; field?: string } | null;

/**
 * A label around one control with that control's error message under it.
 * The message sits outside the label, so it is the control's description
 * (`fieldAria` on the control points at it), not part of its name.
 */
export function Field({
  className,
  error,
  formId,
  name,
  children,
}: {
  /** The label's classes. */
  className: string;
  error: FormError;
  formId: string;
  /** The control's `name`. */
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is in children */}
      <label className={className}>{children}</label>
      {error?.field === name && (
        <span
          id={fieldErrorId(formId, name)}
          className="text-xs font-normal text-err-fg"
        >
          {error.message}
        </span>
      )}
    </div>
  );
}
