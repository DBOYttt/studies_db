import {
  Columns,
  Export,
  Key,
  MagnifyingGlass,
  Rows,
  Table,
  TerminalWindow,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PreviewPanel } from '@/components/explorer/PreviewPanel';
import { LazySqlConsole } from '@/components/lazy-tabs';
import { ResultGrid } from '@/components/ResultGrid';
import { ScreenHeader, type Tab } from '@/components/shell/ScreenHeader';
import { ViewSearchForm } from '@/components/ViewSearchForm';
import { parsePreviewId, previewColumn, toCells } from '@/lib/cells';
import { getDb, getRoPool, getViewsPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { getMaterialFile, loadLinkContext } from '@/lib/queries';
import { DEFAULT_PER_PAGE } from '@/lib/result-grid';
import { requireUser } from '@/lib/session';
import { sqlHref } from '@/lib/sql-editor';
import {
  browseView,
  describeView,
  isPublicView,
  listViewColumns,
  type PublicView,
  parseViewParams,
  type ViewColumn,
  viewQueryString,
} from '@/lib/tables';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;
type ViewTab = 'browse' | 'structure' | 'sql' | 'search';

const MAX_PREFILL = 4000;

const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';
const warnBox =
  'rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg';
const linkCls =
  'flex items-center gap-1 text-accent-ink hover:text-accent-ink-hover hover:underline';

function parseTab(v: string | string[] | undefined): ViewTab {
  const s = Array.isArray(v) ? v[0] : v;
  return s === 'structure' || s === 'sql' || s === 'search' ? s : 'browse';
}

/** View screen (design line 747): Browse, Structure, SQL, Search, Export. */
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
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const { sort, dir, filters, page, perPage } = parseViewParams(sp);

  const base = `/tables/${view}`;
  // Sort, dir, filters and per (no page): kept by Browse/Search/Export.
  const current = viewQueryString({ sort, dir, filters, perPage });
  const withCurrent = (path: string, extra?: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    for (const [k, v] of current) p.set(k, v);
    return p.size ? `${path}?${p}` : path;
  };
  const csvParams = viewQueryString({ sort, dir, filters });
  const csvHref = `${base}/csv${csvParams.size ? `?${csvParams}` : ''}`;

  const tabs: Tab[] = [
    {
      label: 'Browse',
      icon: Rows,
      href: withCurrent(base),
      active: tab === 'browse',
    },
    {
      label: 'Structure',
      icon: Columns,
      href: `${base}?tab=structure`,
      active: tab === 'structure',
    },
    {
      label: 'SQL',
      icon: TerminalWindow,
      href: `${base}?tab=sql`,
      active: tab === 'sql',
    },
    {
      label: 'Search',
      icon: MagnifyingGlass,
      href: withCurrent(base, { tab: 'search' }),
      active: tab === 'search',
    },
    {
      label: 'Export',
      icon: Export,
      href: csvHref,
      active: false,
      download: true,
    },
  ];

  return (
    <>
      <ScreenHeader
        crumbs={[{ icon: Table, kind: 'View:', label: view, href: base }]}
        tabs={tabs}
      />
      <h1 className="sr-only">View {view}</h1>
      {tab === 'browse' && (
        <BrowseTab
          view={view}
          sp={sp}
          query={{ sort, dir, filters, page, perPage }}
          current={current}
          csvHref={csvHref}
        />
      )}
      {tab === 'structure' && <StructureTab view={view} />}
      {tab === 'sql' && <SqlTab view={view} q={sp.q} />}
      {tab === 'search' && (
        <SearchTab
          view={view}
          filters={filters}
          perPage={perPage === DEFAULT_PER_PAGE ? undefined : perPage}
          sort={sort}
          dir={dir}
        />
      )}
    </>
  );
}

async function BrowseTab({
  view,
  sp,
  query,
  current,
  csvHref,
}: {
  view: PublicView;
  sp: SP;
  query: ReturnType<typeof parseViewParams>;
  current: URLSearchParams;
  csvHref: string;
}) {
  const base = `/tables/${view}`;
  const fileCol = previewColumn(view);
  const previewId = fileCol === null ? null : parsePreviewId(sp.preview);
  const previewFile =
    previewId === null ? null : await getMaterialFile(getDb(), previewId);

  let result: Awaited<ReturnType<typeof browseView>> = null;
  let error: string | null = null;
  try {
    result = await browseView(getRoPool(), view, query);
  } catch (err) {
    error = roErrorMessage(err);
  }

  let links: Awaited<ReturnType<typeof loadLinkContext>> | undefined;
  try {
    links = await loadLinkContext(getDb());
  } catch {
    links = undefined; // no reference links, the grid still works
  }

  // Grid links and the preview close link keep sort, filters, per and page.
  const keep = new URLSearchParams(current);
  if (result && result.page > 1) keep.set('page', String(result.page));
  const closeHref = keep.size ? `${base}?${keep}` : base;

  if (error || !result) {
    return (
      <div role="alert" className={errBox}>
        Could not load the view: {error ?? 'no data'}
      </div>
    );
  }
  const fileColumn = fileCol === null ? -1 : result.columns.indexOf(fileCol);
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <ResultGrid
          columns={result.columns}
          rows={toCells(result.rows, { view, columns: result.columns, links })}
          sql={result.sql}
          total={result.total}
          nav={{ basePath: base, query: keep.toString() }}
          paging={{
            page: result.page,
            pageCount: result.pageCount,
            perPage: result.perPage,
          }}
          sorting={{ sort: query.sort, dir: query.dir }}
          fileColumn={fileColumn >= 0 ? fileColumn : undefined}
          selectedId={previewId}
          csvHref={csvHref}
          editSqlHref={sqlHref(`${base}?tab=sql`, result.sql)}
          name={view}
        />
      </div>
      {previewId !== null && (
        <div className="lg:sticky lg:top-12 lg:w-[360px] lg:shrink-0">
          <PreviewPanel file={previewFile} closeHref={closeHref} />
        </div>
      )}
    </div>
  );
}

const th = 'border-b border-line-strong px-2.5 py-[7px] font-semibold';
const td = 'border-b border-line px-2.5 py-1';

/** First column `id` / `material_id`: the row identifier (key icon, bold). */
const isIdColumn = (c: ViewColumn) =>
  c.position === 1 && (c.name === 'id' || c.name === 'material_id');

async function StructureTab({ view }: { view: PublicView }) {
  let columns: ViewColumn[] = [];
  let error: string | null = null;
  try {
    columns = await describeView(getViewsPool(), view);
  } catch (err) {
    error = roErrorMessage(err);
  }
  const base = `/tables/${view}`;
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div role="alert" className={errBox}>
          Could not load the structure: {error}
        </div>
      ) : (
        <div className="shrink-0 overflow-auto rounded-md border border-line-strong">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="bg-surface text-left">
                <th className={`${th} w-9`}>#</th>
                <th className={th}>Name</th>
                <th className={th}>Type</th>
                <th className={th}>Collation</th>
                <th className={th}>Attributes</th>
                <th className={th}>Null</th>
                <th className={th}>Default</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c, i) => {
                const id = isIdColumn(c);
                return (
                  <tr
                    key={c.name}
                    className={`hover:bg-list-hover ${i % 2 ? 'bg-zebra' : ''}`}
                  >
                    <td className={`${td} font-mono text-faint`}>
                      {c.position}
                    </td>
                    <td
                      className={`${td} font-mono ${id ? 'font-semibold' : ''}`}
                    >
                      <span className="inline-flex items-center gap-[5px]">
                        {c.name}
                        {id && (
                          <Key
                            weight="fill"
                            size={12}
                            className="text-key"
                            aria-label="Identifier"
                          />
                        )}
                      </span>
                    </td>
                    <td className={`${td} font-mono text-sql-keyword`}>
                      {c.type}
                    </td>
                    <td className={`${td} text-muted`}>{c.collation ?? ''}</td>
                    <td className={`${td} font-mono text-xs text-muted`}>
                      {c.attributes}
                    </td>
                    <td className={td}>{c.nullable ? 'Yes' : 'No'}</td>
                    <td className={`${td} text-muted`}>
                      <i>{c.defaultValue ?? (c.nullable ? 'NULL' : 'None')}</i>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <Link href={base} className={linkCls}>
          <Rows aria-hidden />
          Browse data
        </Link>
        <Link href={`${base}?tab=sql`} className={linkCls}>
          <TerminalWindow aria-hidden />
          Query this view
        </Link>
      </div>
    </div>
  );
}

async function SqlTab({
  view,
  q,
}: {
  view: PublicView;
  q: string | string[] | undefined;
}) {
  // Prefill only: the editor shows it, the user runs it.
  const initialQuery =
    typeof q === 'string' && q.trim()
      ? q.slice(0, MAX_PREFILL)
      : `SELECT * FROM \`${view}\` WHERE 1`;
  let schema: Record<string, string[]> | undefined;
  let error: string | null = null;
  try {
    schema = await listViewColumns(getViewsPool());
  } catch (err) {
    error = roErrorMessage(err);
  }
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div role="alert" className={warnBox}>
          Could not load the column list: {error}
        </div>
      )}
      <LazySqlConsole
        key={initialQuery}
        initialQuery={initialQuery}
        schema={schema ?? {}}
        embedded={{ view }}
        editPath={`/tables/${view}?tab=sql`}
      />
    </div>
  );
}

async function SearchTab({
  view,
  filters,
  perPage,
  sort,
  dir,
}: {
  view: PublicView;
  filters: Record<string, string>;
  perPage?: number;
  sort?: string;
  dir?: string;
}) {
  let columns: ViewColumn[] = [];
  let error: string | null = null;
  try {
    columns = await describeView(getViewsPool(), view);
  } catch (err) {
    error = roErrorMessage(err);
  }
  if (error) {
    return (
      <div role="alert" className={errBox}>
        Could not load columns: {error}
      </div>
    );
  }
  return (
    <ViewSearchForm
      key={JSON.stringify(filters)}
      view={view}
      columns={columns.map((c) => ({ name: c.name, type: c.type }))}
      values={filters}
      perPage={perPage}
      sort={sort}
      dir={sort ? dir : undefined}
    />
  );
}
