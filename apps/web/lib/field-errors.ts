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

/**
 * The event form's input a refusal is about. The rules live in
 * `@studies/db` (shared with the bot, which has no fields), so the web maps
 * their messages; an unknown message maps to nothing (a general alert).
 */
const EVENT_FIELDS: Record<string, string> = {
  'The title must be 1 to 100 characters.': 'title',
  'Unknown event type.': 'kind',
  'The place can be at most 100 characters.': 'place',
  'The note can be at most 1000 characters.': 'note',
  'Enter the event date.': 'date',
  'Invalid date.': 'date',
  'The date cannot be more than a month in the past.': 'date',
  'The date cannot be more than a year ahead.': 'date',
  'Enter the start time.': 'start',
  'Invalid time.': 'start',
  'The end must be after the start.': 'end',
  'Subject not found.': 'subjectId',
  'A class and group can only be chosen together with a subject.': 'subjectId',
  'Group not found.': 'groupId',
  'The chosen group does not belong to this class.': 'groupId',
  'The chosen class does not belong to this subject.': 'classId',
  'Unknown repeat rule.': 'repeat',
  'Enter the date until which the event repeats.': 'until',
  'The series end date must be DD.MM.YYYY (e.g. 15.12.2026).': 'until',
  'The series end date cannot be before the first event.': 'until',
  'The last occurrence can be at most a year after the first.': 'until',
};

export function eventFieldOf(message: string): string | undefined {
  return Object.hasOwn(EVENT_FIELDS, message)
    ? EVENT_FIELDS[message]
    : undefined;
}

/** A refusal with the input it is about, when it is about one. */
export function withEventField<R extends { ok: boolean; message: string }>(
  r: R,
): R & { field?: string } {
  if (r.ok) return r;
  const field = eventFieldOf(r.message);
  return field === undefined ? r : { ...r, field };
}
