import { ArrowRight, ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { AuditTable } from '@/components/admin/AuditTable';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { loadAuditTargets } from '@/lib/admin-audit-targets';
import { getAdminOverview } from '@/lib/admin-overview';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { userHref } from '@/lib/view-links';

export const dynamic = 'force-dynamic';

const box = 'overflow-hidden rounded-md border border-line-strong';
const boxHead =
  'flex items-center gap-1.5 border-b border-line-strong bg-box-head px-3 py-[7px]';

/** /admin "Overview": counts, admins and the newest audit entries. */
export default async function AdminOverviewPage() {
  await requireAdmin();
  const db = getDb();
  const { admins, recent, counts } = await getAdminOverview(db);
  const targets = await loadAuditTargets(db, recent);
  const stats: [string, number, string?][] = [
    ['Subjects', counts.subjects],
    ['Topics', counts.topics],
    ['Ready files', counts.readyFiles],
    ['Jobs queued', counts.jobsQueued],
    [
      'Jobs failed',
      counts.jobsFailed,
      counts.jobsFailed > 0 ? 'text-err-fg' : undefined,
    ],
  ];
  return (
    <>
      <ScreenHeader crumbs={[ADMIN_CRUMB]} tabs={adminTabs('overview')} />
      <div className="flex max-w-[1200px] flex-col gap-4">
        <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">
          Admin panel
        </h1>

        {/* Cells draw right/bottom dividers; the -1px margins push the
            outer ones under the box border, whatever the wrap. */}
        <div className={box}>
          <dl
            aria-label="Database status"
            className="-mr-px -mb-px flex flex-wrap"
          >
            {stats.map(([label, value, tone]) => (
              <div
                key={label}
                className="flex min-w-[150px] flex-1 flex-col gap-0.5 border-r border-b border-line px-3.5 py-3"
              >
                <dt className="text-xs text-muted">{label}</dt>
                <dd
                  className={`m-0 font-mono text-[22px] font-semibold tracking-[-0.02em] tabular-nums ${tone ?? 'text-fg'}`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <section
            aria-labelledby="admin-recent"
            className="flex min-w-0 flex-col gap-2"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="admin-recent" className="m-0 text-[15px] font-semibold">
                Latest audit log entries
              </h2>
              <Link
                href="/admin/audit"
                className="inline-flex items-center gap-1 text-accent-ink hover:text-accent-ink-hover hover:underline"
              >
                Full audit log
                <ArrowRight size={13} aria-hidden />
              </Link>
            </div>
            <AuditTable
              rows={recent}
              targets={targets}
              emptyText="The audit log is empty. Changes from the SQL — write console will appear here."
            />
          </section>

          <section aria-labelledby="admin-admins" className={box}>
            <div className={boxHead}>
              <ShieldCheck size={15} className="text-accent-ink" aria-hidden />
              <h2 id="admin-admins" className="m-0 text-[13px] font-semibold">
                Admins
              </h2>
              <span className="ml-auto font-mono text-[11px] text-faint">
                {admins.length}
              </span>
            </div>
            {admins.length === 0 ? (
              <p className="m-0 px-3 py-4 text-muted">No admins.</p>
            ) : (
              <ul>
                {admins.map((a, i) => (
                  <li
                    key={a.id}
                    className={`flex items-center gap-2 border-line px-3 py-2 not-last:border-b ${i % 2 ? 'bg-zebra' : ''}`}
                  >
                    {a.avatarUrl ? (
                      // biome-ignore lint/performance/noImgElement: external Discord CDN avatar
                      <img
                        src={a.avatarUrl}
                        alt=""
                        width={22}
                        height={22}
                        className="size-[22px] rounded-full"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="grid size-[22px] place-items-center rounded-full bg-discord text-[11px] font-semibold text-white"
                      >
                        {(
                          [...a.displayName.trim()][0] ?? '?'
                        ).toLocaleUpperCase('pl')}
                      </span>
                    )}
                    <Link
                      href={userHref(a.id)}
                      className="min-w-0 truncate text-accent-ink hover:text-accent-ink-hover hover:underline"
                    >
                      {a.displayName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
