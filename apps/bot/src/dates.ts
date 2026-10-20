/** Date wording shared by the bot's views and posts (en-GB, Warsaw wall clock). */

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = [
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
];

/** `20 Oct` of a wall Date (UTC fields = Warsaw wall clock). */
export const dayMonth = (d: Date) =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

/** `Tue 20 Oct 2026` of a wall Date. */
export const wallDate = (d: Date) =>
  `${WEEKDAYS[d.getUTCDay()]} ${dayMonth(d)} ${d.getUTCFullYear()}`;

const warsawParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** `Tue 20 Oct 2026` of a real instant, read on the Warsaw wall clock. */
export function instantDate(d: Date): string {
  const p = Object.fromEntries(
    warsawParts.formatToParts(d).map((x) => [x.type, x.value]),
  );
  return wallDate(
    new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))),
  );
}

/**
 * `Week 43 · 19–25 Oct 2026` from the first and last day (wall Dates); across
 * months `Week 40 · 28 Sep – 4 Oct 2026`, across years
 * `Week 1 · 29 Dec 2025 – 4 Jan 2026`.
 */
export function weekTitle(week: number, first: Date, last: Date): string {
  const fy = first.getUTCFullYear();
  const ly = last.getUTCFullYear();
  if (fy !== ly)
    return `Week ${week} · ${dayMonth(first)} ${fy} – ${dayMonth(last)} ${ly}`;
  if (first.getUTCMonth() !== last.getUTCMonth())
    return `Week ${week} · ${dayMonth(first)} – ${dayMonth(last)} ${ly}`;
  return `Week ${week} · ${first.getUTCDate()}–${dayMonth(last)} ${ly}`;
}
