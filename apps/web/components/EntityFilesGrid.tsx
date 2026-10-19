import { PreviewPanel } from '@/components/explorer/PreviewPanel';
import { ResultGrid } from '@/components/ResultGrid';
import { toCells } from '@/lib/cells';
import { getDb } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { type EntityGridParams, entityGridQuery } from '@/lib/entity-page';
import {
  FILE_SORTS,
  type SqlPage,
  TOPIC_SORT_KEYS,
} from '@/lib/entity-queries';
import { getMaterialFile, loadLinkContext } from '@/lib/queries';

const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';

interface GridProps {
  /** Entity page path, e.g. `/lecturers/3`. */
  basePath: string;
  /** `?tab=` of this grid, null on the default tab. */
  tab: string | null;
  grid: EntityGridParams;
  /** Runs the page query on the RO pool. */
  load: () => Promise<SqlPage>;
  /** Base name of CSV downloads. */
  name: string;
}

/**
 * Server-paged `v_files` grid (FILE_COLUMNS) of an entity page: links per
 * column name, Preview opens PreviewPanel via `?preview=`, RO errors show
 * an alert instead of the grid.
 */
export function EntityFilesGrid(props: GridProps) {
  return (
    <EntityGrid
      {...props}
      view="v_files"
      sortable={FILE_SORTS}
      defaultSort="created_at"
    />
  );
}

/** Server-paged `v_topics` grid (title, subject, class, group links). */
export function EntityTopicsGrid(props: GridProps) {
  return (
    <EntityGrid
      {...props}
      view="v_topics"
      sortable={TOPIC_SORT_KEYS}
      defaultSort="created_at"
    />
  );
}

async function EntityGrid({
  basePath,
  tab,
  grid,
  load,
  name,
  view,
  sortable,
  defaultSort,
}: GridProps & {
  view: 'v_files' | 'v_topics';
  sortable: readonly string[];
  /** Column of the loader's default order (shown as sorted descending). */
  defaultSort: string;
}) {
  const files = view === 'v_files';
  const previewId = files ? grid.preview : null;
  const [result, links, previewFile] = await Promise.all([
    load().then(
      (page) => ({ page, error: null }),
      (err: unknown) => ({ page: null, error: roErrorMessage(err) }),
    ),
    // Without the lookups the grid still works, just without reference links.
    loadLinkContext(getDb()).catch(() => undefined),
    previewId === null
      ? Promise.resolve(null)
      : getMaterialFile(getDb(), previewId),
  ]);
  const { page } = result;
  if (!page) {
    return (
      <div role="alert" className={errBox}>
        Could not load data: {result.error ?? 'no data'}
      </div>
    );
  }

  // Grid links keep tab, sort, dir, per and page; the preview param is added per link.
  const query = entityGridQuery(tab, grid, page.page);
  const closeHref = query ? `${basePath}?${query}` : basePath;
  const sortKeys = page.columns.map((c) => (sortable.includes(c) ? c : null));
  const fileColumn = files ? page.columns.indexOf('material_id') : -1;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <ResultGrid
          columns={page.columns}
          rows={toCells(page.rows, { view, columns: page.columns, links })}
          sql={page.sql}
          total={page.total}
          nav={{ basePath, query }}
          paging={{
            page: page.page,
            pageCount: page.pageCount,
            perPage: page.perPage,
          }}
          sorting={{
            sort: grid.sort ?? defaultSort,
            dir: grid.sort ? grid.dir : 'desc',
            sortKeys,
          }}
          fileColumn={fileColumn >= 0 ? fileColumn : undefined}
          selectedId={previewId}
          name={name}
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
