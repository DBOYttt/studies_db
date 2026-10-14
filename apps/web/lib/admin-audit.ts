/** Pure helpers for the /admin "Dziennik" (audit log) screens. */
import { historyLabel } from './sql-editor';

export const AUDIT_PAGE_SIZE = 50;

/** Audit actions written this round (filter options). */
export const AUDIT_ACTIONS = ['sql.execute', 'sql.rejected'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'sql.execute': 'Wykonanie SQL',
  'sql.rejected': 'Odrzucone SQL',
};

export interface AuditQuery {
  page: number;
  userId?: number;
  action?: AuditAction;
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
  return q;
}

export function auditHref(q: AuditQuery): string {
  const p = new URLSearchParams();
  if (q.userId !== undefined) p.set('user', String(q.userId));
  if (q.action) p.set('action', q.action);
  if (q.page > 1) p.set('page', String(q.page));
  const s = p.toString();
  return s ? `/admin/audit?${s}` : '/admin/audit';
}

const timeFmt = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Audit time as `DD.MM.YYYY, HH:mm:ss` in Europe/Warsaw. */
export const formatAuditTime = (d: Date | string): string =>
  timeFmt.format(typeof d === 'string' ? new Date(d) : d);

/** One-line statement cut to 120 characters for the log table. */
export const auditStatementPreview = (s: string | null): string =>
  s ? historyLabel(s, 120) : '';
