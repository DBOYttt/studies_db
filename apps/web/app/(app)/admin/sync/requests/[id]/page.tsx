import { FileText } from '@phosphor-icons/react/dist/ssr';
import { type AdminRequestKind, getAdminBotRequest } from '@studies/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { box, boxHead, link } from '@/components/admin/form-styles';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { formatAuditTime } from '@/lib/admin-audit';
import {
  REQUEST_KIND_LABELS,
  requestHref,
  requestStatusLabel,
} from '@/lib/admin-sync';
import { getDb } from '@/lib/db';
import { parseEntityId } from '@/lib/entity-page';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

const time = (d: Date | null) =>
  d ? formatAuditTime(d) : <span className="text-faint">—</span>;

/**
 * /admin/sync/requests/[id]: one admin bot request (setup, its preview or a
 * resync) with its full text report, loaded only here and not on the Sync
 * page. Unknown ids and non-admin requests are 404.
 */
export default async function AdminSyncRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const id = parseEntityId((await params).id);
  if (id === null) notFound();
  const req = await getAdminBotRequest(getDb(), id);
  if (!req) notFound();
  const status = requestStatusLabel(req);
  const kind = REQUEST_KIND_LABELS[req.kind as AdminRequestKind] ?? req.kind;

  const facts: [string, ReactNode][] = [
    [
      'Requested by',
      req.requesterName ?? <span className="text-faint">—</span>,
    ],
    ['Created', time(req.createdAt)],
    ['Started', time(req.startedAt)],
    ['Finished', time(req.finishedAt)],
  ];

  return (
    <>
      <ScreenHeader
        crumbs={[
          ADMIN_CRUMB,
          { label: 'Sync', href: '/admin/sync' },
          { label: `Request #${id}`, href: requestHref(id) },
        ]}
        tabs={adminTabs('sync')}
      />
      <div className="flex max-w-[1200px] flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">
            {kind}
            <span className="ml-2 font-mono text-sm font-normal text-faint">
              #{id}
            </span>
          </h1>
          <Link href="/admin/sync" className={link}>
            Back to Sync
          </Link>
        </div>

        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">Status</dt>
          <dd className="m-0 font-mono font-semibold">{status}</dd>
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 tabular-nums">{v}</dd>
            </div>
          ))}
          {req.error && (
            <div className="contents">
              <dt className="text-muted">Result</dt>
              <dd className={`m-0 ${status === 'failed' ? 'text-err-fg' : ''}`}>
                {req.error}
              </dd>
            </div>
          )}
        </dl>

        <section aria-labelledby="admin-sync-report" className={box}>
          <div className={boxHead}>
            <FileText size={15} className="text-accent-ink" aria-hidden />
            <h2
              id="admin-sync-report"
              className="m-0 text-[13px] font-semibold"
            >
              Report
            </h2>
          </div>
          {req.report ? (
            <pre className="m-0 max-h-[70vh] overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap">
              {req.report}
            </pre>
          ) : (
            <p className="m-0 px-3 py-4 text-muted">
              {req.status === 'queued' || req.status === 'running'
                ? 'The report appears when the bot has finished.'
                : 'This request has no report.'}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
