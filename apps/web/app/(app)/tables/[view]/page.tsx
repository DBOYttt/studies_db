import { PUBLIC_VIEWS } from '@studies/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataGrid } from '@/components/DataGrid';
import { toCells } from '@/lib/cells';
import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { requireUser } from '@/lib/session';
import {
  browseView,
  isPublicView,
  PAGE_SIZE,
  parseViewParams,
  viewQueryString,
} from '@/lib/tables';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<SP>;
}) {
  await requireUser();
  const { view } = await params;
  if (!isPublicView(view)) notFound();
  const { sort, dir, filters, page } = parseViewParams(await searchParams);

  let result: Awaited<ReturnType<typeof browseView>> = null;
  let error: string | null = null;
  try {
    result = await browseView(getRoPool(), view, {
      page,
      sort,
      dir,
      filters,
    });
  } catch (err) {
    error = roErrorMessage(err);
  }

  const base = `/tables/${view}`;
  const current = viewQueryString({ sort, dir, filters });
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams(current);
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return `${base}?${p}`;
  };
  const csvHref = `${base}/csv${current.size ? `?${current}` : ''}`;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row">
      <aside className="shrink-0 md:w-52">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">
          Tabele
        </h2>
        <ul className="flex flex-wrap gap-1 md:flex-col">
          {PUBLIC_VIEWS.map((v) => (
            <li key={v}>
              <Link
                href={`/tables/${v}`}
                className={`block rounded px-2 py-1 font-mono text-sm hover:bg-[var(--surface)] ${v === view ? 'bg-[var(--surface)] font-semibold' : ''}`}
              >
                {v}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <section className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-mono text-xl font-semibold">{view}</h1>
          <a
            href={csvHref}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
          >
            Eksport CSV
          </a>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded border border-red-500 p-3 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}
        {result && (
          <>
            <DataGrid
              columns={result.columns}
              rows={toCells(result.rows)}
              mono
              server={{ basePath: base, sort, dir, filters }}
            />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-[var(--muted)]">
                {result.total} wierszy · strona {result.page} /{' '}
                {result.pageCount} (po {PAGE_SIZE})
              </span>
              {result.page > 1 && (
                <Link className="link" href={qs({ page: result.page - 1 })}>
                  ‹ Poprzednia
                </Link>
              )}
              {result.page < result.pageCount && (
                <Link className="link" href={qs({ page: result.page + 1 })}>
                  Następna ›
                </Link>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
