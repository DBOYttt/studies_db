import { MAX_SERIES_OCCURRENCES } from '@studies/db';
import { isTimeOfDay } from './event-view';

/**
 * The event form's input a refusal is about (`field`, see `field-errors.ts`).
 * The rules live in `@studies/db` (shared with the bot, which has no
 * fields), so the web maps their messages; an unknown message maps to
 * nothing and stays the form's general alert. The tests take these
 * messages from the real validators, so a reworded one fails them.
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
  [`A series can have at most ${MAX_SERIES_OCCURRENCES} occurrences.`]: 'until',
};

/** Said of either time input; the submitted values tell which one. */
const INVALID_TIME = 'Invalid time.';

/**
 * The input `message` is about. "Invalid time." names whichever of Start
 * and End is not a time; when neither is (it cannot be told), nothing, so
 * no valid input is marked or focused.
 */
export function eventFieldOf(
  message: string,
  times: { start: string; end: string } = { start: '', end: '' },
): string | undefined {
  if (message === INVALID_TIME) {
    if (times.start.trim() && !isTimeOfDay(times.start)) return 'start';
    if (times.end.trim() && !isTimeOfDay(times.end)) return 'end';
    return undefined;
  }
  return Object.hasOwn(EVENT_FIELDS, message)
    ? EVENT_FIELDS[message]
    : undefined;
}

/** A refusal with the input it is about, when it is about one. */
export function withEventField<R extends { ok: boolean; message: string }>(
  r: R,
  form: FormData,
): R & { field?: string } {
  if (r.ok) return r;
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v : '';
  };
  const field = eventFieldOf(r.message, {
    start: text('start'),
    end: text('end'),
  });
  return field === undefined ? r : { ...r, field };
}
