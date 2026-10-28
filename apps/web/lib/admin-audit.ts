/** Pure helpers for the /admin "Audit log" screens. */
import { fixSept } from '@studies/db/text';
import { AUDIT_LABELS } from './event-view';
import { historyLabel } from './sql-editor';

export const AUDIT_PAGE_SIZE = 50;

/** Audit actions written this round (filter options). */
export const AUDIT_ACTIONS = ['sql.execute', 'sql.rejected'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'sql.execute': 'SQL executed',
  'sql.rejected': 'SQL rejected',
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
  'user.ban': 'Access blocked',
  'user.unban': 'Access unblocked',
  'reminders.update': 'Reminders changed',
  'bot.setup': 'Server set up',
  'bot.setup_dry_run': 'Server setup previewed',
  'bot.resync': 'Resync',
  'plan.sync': 'Timetable sync requested',
  'subject.add': 'Subject added',
  'subject.edit': 'Subject changed',
  'class.edit': 'Class changed',
  'lecturer.add': 'Lecturer added',
  'lecturer.edit': 'Lecturer changed',
  'lecturer.assign': 'Lecturer assigned',
};

/** The plain name of an audit action; an unknown one stays its raw key. */
export const auditActionLabel = (action: string): string =>
  ACTION_NAMES[action] ?? action;

export interface AuditQuery {
  page: number;
  userId?: number;
  action?: AuditAction;
  /** `?who=admins`: only rows of current admins (default: everyone). */
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
  const userId = posInt(one(sp.user));
  if (userId !== undefined) q.userId = userId;
  const action = one(sp.action);
  if (AUDIT_ACTIONS.includes(action as AuditAction))
    q.action = action as AuditAction;
  if (one(sp.who) === 'admins') q.adminsOnly = true;
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
});

/** Audit time as `D Mon YYYY, HH:mm:ss` in Europe/Warsaw. */
export const formatAuditTime = (d: Date | string): string =>
  fixSept(timeFmt.format(typeof d === 'string' ? new Date(d) : d));

/** One-line statement cut to 120 characters for the log table. */
export const auditStatementPreview = (s: string | null): string =>
  s ? historyLabel(s, 120) : '';
