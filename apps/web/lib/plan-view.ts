/**
 * Pure, client-safe glue between the Plan zajęć queries and the week view:
 * the serialisable session shape (server -> client component), week
 * navigation links and the Polish date/time labels.
 *
 * Session dates are wall Dates (see lib/plan.ts): every formatter here reads
 * UTC fields or formats with `timeZone: 'UTC'`. Only `formatSyncTime` takes a
 * real instant (plan_sync) and formats it in Europe/Warsaw.
 */
import { explorerHref } from './explorer';
import {
  formatIsoWeek,
  type IsoWeek,
  type PlanSession,
  shiftWeek,
} from './plan';
import { sqlHref } from './sql-editor';
import {
  classHref,
  groupHref,
  type LinkContext,
  lecturerHref,
  subjectHref,
} from './view-links';

export interface SessionLinks {
  /** Subject screen with the session's class/group selected when known. */
  subject: string;
  lecturer: string | null;
  /** SQL console with `SELECT * FROM v_class_sessions WHERE id = <id>`. */
  sql: string;
}

/** A PlanSession as sent to client components: ISO dates, links resolved. */
export type WeekSession = Omit<PlanSession, 'startsAt' | 'endsAt'> & {
  startsAt: string;
  endsAt: string;
  links: SessionLinks;
};

/**
 * `simple` links the subject to the simple view (`/s/subjects/<code>` with
 * the session's class kind and group number) and drops the lecturer link
 * (there is no simple lecturer page).
 */
export function sessionLinks(
  s: PlanSession,
  ctx?: LinkContext,
  simple = false,
): SessionLinks {
  if (simple) {
    const q = new URLSearchParams();
    const number =
      s.groupId !== null ? ctx?.groups.get(s.groupId)?.number : null;
    if (s.classKind) {
      q.set('class', s.classKind);
      if (number != null) q.set('group', String(number));
    }
    const qs = q.toString();
    return {
      subject: `/s/subjects/${encodeURIComponent(s.subjectCode)}${qs ? `?${qs}` : ''}`,
      lecturer: null,
      sql: sqlHref('/sql', `SELECT * FROM v_class_sessions WHERE id = ${s.id}`),
    };
  }
  const subject =
    (ctx &&
      ((s.groupId !== null && groupHref(ctx, s.groupId)) ||
        (s.classId !== null && classHref(ctx, s.classId)) ||
        subjectHref(ctx, s.subjectId))) ||
    explorerHref(s.subjectCode, {});
  return {
    subject,
    lecturer: s.lecturerId === null ? null : lecturerHref(s.lecturerId),
    sql: sqlHref('/sql', `SELECT * FROM v_class_sessions WHERE id = ${s.id}`),
  };
}

export const toWeekSession = (
  s: PlanSession,
  ctx?: LinkContext,
  simple = false,
): WeekSession => ({
  ...s,
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt.toISOString(),
  links: sessionLinks(s, ctx, simple),
});

export const fromWeekSession = (
  s: WeekSession,
): PlanSession & { links: SessionLinks } => ({
  ...s,
  startsAt: new Date(s.startsAt),
  endsAt: new Date(s.endsAt),
});

/** prev / current / next week links of a page; `extra` params come first. */
export function weekNav(
  path: string,
  w: IsoWeek,
  current: IsoWeek,
  extra: Record<string, string> = {},
): { prev: string; today: string; next: string } {
  const href = (x: IsoWeek) => {
    const q = new URLSearchParams(extra);
    q.set('week', formatIsoWeek(x));
    return `${path}?${q}`;
  };
  return {
    prev: href(shiftWeek(w, -1)),
    today: href(current),
    next: href(shiftWeek(w, 1)),
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** `HH:MM` of a wall Date. */
export const wallTime = (d: Date): string =>
  `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;

/** `YYYY-MM-DD` of a wall Date. */
export const wallDateKey = (d: Date): string => d.toISOString().slice(0, 10);

/** ISO string of a wall Date -> `YYYY-MM-DD HH:MM:SS` (as MariaDB shows it). */
export const wallSqlText = (iso: string): string =>
  iso.slice(0, 19).replace('T', ' ');

const DAY_NAMES = [
  'Poniedziałek',
  'Wtorek',
  'Środa',
  'Czwartek',
  'Piątek',
  'Sobota',
  'Niedziela',
];
const MONTHS_SHORT = [
  'sty',
  'lut',
  'mar',
  'kwi',
  'maj',
  'cze',
  'lip',
  'sie',
  'wrz',
  'paź',
  'lis',
  'gru',
];

/** Column header parts of a wall day: `Wtorek`, `13.10`. */
export function dayHeader(d: Date): { name: string; date: string } {
  return {
    name: DAY_NAMES[(d.getUTCDay() + 6) % 7],
    date: `${d.getUTCDate()}.${p2(d.getUTCMonth() + 1)}`,
  };
}

const shortDate = (d: Date, year: boolean) =>
  `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;

/**
 * `Tydzień 42 · 12 paź – 16 paź 2026` from the first to the last shown day;
 * the first day carries its year too when the week spans two years.
 */
export function weekHeading(w: IsoWeek, days: Date[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return `Tydzień ${w.week}`;
  const twoYears = first.getUTCFullYear() !== last.getUTCFullYear();
  return `Tydzień ${w.week} · ${shortDate(first, twoYears)} – ${shortDate(last, true)}`;
}

const longDateFmt = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `wtorek, 13 października 2026` of a wall Date. */
export const wallLongDate = (d: Date): string => longDateFmt.format(d);

const syncFmt = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Warsaw',
});

/** A plan_sync timestamp (a real UTC instant) in Warsaw time. */
export const formatSyncTime = (d: Date): string => syncFmt.format(d);

/**
 * The last sync run failed: an error is recorded and no successful run
 * came after it (a success clears `lastError`, so this is a safety net).
 */
export function syncFailed(s: {
  lastRunAt: Date | null;
  lastOkAt: Date | null;
  lastError: string | null;
}): boolean {
  if (!s.lastError) return false;
  if (!s.lastOkAt) return true;
  return s.lastRunAt !== null && s.lastRunAt.getTime() > s.lastOkAt.getTime();
}
