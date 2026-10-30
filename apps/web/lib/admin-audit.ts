/** Pure helpers for the /admin "Audit log" screens. */
import { EVENT_KINDS, type EventKind } from '@studies/db/constants';
import { fixSept, MONTHS_SHORT } from '@studies/db/text';
import { AUDIT_LABELS, auditSummary } from './event-view';
import { historyLabel } from './sql-editor';

export const AUDIT_PAGE_SIZE = 50;

/** Audit actions of the admin panel (the Action filter's options). */
export const AUDIT_ACTIONS = [
  'sql.execute',
  'sql.rejected',
  'subject.add',
  'subject.edit',
  'class.edit',
  'lecturer.add',
  'lecturer.edit',
  'lecturer.assign',
  'lecturer.unassign',
  'user.ban',
  'user.unban',
  'plan.sync',
  'bot.request',
  'bot.request_cancel',
  'bot.setup',
  'bot.setup_dry_run',
  'bot.resync',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'sql.execute': 'SQL executed',
  'sql.rejected': 'SQL rejected',
  'subject.add': 'Subject added',
  'subject.edit': 'Subject changed',
  'class.edit': 'Class changed',
  'lecturer.add': 'Lecturer added',
  'lecturer.edit': 'Lecturer changed',
  'lecturer.assign': 'Lecturer assigned',
  'lecturer.unassign': 'Lecturer unassigned',
  'user.ban': 'Access blocked',
  'user.unban': 'Access unblocked',
  'plan.sync': 'Timetable sync requested',
  'bot.request': 'Bot request queued',
  'bot.request_cancel': 'Bot request cancelled',
  'bot.setup': 'Server set up',
  'bot.setup_dry_run': 'Server setup previewed',
  'bot.resync': 'Resync',
};

/** Plain names of every action the web, bot and db write (`admin_audit`). */
const ACTION_NAMES: Record<string, string> = {
  ...AUDIT_ACTION_LABELS,
  ...AUDIT_LABELS,
  'class_mark.add': 'Entry quiz turned on',
  'class_mark.edit': 'Entry quiz note changed',
  'class_mark.remove': 'Entry quiz turned off',
  'class_mark.restore': 'Entry quiz restored',
  'class_mark.skip': 'Entry quiz: not this week',
  'class_mark.unskip': 'Entry quiz: skip undone',
  'reminders.update': 'Reminders changed',
};

/** The plain name of an audit action; an unknown one stays its raw key. */
export const auditActionLabel = (action: string): string =>
  ACTION_NAMES[action] ?? action;

export interface AuditQuery {
  page: number;
  userId?: number;
  action?: AuditAction;
  /**
   * `?who=admins` (or `?user=admins`, the User select's "Admins only"):
   * only rows of current admins (default: everyone).
   */
  adminsOnly?: boolean;
}

type SP = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) =>
  typeof v === 'string' ? v : undefined;
const posInt = (v: string | undefined) =>
  v !== undefined && /^[1-9]\d{0,8}$/.test(v) ? Number(v) : undefined;

/** `?user=&action=&page=` of /admin/audit; invalid values are dropped. */
export function parseAuditQuery(sp: SP): AuditQuery {
  const q: AuditQuery = { page: posInt(one(sp.page)) ?? 1 };
  const user = one(sp.user);
  const userId = posInt(user);
  if (userId !== undefined) q.userId = userId;
  const action = one(sp.action);
  if (AUDIT_ACTIONS.includes(action as AuditAction))
    q.action = action as AuditAction;
  if (one(sp.who) === 'admins' || user === 'admins') q.adminsOnly = true;
  return q;
}

export function auditHref(q: AuditQuery): string {
  const p = new URLSearchParams();
  if (q.userId !== undefined) p.set('user', String(q.userId));
  if (q.action) p.set('action', q.action);
  if (q.adminsOnly) p.set('who', 'admins');
  if (q.page > 1) p.set('page', String(q.page));
  const s = p.toString();
  return s ? `/admin/audit?${s}` : '/admin/audit';
}

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

/** Audit time as `D Mon YYYY, HH:mm:ss CET` (or CEST) in Europe/Warsaw. */
export const formatAuditTime = (d: Date | string): string =>
  fixSept(timeFmt.format(typeof d === 'string' ? new Date(d) : d));

/** One-line statement cut to 120 characters for the log table. */
export const auditStatementPreview = (s: string | null): string =>
  s ? historyLabel(s, 120) : '';

/** What an audit row's target points at, when the app can name it. */
export type AuditTargetRef =
  | { type: 'event'; id: number }
  | { type: 'series'; id: number }
  | { type: 'class_mark'; id: number }
  | { type: 'subject'; code: string };

/** Actions whose target is a subject code (bot admin panel). */
const SUBJECT_ACTIONS = new Set([
  'subject.add',
  'subject.edit',
  'class.edit',
  'lecturer.assign',
  'lecturer.unassign',
]);

/**
 * The thing an audit row is about: `14` of an `event.*` row is event 14,
 * `series:3` a series, `class_mark:3` an entry quiz, a subject code of the
 * subject/class actions. Anything else (tables, user ids) is null and is
 * shown as stored.
 */
export function parseAuditTarget(
  action: string,
  target: string | null,
): AuditTargetRef | null {
  if (!target) return null;
  const m = /^(series|event|class_mark):([1-9]\d{0,9})$/.exec(target);
  if (m) {
    const type = m[1] as 'series' | 'event' | 'class_mark';
    return { type, id: Number(m[2]) };
  }
  if (action.startsWith('event.') && /^[1-9]\d{0,9}$/.test(target))
    return { type: 'event', id: Number(target) };
  if (SUBJECT_ACTIONS.has(action)) return { type: 'subject', code: target };
  return null;
}

/** An event as one audit target: `Test: Kolokwium 1 ASD, 26 Oct` (wall time). */
export function eventTargetLabel(e: {
  kind: EventKind;
  title: string;
  subjectCode: string | null;
  startsAt: Date;
}): string {
  const day = `${e.startsAt.getUTCDate()} ${MONTHS_SHORT[e.startsAt.getUTCMonth()]}`;
  const subject = e.subjectCode ? ` ${e.subjectCode}` : '';
  return `${EVENT_KINDS[e.kind].label}: ${e.title}${subject}, ${day}`;
}

/**
 * The Details column: the statement of SQL rows, else a one-line summary
 * of the details (changed fields, source).
 */
export function auditDetails(r: {
  action: string;
  statement: string | null;
  details: unknown;
}): string {
  if (r.statement) return auditStatementPreview(r.statement);
  return auditSummary(r.action, r.details);
}
