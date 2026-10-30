import { wallShortDate } from './plan-view';

/**
 * Success messages written into polite `role="status"` regions, so a
 * screen-reader user hears that a change was saved (sighted users see the
 * same line).
 */
export const STATUS = {
  groupSaved: 'Group saved.',
  groupsCleared: 'Groups cleared.',
  remindersSaved: 'Reminders saved.',
  sessionFilled: 'Date, time and place filled in.',
  postLinked: 'Post linked.',
  postUnlinked: 'Post unlinked.',
  /** Restore from the edit form's banner (the form stays, typed values too). */
  eventRestored: 'Event restored.',
} as const;

export type QuizChange = 'on' | 'off' | 'restore' | 'note' | 'unskip';

/**
 * Message after an entry quiz change on the subject page. `groupLabel` is
 * the view's label ("All groups" or a group name); `className` prefixes it
 * when the section lists several classes; `date` is the unskipped day.
 */
export function quizStatus(
  change: QuizChange,
  o: { groupLabel: string; className?: string | null; date?: string },
): string {
  const scope = o.groupLabel === 'All groups' ? 'all groups' : o.groupLabel;
  const text = {
    on: `Entry quiz turned on for ${scope}.`,
    off: `Entry quiz turned off for ${scope}.`,
    restore: `Entry quiz restored for ${scope}.`,
    note: 'Note saved.',
    unskip: `Entry quiz back on ${o.date ?? ''}.`,
  }[change];
  if (!o.className) return text;
  return `${o.className}: ${text[0].toLowerCase()}${text.slice(1)}`;
}

/**
 * Visually hidden start of a timetable block's name: its day and time
 * (`Tue 13 Oct, 10:00–11:30 `), so the block makes sense out of its column.
 */
export const blockDayPrefix = (day: Date, time: string): string =>
  `${wallShortDate(day)}, ${time} `;
