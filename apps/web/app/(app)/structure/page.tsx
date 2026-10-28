import {
  Columns,
  Export,
  MagnifyingGlass,
  Rows,
} from '@phosphor-icons/react/dist/ssr';
import { PUBLIC_VIEWS } from '@studies/db/constants';
import Link from 'next/link';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { plural } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { countViewRows, listViewColumns } from '@/lib/tables';

export const dynamic = 'force-dynamic';

const th = 'border-b border-line-strong px-2.5 py-[7px] font-semibold';
const td = 'border-b border-line px-2.5 py-1';
const action =
  'flex items-center gap-[3px] text-accent-ink hover:text-accent-ink-hover hover:underline';

/** Database structure (design lines 155-197): every public view with links and counts. */
export default async function StructurePage() {
  await requireUser();
  const pool = getRoPool();
  let columns: Awaited<ReturnType<typeof listViewColumns>> | null = null;
  let error: string | null = null;
  try {
    columns = await listViewColumns(pool);
  } catch (err) {
    error = roErrorMessage(err);
  }
  const counts = await countViewRows(pool);
  const total = counts
    ? PUBLIC_VIEWS.reduce((sum, v) => sum + counts[v], 0)
    : null;
  const n = PUBLIC_VIEWS.length;

  return (
    <>
      <ScreenHeader tabs={dbTabs('structure')} />
      <div className="flex flex-col gap-3">
        <h1 className="sr-only">Structure of the studies_db database</h1>
        {(error || !counts) && (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
          >
            {error && <p className="m-0">Could not load columns: {error}</p>}
            {!counts && <p className="m-0">Could not count view rows.</p>}
          </div>
        )}
        <div className="shrink-0 overflow-auto rounded-md border border-line-strong">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="bg-surface text-left">
                <th className={th}>View</th>
                <th className={th}>Action</th>
                <th className={`${th} text-right`}>Rows</th>
                <th className={th}>Type</th>
                <th className={th}>Columns</th>
              </tr>
            </thead>
            <tbody>
              {PUBLIC_VIEWS.map((v, i) => {
                const base = `/tables/${v}`;
                return (
                  <tr
                    key={v}
                    className={`hover:bg-list-hover ${i % 2 ? 'bg-zebra' : ''}`}
                  >
                    <td className={`${td} font-mono`}>
                      <Link
                        href={base}
                        className="font-medium text-accent-ink hover:text-accent-ink-hover hover:underline"
                      >
                        {v}
                      </Link>
                    </td>
                    <td className={td}>
                      <div className="flex gap-3 whitespace-nowrap">
                        <Link href={base} className={action}>
                          <Rows aria-hidden />
                          Browse
                        </Link>
                        <Link href={`${base}?tab=structure`} className={action}>
                          <Columns aria-hidden />
                          Structure
                        </Link>
                        <Link href={`${base}?tab=search`} className={action}>
                          <MagnifyingGlass aria-hidden />
                          Search
                        </Link>
                        <a
                          href={`${base}/csv`}
                          download
                          className={action}
                          aria-label={`Export ${v} to CSV`}
                        >
                          <Export aria-hidden />
                          Export
                        </a>
                      </div>
                    </td>
                    <td className={`${td} text-right font-mono`}>
                      {counts ? counts[v] : '—'}
                    </td>
                    <td className={`${td} text-muted`}>View</td>
                    <td className={`${td} font-mono text-muted`}>
                      {columns ? columns[v].length : '—'}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-surface font-semibold">
                <td className="px-2.5 py-[7px]">
                  {plural(n, 'view', 'views')}
                </td>
                <td className="px-2.5 py-[7px]">Rows across views</td>
                <td className="px-2.5 py-[7px] text-right font-mono">
                  {total ?? '—'}
                </td>
                <td className="px-2.5 py-[7px]" colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
