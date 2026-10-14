import { Prohibit } from '@phosphor-icons/react/dist/ssr';
import { AdminSqlConsole } from '@/components/admin/AdminSqlConsole';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { CONFIRM_THRESHOLD } from '@/lib/admin-sql';
import { getRwPool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

const MAX_PREFILL = 4000;

/** /admin/sql "SQL — zapis": the audited write console. */
export default async function AdminSqlPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  // Prefill only ("Edytuj w konsoli SQL"): never previewed or run on load.
  const initialQuery =
    typeof q === 'string' && q.trim() ? q.slice(0, MAX_PREFILL) : undefined;
  const enabled = getRwPool() !== null;
  return (
    <>
      <ScreenHeader
        crumbs={[ADMIN_CRUMB, { label: 'SQL — zapis', href: '/admin/sql' }]}
        tabs={adminTabs('sql')}
      />
      {enabled ? (
        <AdminSqlConsole
          key={initialQuery ?? ''}
          initialQuery={initialQuery}
          confirmThreshold={CONFIRM_THRESHOLD}
        />
      ) : (
        <div
          role="status"
          className="flex max-w-3xl items-start gap-2 rounded-md border border-line-strong bg-surface px-3 py-2.5"
        >
          <Prohibit
            size={16}
            className="mt-0.5 shrink-0 text-muted"
            aria-hidden
          />
          <div>
            <p className="m-0 font-semibold">
              Konsola zapisu wyłączona (brak DATABASE_RW_URL)
            </p>
            <p className="mt-0.5 mb-0 text-pretty text-muted">
              Ustaw <code className="font-mono">DATABASE_RW_URL</code>{' '}
              (użytkownik <code className="font-mono">studies_rw</code>) i
              uruchom serwer ponownie. Do odczytu służy zwykła konsola SQL.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
