/**
 * Pure helpers of the event form and page (client-safe): composing "Kiedy"
 * from the form's inputs, showing stored wall times, labelling audit rows.
 */
import { EVENT_KINDS, type EventKind } from '@studies/db/constants';

const pad = (n: number) => String(n).padStart(2, '0');
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Date `YYYY-MM-DD`, start/end `HH:MM` (or empty) → `DD.MM.RRRR [HH:MM[-HH:MM]]`. */
export function composeWhen(
  date: string,
  start: string,
  end: string,
): { ok: true; when: string } | { ok: false; message: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return { ok: false, message: 'Podaj datę wydarzenia.' };
  const s = start.trim();
  const e = end.trim();
  const day = `${m[3]}.${m[2]}.${m[1]}`;
  if (!s && e) return { ok: false, message: 'Podaj godzinę rozpoczęcia.' };
  if (!s) return { ok: true, when: day };
  if (!TIME_RE.test(s) || (e && !TIME_RE.test(e))) {
    return { ok: false, message: 'Nieprawidłowa godzina.' };
  }
  return { ok: true, when: `${day} ${s}${e ? `-${e}` : ''}` };
}

/** "Kiedy" text of stored wall times (same shape `composeWhen` makes). */
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

const MONTHS = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];

/** "20 października 2026, 10:00–11:30" (or without time for all-day). */
export function whenLabel(
  startsAt: Date,
  endsAt: Date | null,
  allDay: boolean,
): string {
  const day = `${startsAt.getUTCDate()} ${MONTHS[startsAt.getUTCMonth()]} ${startsAt.getUTCFullYear()}`;
  if (allDay) return `${day}, cały dzień`;
  const t = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${day}, ${t(startsAt)}${endsAt ? `–${t(endsAt)}` : ''}`;
}

export const kindLabel = (k: EventKind) => EVENT_KINDS[k].label;

export const AUDIT_LABELS: Record<string, string> = {
  'event.add': 'Dodano wydarzenie',
  'event.edit': 'Zmieniono wydarzenie',
  'event.delete': 'Usunięto wydarzenie',
  'event.restore': 'Przywrócono wydarzenie',
  'event.link': 'Powiązano post',
  'event.unlink': 'Usunięto powiązanie z postem',
  'event.upload': 'Dodano pliki',
};

const FIELD_LABELS: Record<string, string> = {
  kind: 'rodzaj',
  title: 'tytuł',
  subjectId: 'przedmiot',
  classId: 'zajęcia',
  groupId: 'grupa',
  startsAt: 'początek',
  endsAt: 'koniec',
  allDay: 'cały dzień',
  place: 'miejsce',
  note: 'notatka',
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
    if (keys.length) parts.push(`zmienione: ${keys.join(', ')}`);
  }
  if (d.source === 'web') parts.push('przez stronę');
  else if (d.source === 'discord') parts.push('przez Discorda');
  return parts.join(' · ');
}
