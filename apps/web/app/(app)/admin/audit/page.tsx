import { listAdmins, listAudit } from '@studies/db';
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
import { getDb } from '@/lib/db';
import { pluralPl } from '@/lib/format';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const control =
  'h-7 rounded border border-line-strong bg-page px-1.5 text-fg focus:border-accent';
const pagerLink =
  'rounded border border-line-strong bg-bar px-2.5 py-1 text-accent-ink hover:bg-row-hover';
const pagerOff =
  'rounded border border-line bg-bar px-2.5 py-1 text-faint opacity-60';

/** /admin/audit "Dziennik": paged audit log with admin and action filters. */
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
    }),
    listAdmins(db),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const filtered = q.userId !== undefined || q.action !== undefined;
  // A filtered user who is no longer an admin still needs an option.
  const userKnown =
    q.userId === undefined || admins.some((a) => a.id === q.userId);

  return (
    <>
      <ScreenHeader
        crumbs={[ADMIN_CRUMB, { label: 'Dziennik', href: '/admin/audit' }]}
        tabs={adminTabs('audit')}
      />
      <div className="flex flex-col gap-3">
        <form
          method="get"
          action="/admin/audit"
          aria-label="Filtry dziennika"
          className="flex flex-wrap items-end gap-3 rounded-md border border-line-strong bg-bar px-3 py-2.5"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Admin</span>
            <select
              name="user"
              defaultValue={q.userId ?? ''}
              className={control}
            >
              <option value="">Wszyscy</option>
              {!userKnown && <option value={q.userId}>#{q.userId}</option>}
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Akcja</span>
            <select
              name="action"
              defaultValue={q.action ?? ''}
              className={control}
            >
              <option value="">Wszystkie</option>
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
            Filtruj
          </button>
          {filtered && (
            <Link
              href="/admin/audit"
              className="self-center pt-4 text-accent-ink hover:text-accent-ink-hover hover:underline"
            >
              Wyczyść filtry
            </Link>
          )}
          <span className="ml-auto self-center pt-4 text-xs text-muted tabular-nums">
            {total} {pluralPl(total, 'wpis', 'wpisy', 'wpisów')}
          </span>
        </form>

        <AuditTable
          rows={rows}
          emptyText={
            filtered
              ? 'Brak wpisów dla wybranych filtrów.'
              : 'Dziennik jest pusty.'
          }
        />

        {pageCount > 1 && (
          <nav
            aria-label="Strony dziennika"
            className="flex items-center gap-2 tabular-nums"
          >
            {q.page > 1 ? (
              <Link
                href={auditHref({ ...q, page: q.page - 1 })}
                className={pagerLink}
              >
                Poprzednia
              </Link>
            ) : (
              <span className={pagerOff}>Poprzednia</span>
            )}
            <span className="text-muted">
              Strona {Math.min(q.page, pageCount)} z {pageCount}
            </span>
            {q.page < pageCount ? (
              <Link
                href={auditHref({ ...q, page: q.page + 1 })}
                className={pagerLink}
              >
                Następna
              </Link>
            ) : (
              <span className={pagerOff}>Następna</span>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
