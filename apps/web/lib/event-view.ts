/**
 * Pure helpers of the event form and page (client-safe): composing "When"
 * from the form's inputs, showing stored wall times, labelling audit rows.
 */
import { EVENT_KINDS, type EventKind } from '@studies/db/constants';
import { MONTHS_SHORT, WEEKDAYS_SHORT } from '@studies/db/text';

const pad = (n: number) => String(n).padStart(2, '0');
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** A time of day the form accepts (`H:MM` or `HH:MM`, 00:00-23:59). */
export const isTimeOfDay = (v: string): boolean => TIME_RE.test(v.trim());

/** Date `YYYY-MM-DD`, start/end `HH:MM` (or empty) → `DD.MM.YYYY [HH:MM[-HH:MM]]`. */
export function composeWhen(
  date: string,
  start: string,
  end: string,
): { ok: true; when: string } | { ok: false; message: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return { ok: false, message: 'Enter the event date.' };
  const s = start.trim();
  const e = end.trim();
  const day = `${m[3]}.${m[2]}.${m[1]}`;
  if (!s && e) return { ok: false, message: 'Enter the start time.' };
  if (!s) return { ok: true, when: day };
  if (!TIME_RE.test(s) || (e && !TIME_RE.test(e))) {
    return { ok: false, message: 'Invalid time.' };
  }
  return { ok: true, when: `${day} ${s}${e ? `-${e}` : ''}` };
}

/** "When" text of stored wall times (same shape `composeWhen` makes). */
export function whenOf(startsAt: Date, endsAt: Date | null, allDay: boolean) {
  const date = `${pad(startsAt.getUTCDate())}.${pad(startsAt.getUTCMonth() + 1)}.${startsAt.getUTCFullYear()}`;
  if (allDay) return date;
  const t = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${date} ${t(startsAt)}${endsAt ? `-${t(endsAt)}` : ''}`;
}

/** Form defaults from stored wall times. */
export function formWhen(startsAt: Date, endsAt: Date | null, allDay: boolean) {
  const date = `${startsAt.getUTCFullYear()}-${pad(startsAt.getUTCMonth() + 1)}-${pad(startsAt.getUTCDate())}`;
  const t = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return {
    date,
    start: allDay ? '' : t(startsAt),
    end: allDay || !endsAt ? '' : t(endsAt),
  };
}

const DAYS_SHORT = WEEKDAYS_SHORT;
const MONTHS = MONTHS_SHORT;

/** "Tue 20 Oct 2026, 10:00–11:30" (or ", all day" for all-day events). */
export function whenLabel(
  startsAt: Date,
  endsAt: Date | null,
  allDay: boolean,
): string {
  const day = `${DAYS_SHORT[startsAt.getUTCDay()]} ${startsAt.getUTCDate()} ${MONTHS[startsAt.getUTCMonth()]} ${startsAt.getUTCFullYear()}`;
  if (allDay) return `${day}, all day`;
  const t = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${day}, ${t(startsAt)}${endsAt ? `–${t(endsAt)}` : ''}`;
}

export const kindLabel = (k: EventKind) => EVENT_KINDS[k].label;

export const AUDIT_LABELS: Record<string, string> = {
  'event.add': 'Event added',
  'event.edit': 'Event changed',
  'event.delete': 'Event deleted',
  'event.restore': 'Event restored',
  'event.link': 'Post linked',
  'event.unlink': 'Post unlinked',
  'event.upload': 'Files added',
  'event.upload_retry': 'File upload retried',
  'event.post_retry': 'Discord post retried',
};

const FIELD_LABELS: Record<string, string> = {
  kind: 'type',
  title: 'title',
  subjectId: 'subject',
  classId: 'class',
  groupId: 'group',
  startsAt: 'start',
  endsAt: 'end',
  allDay: 'all day',
  place: 'place',
  note: 'note',
};

/** One line describing an audit row's details (changed fields, source). */
export function auditSummary(action: string, details: unknown): string {
  const d =
    details && typeof details === 'object'
      ? (details as Record<string, unknown>)
      : {};
  const parts: string[] = [];
  if (action === 'event.edit' && d.changes && typeof d.changes === 'object') {
    const keys = Object.keys(d.changes).map((k) => FIELD_LABELS[k] ?? k);
    if (keys.length) parts.push(`changed: ${keys.join(', ')}`);
  }
  if (d.source === 'web') parts.push('via the website');
  else if (d.source === 'discord') parts.push('via Discord');
  return parts.join(' · ');
}
