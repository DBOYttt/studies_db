import { listAdmins, listAudit } from '@studies/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuditTable } from '@/components/admin/AuditTable';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  auditHref,
  parseAuditQuery,
} from '@/lib/admin-audit';
import { loadAuditTargets } from '@/lib/admin-audit-targets';
import { getDb } from '@/lib/db';
import { plural } from '@/lib/format';
import { adminMetadata } from '@/lib/page-meta';
import { requireAdmin } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('Audit log · Admin');
}

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const control =
  'h-7 rounded border border-line-strong bg-page px-1.5 text-fg focus:border-accent';
const pagerLink =
  'rounded border border-line-strong bg-bar px-2.5 py-1 text-accent-ink hover:bg-row-hover';
const pagerOff =
  'rounded border border-line bg-bar px-2.5 py-1 text-faint opacity-60';

/** /admin/audit "Audit log": paged audit log with user and action filters. */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireAdmin();
  const q = parseAuditQuery(await searchParams);
  const db = getDb();
  const [{ rows, total }, admins] = await Promise.all([
    listAudit(db, {
      limit: AUDIT_PAGE_SIZE,
      offset: (q.page - 1) * AUDIT_PAGE_SIZE,
      userId: q.userId,
      action: q.action,
      adminsOnly: q.adminsOnly,
    }),
    listAdmins(db),
  ]);
  const targets = await loadAuditTargets(db, rows);
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const filtered =
    q.userId !== undefined || q.action !== undefined || q.adminsOnly === true;
  // A filtered user who is no longer an admin still needs an option.
  const userKnown =
    q.userId === undefined || admins.some((a) => a.id === q.userId);

  return (
    <>
      <ScreenHeader
        crumbs={[ADMIN_CRUMB, { label: 'Audit log', href: '/admin/audit' }]}
        tabs={adminTabs('audit')}
      />
      <div className="flex flex-col gap-3">
        <form
          method="get"
          action="/admin/audit"
          aria-label="Audit log filters"
          className="flex flex-wrap items-end gap-3 rounded-md border border-line-strong bg-bar px-3 py-2.5"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">User</span>
            <select
              name="user"
              defaultValue={q.adminsOnly ? 'admins' : (q.userId ?? '')}
              className={control}
            >
              <option value="">Everyone</option>
              <option value="admins">Admins only</option>
              {!userKnown && <option value={q.userId}>#{q.userId}</option>}
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Action</span>
            <select
              name="action"
              defaultValue={q.action ?? ''}
              className={control}
            >
              <option value="">All</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a} — {AUDIT_ACTION_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-7 rounded bg-accent-fill px-3.5 font-semibold text-on-accent hover:bg-accent-fill-hover active:translate-y-px"
          >
            Filter
          </button>
          {filtered && (
            <Link
              href="/admin/audit"
              className="self-center pt-4 text-accent-ink hover:text-accent-ink-hover hover:underline"
            >
              Clear filters
            </Link>
          )}
          <span className="ml-auto self-center pt-4 text-xs text-muted tabular-nums">
            {plural(total, 'entry', 'entries')}
          </span>
        </form>

        <AuditTable
          rows={rows}
          targets={targets}
          emptyText={
            filtered
              ? 'No entries match the selected filters.'
              : 'The audit log is empty.'
          }
        />

        {pageCount > 1 && (
          <nav
            aria-label="Audit log pages"
            className="flex items-center gap-2 tabular-nums"
          >
            {q.page > 1 ? (
              <Link
                href={auditHref({ ...q, page: q.page - 1 })}
                className={pagerLink}
              >
                Previous
              </Link>
            ) : (
              <span className={pagerOff}>Previous</span>
            )}
            <span className="text-muted">
              Page {Math.min(q.page, pageCount)} of {pageCount}
            </span>
            {q.page < pageCount ? (
              <Link
                href={auditHref({ ...q, page: q.page + 1 })}
                className={pagerLink}
              >
                Next
              </Link>
            ) : (
              <span className={pagerOff}>Next</span>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
