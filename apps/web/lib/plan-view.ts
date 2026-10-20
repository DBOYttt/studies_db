/**
 * Pure, client-safe glue between the Timetable queries and the week view:
 * the serialisable session shape (server -> client component), week
 * navigation links and the English date/time labels.
 *
 * Session dates are wall Dates (see lib/plan.ts): every formatter here reads
 * UTC fields or formats with `timeZone: 'UTC'`. Only `formatSyncTime` takes a
 * real instant (plan_sync) and formats it in Europe/Warsaw.
 */
import { fixSept, MONTHS_SHORT, WEEKDAYS_SHORT } from '@studies/db/text';
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
  if (s.type === 'event') {
    // Events open their own page; `subject` carries that link.
    return {
      subject: `${simple ? '/s' : ''}/wydarzenia/${s.id}`,
      lecturer: null,
      sql: sqlHref('/sql', `SELECT * FROM v_events WHERE id = ${s.id}`),
    };
  }
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

/** Column header parts of a wall day: `Tue`, `13 Oct` (shown "Tue 13 Oct"). */
export function dayHeader(d: Date): { name: string; date: string } {
  return {
    name: WEEKDAYS_SHORT[d.getUTCDay()],
    date: `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`,
  };
}

const dm = (d: Date) => `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;

/**
 * `Week 43 · 19–25 Oct 2026` from the first to the last shown day. Across
 * months `Week 40 · 28 Sep – 4 Oct 2026`, across years
 * `Week 1 · 29 Dec 2025 – 4 Jan 2026`.
 */
export function weekHeading(w: IsoWeek, days: Date[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return `Week ${w.week}`;
  const fy = first.getUTCFullYear();
  const ly = last.getUTCFullYear();
  if (fy !== ly)
    return `Week ${w.week} · ${dm(first)} ${fy} – ${dm(last)} ${ly}`;
  if (first.getUTCMonth() !== last.getUTCMonth())
    return `Week ${w.week} · ${dm(first)} – ${dm(last)} ${ly}`;
  const same = first.getUTCDate() === last.getUTCDate();
  return `Week ${w.week} · ${same ? dm(last) : `${first.getUTCDate()}–${dm(last)}`} ${ly}`;
}

const longDateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `Tuesday, 13 October 2026` of a wall Date. */
export const wallLongDate = (d: Date): string => longDateFmt.format(d);

const syncFmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Warsaw',
});

/** A plan_sync timestamp (a real UTC instant) in Warsaw time. */
export const formatSyncTime = (d: Date): string => fixSept(syncFmt.format(d));

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
