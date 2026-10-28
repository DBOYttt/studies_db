/** English plural with the count: plural(2, 'file', 'files') -> "2 files". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${Math.abs(n) === 1 ? one : many}`;
}

/**
 * `ł`/`Ł` → `l`/`L`. utf8mb4_unicode_ci already treats the other Polish
 * diacritics (ą ć ę ń ó ś ź ż) as their base letters, but not ł, so the
 * FULLTEXT columns and queries fold it by hand (see `materials.search_text`).
 */
export const foldStroke = (s: string): string =>
  s.replace(/ł/g, 'l').replace(/Ł/g, 'L');

/** Short English month names, index = `getUTCMonth()` ("Sep", never "Sept"). */
export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Short English weekday names, index = `getUTCDay()` (Sunday first). */
export const WEEKDAYS_SHORT = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

/**
 * en-GB `Intl` output with `month: 'short'` spells September "Sept"; the
 * interface uses "Sep" like every other three-letter month.
 */
export const fixSept = (s: string): string => s.replace(/\bSept\b/g, 'Sep');

/** Shown when an event is missing or deleted (web and bot share it). */
export const EVENT_NOT_FOUND = 'Event not found.';
