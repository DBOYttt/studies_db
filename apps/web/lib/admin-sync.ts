/** Pure helpers of the /admin/sync page (admin bot requests). */
import {
  type AdminRequestKind,
  type Db,
  isCancelled,
  listFeeds,
  maskFeedUrl,
  SEMESTERS,
  STUCK_AFTER_MS,
} from '@studies/db';

export const REQUEST_KIND_LABELS: Record<AdminRequestKind, string> = {
  setup: 'Setup',
  setup_dry_run: 'Setup preview',
  resync: 'Fetch from Discord',
};

/** A request still queued this long after it was made has no bot to take it. */
export const STALE_AFTER_MS = 60_000;
export const STALE_TEXT = 'The bot is not responding. Is it running?';
/** A request `running` for more than STUCK_AFTER_MS (it can then be cancelled). */
export const STUCK_TEXT =
  'The bot has been working on this request for more than 15 minutes. It may be stuck: cancel it or restart the bot.';

type Req = { status: string; createdAt: Date; startedAt?: Date | null };

const isStuck = (r: Req, now: Date): boolean =>
  r.status === 'running' &&
  r.startedAt != null &&
  now.getTime() - r.startedAt.getTime() > STUCK_AFTER_MS;

const isUnclaimed = (r: Req, now: Date): boolean =>
  r.status === 'queued' &&
  now.getTime() - r.createdAt.getTime() > STALE_AFTER_MS;

/** Queued for more than 60 s (no bot), or running for more than 15 min (stuck). */
export const isStaleRequest = (r: Req, now: Date): boolean =>
  isUnclaimed(r, now) || isStuck(r, now);

/** The notice for a stuck or unclaimed request, else null. */
export const staleNotice = (rs: Req[], now: Date): string | null => {
  if (rs.some((r) => isStuck(r, now))) return STUCK_TEXT;
  return rs.some((r) => isUnclaimed(r, now)) ? STALE_TEXT : null;
};

/** Queued, or running but stuck (the same rule as cancelAdminBotRequest). */
export const canCancelRequest = (r: Req, now: Date): boolean =>
  r.status === 'queued' || isStuck(r, now);

/** A request is queued or running: new ones are refused, the page refreshes. */
export const hasActiveRequest = (rs: { status: string }[]): boolean =>
  rs.some((r) => r.status === 'queued' || r.status === 'running');

/** The Discord panel's header line while a request is queued or running. */
export const activeRequestText = (rs: { status: string }[]): string | null => {
  if (rs.some((r) => r.status === 'running')) return 'A request is in progress';
  if (rs.some((r) => r.status === 'queued')) return 'A request is queued';
  return null;
};

/** The status shown in the table: a cancelled request is not an error. */
export const requestStatusLabel = (r: {
  status: string;
  error: string | null;
}): string => (isCancelled(r) ? 'cancelled' : r.status);

const countFmt = new Intl.NumberFormat('en-US');

export const reportLabel = (chars: number): string =>
  `Report (${countFmt.format(chars)} chars)`;

export const requestHref = (id: number): string => `/admin/sync/requests/${id}`;

export type FeedRow = {
  semester: number;
  classMasked: string | null;
  examMasked: string | null;
  updatedAt: Date | null;
};

/**
 * One row per semester (always 7) for the Timetable feeds card. Only the
 * masked form of a link leaves this function: the stored link is a secret.
 */
export async function loadFeedRows(db: Db): Promise<FeedRow[]> {
  const stored = new Map((await listFeeds(db)).map((f) => [f.semester, f]));
  return SEMESTERS.map((semester) => {
    const f = stored.get(semester);
    return {
      semester,
      classMasked: f ? maskFeedUrl(f.classUrl) : null,
      examMasked: f?.examUrl ? maskFeedUrl(f.examUrl) : null,
      updatedAt: f?.updatedAt ?? null,
    };
  });
}
