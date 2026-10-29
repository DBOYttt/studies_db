/** Pure helpers of the /admin/sync page (admin bot requests). */
import type { AdminRequestKind } from '@studies/db';

export const REQUEST_KIND_LABELS: Record<AdminRequestKind, string> = {
  setup: 'Setup',
  setup_dry_run: 'Setup preview',
  resync: 'Fetch from Discord',
};

/** A request still queued this long after it was made has no bot to take it. */
export const STALE_AFTER_MS = 60_000;
export const STALE_TEXT = 'The bot is not responding. Is it running?';

type Req = { status: string; createdAt: Date };

export const isStaleRequest = (r: Req, now: Date): boolean =>
  r.status === 'queued' &&
  now.getTime() - r.createdAt.getTime() > STALE_AFTER_MS;

/** The stale notice when any queued request is stale, else null. */
export const staleNotice = (rs: Req[], now: Date): string | null =>
  rs.some((r) => isStaleRequest(r, now)) ? STALE_TEXT : null;

/** A request is queued or running: new ones are refused, the page refreshes. */
export const hasActiveRequest = (rs: { status: string }[]): boolean =>
  rs.some((r) => r.status === 'queued' || r.status === 'running');
