import {
  ArrowsClockwise,
  CalendarBlank,
  DiscordLogo,
  LinkSimple,
  ListChecks,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import {
  type AdminRequestKind,
  BOT_BUSY_MESSAGE,
  getPlanSyncStatus,
  listAdminBotRequests,
  planStatusText,
} from '@studies/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionButton } from '@/components/admin/ActionButton';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { FeedsCard } from '@/components/admin/FeedsCard';
import { box, boxHead, link, td, th } from '@/components/admin/form-styles';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import {
  cancelBotRequestAction,
  requestBotAction,
  requestPlanSyncAction,
} from '@/lib/admin-actions';
import { formatAuditTime } from '@/lib/admin-audit';
import {
  activeRequestText,
  canCancelRequest,
  hasActiveRequest,
  loadFeedRows,
  REQUEST_KIND_LABELS,
  reportLabel,
  requestHref,
  requestStatusLabel,
  staleNotice,
} from '@/lib/admin-sync';
import { getDb } from '@/lib/db';
import { adminMetadata } from '@/lib/page-meta';
import { requireAdmin } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('Sync · Admin');
}

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  queued: 'text-warn-fg',
  running: 'text-accent-ink',
  done: 'text-ok-fg',
  failed: 'text-err-fg',
  cancelled: 'text-muted',
};

const kindLabel = (k: string) =>
  REQUEST_KIND_LABELS[k as AdminRequestKind] ?? k;
const time = (d: Date | null) =>
  d ? formatAuditTime(d) : <span className="text-faint">—</span>;

/**
 * /admin/sync: the timetable sync (worker) and the Discord server requests
 * (bot): setup preview, setup and resync, queued in `bot_requests` and run
 * by the bot one at a time. The page refreshes itself while one is queued
 * or running. Reports are not loaded here (the list refreshes every few
 * seconds): each links to /admin/sync/requests/[id].
 */
export default async function AdminSyncPage() {
  await requireAdmin();
  const db = getDb();
  const [plan, requests, feedRows] = await Promise.all([
    getPlanSyncStatus(db),
    listAdminBotRequests(db, 20),
    loadFeedRows(db),
  ]);
  const now = new Date();
  const active = hasActiveRequest(requests);
  const activeText = activeRequestText(requests);
  const activeId = requests.find(
    (r) => r.status === 'queued' || r.status === 'running',
  )?.id;
  const stale = staleNotice(requests, now);
  const planPending =
    plan.requestedAt !== null &&
    (plan.lastRunAt === null || plan.requestedAt > plan.lastRunAt);

  const botButtons: {
    kind: AdminRequestKind;
    label: string;
    help: string;
    confirm?: { question: string; confirmLabel: string };
    primary?: boolean;
  }[] = [
    {
      kind: 'setup_dry_run',
      label: 'Preview changes',
      help: 'Lists what setup would create or change, without touching the server.',
    },
    {
      kind: 'setup',
      label: 'Run setup',
      help: 'Creates the missing forums, tags, roles and panels from the database.',
      confirm: {
        question: 'Run setup on the Discord server now?',
        confirmLabel: 'Confirm setup',
      },
      primary: true,
    },
    {
      kind: 'resync',
      label: 'Fetch from Discord',
      help: 'Reads the forums again and stores posts and files the database is missing.',
    },
  ];

  return (
    <>
      <ScreenHeader
        crumbs={[ADMIN_CRUMB, { label: 'Sync', href: '/admin/sync' }]}
        tabs={adminTabs('sync')}
      />
      <AutoRefresh active={active} />
      <div className="flex max-w-[1200px] flex-col gap-4">
        <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">Sync</h1>

        {stale && (
          <p
            role="alert"
            className="m-0 flex items-center gap-2 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
          >
            <Warning size={16} aria-hidden />
            {stale}
          </p>
        )}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <section aria-labelledby="admin-sync-plan" className={box}>
            <div className={boxHead}>
              <CalendarBlank
                size={15}
                className="text-accent-ink"
                aria-hidden
              />
              <h2
                id="admin-sync-plan"
                className="m-0 text-[13px] font-semibold"
              >
                Timetable
              </h2>
            </div>
            <div className="flex flex-col gap-3 px-3 py-3">
              <p className="m-0 whitespace-pre-line tabular-nums">
                {planStatusText(plan, now)}
              </p>
              {planPending && (
                <p className="m-0 text-muted">
                  A sync is requested and waits for the worker (within a minute
                  while it runs). Reload to see the result.
                </p>
              )}
              <ActionButton
                action={requestPlanSyncAction}
                label="Sync timetable"
                pendingLabel="Requesting…"
                icon={<ArrowsClockwise size={14} aria-hidden />}
              />
            </div>
          </section>

          <section aria-labelledby="admin-sync-bot" className={box}>
            <div className={boxHead}>
              <DiscordLogo size={15} className="text-accent-ink" aria-hidden />
              <h2 id="admin-sync-bot" className="m-0 text-[13px] font-semibold">
                Discord server
              </h2>
              {activeText && (
                <span className="ml-auto text-xs text-muted">{activeText}</span>
              )}
            </div>
            <ul className="m-0 flex flex-col p-0">
              {botButtons.map((b) => (
                <li
                  key={b.kind}
                  className="flex flex-col gap-2 border-b border-line px-3 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                >
                  <p className="m-0 max-w-[48ch] text-muted">{b.help}</p>
                  <ActionButton
                    // A new instance when the queue changes, so an old
                    // "Request queued" line never outlives its request.
                    key={`${b.kind}-${activeId ?? 'idle'}`}
                    action={requestBotAction}
                    fields={{ kind: b.kind }}
                    label={b.label}
                    pendingLabel="Queuing…"
                    variant={b.primary ? 'primary' : 'secondary'}
                    confirm={b.confirm}
                    disabled={active}
                    disabledText={BOT_BUSY_MESSAGE}
                    className="flex shrink-0 flex-col items-start sm:items-end"
                  />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section aria-labelledby="admin-sync-feeds" className={box}>
          <div className={boxHead}>
            <LinkSimple size={15} className="text-accent-ink" aria-hidden />
            <h2 id="admin-sync-feeds" className="m-0 text-[13px] font-semibold">
              Timetable feeds
            </h2>
          </div>
          <p className="m-0 border-b border-line px-3 py-2 text-muted">
            One UniTime iCal link per semester. Links are secret: only the host
            and the last 4 characters are shown. A semester&apos;s feed replaces
            the sessions the env feed imported for that semester; semesters
            without a feed keep theirs. Clearing a semester removes its imported
            sessions at the next successful sync.
          </p>
          <FeedsCard
            rows={feedRows.map((r) => ({
              semester: r.semester,
              classMasked: r.classMasked,
              examMasked: r.examMasked,
              updated: r.updatedAt ? formatAuditTime(r.updatedAt) : null,
            }))}
          />
        </section>

        <section aria-labelledby="admin-sync-requests" className={box}>
          <div className={boxHead}>
            <ListChecks size={15} className="text-accent-ink" aria-hidden />
            <h2
              id="admin-sync-requests"
              className="m-0 text-[13px] font-semibold"
            >
              Bot requests
            </h2>
            <span className="ml-auto text-[11px] text-faint">
              latest {requests.length}
            </span>
          </div>
          {requests.length === 0 ? (
            <p className="m-0 px-3 py-4 text-muted">
              No requests yet. Preview changes to see what setup would do.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Status</th>
                    <th className={th}>Request</th>
                    <th className={th}>Requested by</th>
                    <th className={th}>Created</th>
                    <th className={th}>Started</th>
                    <th className={th}>Finished</th>
                    <th className={th}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r, i) => {
                    const status = requestStatusLabel(r);
                    const cancellable = canCancelRequest(r, now);
                    return (
                      <tr key={r.id} className={i % 2 ? 'bg-zebra' : ''}>
                        <td className={`${td} whitespace-nowrap`}>
                          <span
                            className={`font-mono font-semibold ${STATUS_TONE[status] ?? ''}`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          {kindLabel(r.kind)}
                          <span className="ml-1 font-mono text-[11px] text-faint">
                            #{r.id}
                          </span>
                        </td>
                        <td className={td}>
                          {r.requesterName ?? (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className={`${td} whitespace-nowrap tabular-nums`}>
                          {time(r.createdAt)}
                        </td>
                        <td className={`${td} whitespace-nowrap tabular-nums`}>
                          {time(r.startedAt)}
                        </td>
                        <td className={`${td} whitespace-nowrap tabular-nums`}>
                          {time(r.finishedAt)}
                        </td>
                        <td className={`${td} min-w-[220px]`}>
                          <div className="flex flex-col items-start gap-1.5">
                            {r.error && (
                              <span
                                className={
                                  status === 'failed'
                                    ? 'text-err-fg'
                                    : 'text-muted'
                                }
                              >
                                {r.error}
                              </span>
                            )}
                            {r.reportChars > 0 && (
                              <Link href={requestHref(r.id)} className={link}>
                                {reportLabel(r.reportChars)}
                              </Link>
                            )}
                            {cancellable && (
                              <ActionButton
                                action={cancelBotRequestAction}
                                fields={{ id: String(r.id) }}
                                label="Cancel"
                                pendingLabel="Cancelling…"
                              />
                            )}
                            {!r.error &&
                              r.reportChars === 0 &&
                              !cancellable && (
                                <span className="text-faint">—</span>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
