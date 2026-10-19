import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { getAudit } from '@studies/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditActionLabel } from '@/components/admin/AuditTable';
import { SqlText } from '@/components/SqlText';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { formatAuditTime } from '@/lib/admin-audit';
import { getDb } from '@/lib/db';
import { parseEntityId } from '@/lib/entity-page';
import { requireAdmin } from '@/lib/session';
import { userHref } from '@/lib/view-links';

export const dynamic = 'force-dynamic';

const dt = 'text-muted';
const dd = 'm-0 min-w-0';

/** /admin/audit/[id]: one audit entry with its full statement and details. */
export default async function AdminAuditEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const id = parseEntityId((await params).id);
  if (id === null) notFound();
  const row = await getAudit(getDb(), id);
  if (!row) notFound();
  const href = `/admin/audit/${row.id}`;
  const details =
    row.details === null || row.details === undefined
      ? null
      : JSON.stringify(row.details, null, 2);

  return (
    <>
      <ScreenHeader
        crumbs={[
          ADMIN_CRUMB,
          { label: 'Audit log', href: '/admin/audit' },
          { kind: 'Entry:', label: `#${row.id}`, href },
        ]}
        tabs={adminTabs('audit')}
      />
      <div className="flex max-w-4xl flex-col gap-4">
        <Link
          href="/admin/audit"
          className="inline-flex items-center gap-1 self-start text-accent-ink hover:text-accent-ink-hover hover:underline"
        >
          <ArrowLeft size={13} aria-hidden />
          Audit log
        </Link>
        <h1 className="m-0 flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
          Entry #{row.id}
          <AuditActionLabel action={row.action} />
        </h1>

        <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 rounded-md border border-line-strong px-3.5 py-3">
          <dt className={dt}>Time</dt>
          <dd className={`${dd} font-mono tabular-nums`}>
            {formatAuditTime(row.createdAt)}{' '}
            <span className="text-faint">(Europe/Warsaw)</span>
          </dd>
          <dt className={dt}>Admin</dt>
          <dd className={dd}>
            <Link
              href={userHref(row.userId)}
              className="text-accent-ink hover:text-accent-ink-hover hover:underline"
            >
              {row.userName}
            </Link>
          </dd>
          <dt className={dt}>Table</dt>
          <dd className={`${dd} font-mono`}>
            {row.target ?? <span className="text-faint">—</span>}
          </dd>
          <dt className={dt}>Rows changed</dt>
          <dd className={`${dd} font-mono tabular-nums`}>
            {row.rowsAffected ?? <span className="text-faint">—</span>}
          </dd>
        </dl>

        <section
          aria-labelledby="audit-statement"
          className="flex flex-col gap-1.5"
        >
          <h2 id="audit-statement" className="m-0 text-[13px] font-semibold">
            Statement
          </h2>
          {row.statement ? (
            <pre className="m-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-strong bg-surface px-3 py-2.5 font-mono text-[12.5px]">
              <SqlText sql={row.statement} />
            </pre>
          ) : (
            <p className="m-0 text-muted">No statement.</p>
          )}
        </section>

        {details && (
          <section
            aria-labelledby="audit-details"
            className="flex flex-col gap-1.5"
          >
            <h2 id="audit-details" className="m-0 text-[13px] font-semibold">
              Details
            </h2>
            <pre className="m-0 overflow-auto rounded-md border border-line-strong bg-surface px-3 py-2.5 font-mono text-[12.5px]">
              {details}
            </pre>
          </section>
        )}
      </div>
    </>
  );
}
