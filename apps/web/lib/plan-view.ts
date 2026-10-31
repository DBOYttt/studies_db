/**
 * Pure, client-safe glue between the Timetable queries and the week view:
 * the serialisable session shape (server -> client component), week
 * navigation links and the English date/time labels.
 *
 * Session dates are wall Dates (see lib/plan.ts): every formatter here reads
 * UTC fields or formats with `timeZone: 'UTC'`. Only `formatSyncTime` takes a
 * real instant (plan_sync) and formats it in Europe/Warsaw.
 */
import { CLASS_NAMES } from '@studies/db/constants';
import {
  fixSept,
  MONTHS_SHORT,
  plural,
  WEEKDAYS_SHORT,
} from '@studies/db/text';
import { explorerHref } from './explorer';
import {
  filterMyGroups,
  formatIsoWeek,
  type IsoWeek,
  type MyGroups,
  type PlanBadge,
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

/* ---------- timetable assessments: badges and exam blocks ---------- */

/** Visible badge text: "Test", "2 tests", "Entry quiz". */
export function badgeLabel(b: PlanBadge): string {
  if (b.kind === 'entry_quiz') return 'Entry quiz';
  const n = b.eventIds.length;
  return n > 1 ? `${n} tests` : 'Test';
}

/** Tooltip / accessible name: the label plus the test titles or the note. */
export function badgeTitle(b: PlanBadge): string {
  const label = badgeLabel(b);
  if (b.kind === 'entry_quiz') return b.note ? `${label}: ${b.note}` : label;
  const titles = b.titles.filter(Boolean);
  return titles.length > 0 ? `${label}: ${titles.join(', ')}` : label;
}

/** Short footer-bar label for narrow blocks: "Test", "Tests", "Quiz". */
function badgeShort(b: PlanBadge): string {
  if (b.kind === 'entry_quiz') return 'Quiz';
  return b.eventIds.length > 1 ? 'Tests' : 'Test';
}

/**
 * Footer bar text: the small-caps label, the short label shown in narrow
 * blocks, and the test titles or the note.
 */
export function badgeBarText(b: PlanBadge): {
  label: string;
  short: string;
  detail: string | null;
} {
  const label = badgeLabel(b);
  const short = badgeShort(b);
  if (b.kind === 'entry_quiz') return { label, short, detail: b.note || null };
  const titles = b.titles.filter(Boolean);
  return {
    label,
    short,
    detail: titles.length > 0 ? titles.join(', ') : null,
  };
}

/**
 * One bar for an entry quiz and its tests on a block too short for two:
 * "Quiz + Test" / "Quiz + 2 tests", "Q+T" when narrow; `title` names both.
 */
export function mergedBarText(list: PlanBadge[]): {
  label: string;
  short: string;
  title: string;
} {
  const quiz = list.filter((b) => b.kind === 'entry_quiz');
  const tests = list.filter((b) => b.kind === 'test');
  return {
    label: ['Quiz', ...tests.map(badgeLabel)].join(' + '),
    short: 'Q+T',
    title: [...quiz, ...tests].map(badgeTitle).join('. '),
  };
}

/** Height of one footer bar on a session block (px), a 24 px target. */
export const BADGE_BAR_H = 24;

/** Top padding plus the subject and class lines (two 14 px lines). */
const TEXT_MIN_PX = 3 + 2 * 14;

export type BadgeLayout = 'none' | 'bars' | 'merged' | 'stripe';

/**
 * Bottom padding of a block's text: the bars (3 px inset, 2 px apart) plus a
 * 3 px gap, or the 4 px stripes, so the text is clipped above them.
 */
export function badgePadBottom(layout: BadgeLayout, count: number): number {
  if (layout === 'none') return 3;
  if (layout === 'stripe') return 3 + 5 * count;
  const n = layout === 'merged' ? 1 : count;
  return 3 + BADGE_BAR_H * n + 2 * (n - 1) + 3;
}

/**
 * How `count` badges sit on a block `blockPx` tall: one bar each when they
 * fit under the subject and class lines, else one merged bar, else 4 px
 * stripes. The width is handled in CSS (container queries in WeekView).
 */
export function badgeLayout(blockPx: number, count: number): BadgeLayout {
  if (count === 0) return 'none';
  const fits = (l: BadgeLayout) =>
    blockPx - badgePadBottom(l, count) >= TEXT_MIN_PX;
  if (fits('bars')) return 'bars';
  if (count > 1 && fits('merged')) return 'merged';
  return 'stripe';
}

/**
 * Session panel heading: "ASD · Laboratorium Gr. 1 · Tue 27 Oct" (subject
 * code, class and group or "Exam", the date).
 */
export function sessionPanelHeading(s: PlanSession): string {
  const what =
    s.sessionKind === 'exam'
      ? 'Exam'
      : [s.className, s.groupName].filter(Boolean).join(' ') ||
        (s.classKind ? CLASS_NAMES[s.classKind] : '');
  return [s.subjectCode || s.subjectName, what, wallShortDate(s.startsAt)]
    .filter(Boolean)
    .join(' · ');
}

const words = (t: string | null | undefined): string[] =>
  (t ?? '')
    .toLocaleLowerCase('pl')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && w !== 'gr' && w !== 'grupa');

/**
 * The session label for the panel's Description row, or null when it only
 * repeats the subject, class and group (e.g. "Ćwiczenia gr 2") or is empty.
 */
export function panelDescription(s: PlanSession): string | null {
  const label = s.label?.trim();
  if (!label) return null;
  const known = new Set(
    [
      s.subjectName,
      s.subjectCode,
      s.className,
      s.groupName,
      s.classKind ? CLASS_NAMES[s.classKind] : null,
    ].flatMap(words),
  );
  return words(label).every((w) => known.has(w)) ? null : label;
}

/** The skip button: an all-groups mark skips every group of that day. */
export const skipLabel = (b: Extract<PlanBadge, { kind: 'entry_quiz' }>) =>
  b.allGroups ? 'Not this week (all groups)' : 'Not this week';

/** "Next classes" line: "Exam", or the class (else the label) and group. */
export function nextSessionWhat(s: PlanSession): string {
  if (s.sessionKind === 'exam') return 'Exam';
  return [s.className ?? s.label, s.groupName].filter(Boolean).join(', ');
}

/**
 * How a timed entry is drawn: exam sessions and timed `egzamin` events as
 * filled exam blocks, other events outlined, class sessions in their kind
 * colour.
 */
export function blockKind(
  s: Pick<PlanSession, 'type' | 'sessionKind' | 'eventKind' | 'allDay'>,
): 'class' | 'exam' | 'event' {
  if (s.type === 'class') return s.sessionKind === 'exam' ? 'exam' : 'class';
  return s.eventKind === 'egzamin' && !s.allDay ? 'exam' : 'event';
}

/** "Edit" of the Entry quiz popover: the class section on the subject page. */
export const entryQuizEditHref = (links: SessionLinks): string =>
  `${links.subject}#entry-quiz`;

export const SAVE_FAILED = 'Could not save. Try again.';

/**
 * Runs a mark action for the timetable controls: null on success, else the
 * message to show (the refusal, or SAVE_FAILED when the call itself failed,
 * e.g. offline or a server error).
 */
export async function markActionError(
  run: () => Promise<{ ok: boolean; message: string }>,
): Promise<string | null> {
  try {
    const r = await run();
    return r.ok ? null : r.message;
  } catch {
    return SAVE_FAILED;
  }
}

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

/** `Wed 21 Oct` of a wall Date. */
export const wallShortDate = (d: Date): string =>
  `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;

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

/** "Last synced: …", or a plain note that the stored classes are shown. */
export function syncLine(lastOkAt: Date | null): string {
  return lastOkAt
    ? `Last synced: ${formatSyncTime(lastOkAt)}`
    : 'Not synced from UniTime yet. The timetable shows the classes stored so far.';
}

/* ---------- My groups ---------- */

/** The My groups tab of the current mode (simple links stay under /s). */
export const myGroupsHref = (simple: boolean) =>
  simple ? '/s/plan?tab=groups' : '/plan?tab=groups';

/**
 * Help of the My groups form. It must say what `filterMyGroups` does: with a
 * group picked anywhere, lectures stay, only the picked group of each picked
 * class stays, and group sessions of classes left unpicked are hidden.
 */
export const MY_GROUPS_HELP =
  'Pick your group in each class that is split into groups. Until you pick one, the week view shows every group. Once you do, it shows lectures and only the groups you picked; group sessions of classes left on "All groups (not picked)" are hidden. Your choice is saved to your account.';

/**
 * Sessions `filterMyGroups` hides only because their class has no pick (not
 * the other groups of a picked class), with the subject codes to pick for.
 */
export function unpickedHidden(
  sessions: PlanSession[],
  g: MyGroups,
): { count: number; codes: string[] } {
  if (Object.keys(g).length === 0) return { count: 0, codes: [] };
  const kept = new Set(filterMyGroups(sessions, g));
  const hidden = sessions.filter(
    (s) => !kept.has(s) && g[String(s.classId)] === undefined,
  );
  return {
    count: hidden.length,
    codes: [...new Set(hidden.map((s) => s.subjectCode))],
  };
}

/** "N classes hidden: pick a group for AM2, BD…" (at most three codes). */
export function hiddenNote(h: { count: number; codes: string[] }): string {
  const shown = h.codes.slice(0, 3).join(', ');
  const more = h.codes.length > 3 ? '…' : '';
  return `${plural(h.count, 'class', 'classes')} hidden: pick a group for ${shown}${more}`;
}

/** The timetable's filter chip: the chosen semester and My groups, or null. */
export function planFilterLabel(
  semester: number | null,
  myGroups: boolean,
): string | null {
  const parts = [
    ...(semester === null ? [] : [`Semester ${semester}`]),
    ...(myGroups ? ['My groups'] : []),
  ];
  return parts.length ? `Filter: ${parts.join(' · ')}` : null;
}

/** "Showing all groups. Pick yours": no group saved, and the week has groups. */
export function showAllGroupsPrompt(
  sessions: PlanSession[],
  g: MyGroups,
): boolean {
  return (
    Object.keys(g).length === 0 && sessions.some((s) => s.groupId !== null)
  );
}
