/**
 * Field errors of the web forms (client-safe, no imports). A refusal may name
 * the input it is about (`field`, the input's `name`): the form then shows
 * the message under that input, marks it `aria-invalid` and describes it
 * with the message, and focuses it. Any other refusal stays the form's
 * general alert.
 */

/** Id of the message under `field` in the form `formId`. */
export const fieldErrorId = (formId: string, field: string): string =>
  `${formId}-${field}-error`;

/**
 * The ARIA attributes of the input `name`: `aria-invalid` and the error id
 * (after the input's own `describedBy`) when the current error is about it.
 */
export function fieldAria(
  error: { field?: string } | null | undefined,
  formId: string,
  name: string,
  describedBy?: string,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  const on = error?.field === name;
  const ids = [describedBy, on ? fieldErrorId(formId, name) : undefined]
    .filter(Boolean)
    .join(' ');
  return {
    ...(on ? { 'aria-invalid': true as const } : {}),
    ...(ids ? { 'aria-describedby': ids } : {}),
  };
}

/**
 * The input of `form` named `field` that can show an error: a rendered
 * control, not a hidden input. Null when the form has none (the field is not
 * shown, e.g. the fixed code of an edit form), so the message stays general.
 */
export function visibleControl(
  form: HTMLFormElement | null,
  field: string | undefined,
): HTMLElement | null {
  if (!form || !field) return null;
  const el = form.elements.namedItem(field);
  if (!(el instanceof HTMLElement)) return null;
  if (el instanceof HTMLInputElement && el.type === 'hidden') return null;
  return el;
}
