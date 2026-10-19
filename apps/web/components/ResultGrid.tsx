'use client';

import {
  ArrowBendLeftUp,
  ArrowClockwise,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  CheckCircle,
  DownloadSimple,
  Export,
  Eye,
  PencilSimple,
  Printer,
  TerminalWindow,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import type { Cell } from '@/lib/cells';
import { toCsv } from '@/lib/csv';
import {
  cellCsvValue,
  cellText,
  checkedInOrder,
  DEFAULT_PER_PAGE,
  defaultResultKey,
  filterRowIndexes,
  footerText,
  materialIdOf,
  PER_PAGE_OPTIONS,
  pageCountOf,
  pageOptions,
  resultMessage,
  sortRowIndexes,
  withParams,
} from '@/lib/result-grid';
import { SqlText } from './SqlText';
import { TagBadge } from './TagBadge';

export type { Cell };

/** Per-row processing state shown as a chip in the link column. */
export type RowBadge = 'pending' | 'failed' | 'ready' | null | undefined;

/** Base for every link the grid builds (preview, server sort and paging). */
export interface GridNav {
  /** Page path, e.g. `/tables/v_files`. */
  basePath: string;
  /**
   * The page's current URL params (sort, dir, page, per, filters, ...)
   * WITHOUT the preview param. Every generated link keeps them and overrides
   * only what it changes.
   */
  query?: string;
  /** Param opening the preview drawer (default `preview`; subjects use `file`). */
  previewParam?: string;
}

/** Server-driven paging: `rows` is the current page only. */
export interface ServerPaging {
  page: number;
  pageCount: number;
  perPage: number;
  /** URL param names (defaults `page`, `per`). */
  pageParam?: string;
  perPageParam?: string;
}

/** Server-driven sorting: header links reload the page. */
export interface ServerSort {
  /** Current sort key (the column name unless `sortKeys` maps it). */
  sort?: string;
  dir?: 'asc' | 'desc';
  /** URL param names (defaults `sort`, `dir`). */
  sortParam?: string;
  dirParam?: string;
  /**
   * Sort key per column, parallel to `columns` (the URL `sort` value);
   * `null` = column not sortable; missing entry = the column name.
   */
  sortKeys?: (string | null | undefined)[];
}

export interface ResultGridProps {
  columns: string[];
  /** Server paging: the current page; client mode: every row (<= 1000). */
  rows: Cell[][];
  /** SQL shown highlighted above the grid. */
  sql: string;
  /**
   * Identity of the result. When it changes, all view state (checks, client
   * page, filter, sort) resets; re-renders with a rebuilt `rows` array do not.
   * Default: derived from sql, columns, row count and the server
   * paging/sort/query props (see `defaultResultKey`).
   */
  resultKey?: string | number;
  /** Rows in the whole result (server paging). Defaults to `rows.length`. */
  total?: number;
  /** Query time; the message omits timing when absent. */
  elapsedMs?: number;
  /** Required for server paging/sorting and preview links. */
  nav?: GridNav;
  /** Present = server paging; absent = client paging over `rows`. */
  paging?: ServerPaging;
  /** Present = server sorting; absent = client sorting. */
  sorting?: ServerSort;
  /**
   * Column holding the material id: adds the actions column
   * (Preview -> preview link, Download -> /files/<id>/original).
   */
  fileColumn?: number;
  /** Column whose plain cells link to the row's preview (with `fileColumn`). */
  linkColumn?: number;
  /** Per-row state parallel to `rows`; shown in `linkColumn` (or column 0). */
  badges?: RowBadge[];
  /** Material id currently previewed (row highlighted). */
  selectedId?: number | null;
  /** Default `/sql?q=<sql>`. */
  editSqlHref?: string;
  /** Server CSV export of the whole result; absent = client CSV of `rows`. */
  csvHref?: string;
  /** Base name of client CSV downloads (default `result`). */
  name?: string;
  /** "Refresh" handler; default `router.refresh()`. */
  onRefresh?: () => void;
  /** Client-side preview instead of `nav` links (e.g. inside a client page). */
  onPreview?: (id: number) => void;
}

const BADGE: Record<'pending' | 'failed', [string, string]> = {
  pending: ['Processing…', 'border-warn-fg text-warn-fg'],
  failed: ['Preview unavailable', 'border-err-fg text-err-fg'],
};

const linkCls =
  'inline-flex cursor-pointer items-center gap-1 text-accent-ink hover:text-accent-ink-hover hover:underline';
const pagerBox =
  'grid h-[26px] w-7 place-items-center border border-line-strong bg-bar';
const selectCls =
  'h-[26px] rounded border border-line-strong bg-page px-1.5 text-fg';

function downloadCsv(filename: string, columns: string[], rows: Cell[][]) {
  const url = URL.createObjectURL(
    new Blob(
      [
        toCsv(
          columns,
          rows.map((r) => r.map(cellCsvValue)),
        ),
      ],
      {
        type: 'text/csv;charset=utf-8',
      },
    ),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function PagerItem({
  label,
  icon,
  href,
  onClick,
  pos,
}: {
  label: string;
  icon: ReactNode;
  href?: string | null;
  onClick?: (() => void) | null;
  pos: 'first' | 'mid' | 'last';
}) {
  const round =
    pos === 'first' ? 'rounded-l' : pos === 'last' ? 'rounded-r' : '';
  if (href) {
    return (
      <Link
        href={href}
        aria-label={label}
        title={label}
        className={`${pagerBox} ${round} text-accent-ink hover:bg-row-hover`}
      >
        {icon}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className={`${pagerBox} ${round} text-accent-ink hover:bg-row-hover`}
      >
        {icon}
      </button>
    );
  }
  return (
    <span aria-hidden="true" className={`${pagerBox} ${round} text-subtle`}>
      {icon}
    </span>
  );
}

/**
 * phpMyAdmin result grid (design lines 354-442): success message, SQL box,
 * pager, sortable sticky table with checkboxes, footer and operations.
 * Server mode (`paging`/`sorting` + `nav`) builds links; client mode pages and
 * sorts `rows` in memory. "Filtruj wiersze" always filters the shown rows.
 */
export function ResultGrid({
  columns,
  rows,
  sql,
  resultKey,
  total: totalProp,
  elapsedMs,
  nav,
  paging,
  sorting,
  fileColumn,
  linkColumn,
  badges,
  selectedId = null,
  editSqlHref,
  csvHref,
  name = 'result',
  onRefresh,
  onPreview,
}: ResultGridProps) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [showFull, setShowFull] = useState(false);
  const [clientSort, setClientSort] = useState<{
    col: number;
    dir: 'asc' | 'desc';
  } | null>(null);
  const [clientPer, setClientPer] = useState(DEFAULT_PER_PAGE);
  const [clientPage, setClientPage] = useState(1);
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  // New result (not a mere re-render): reset every piece of view state.
  const key = String(
    resultKey ??
      defaultResultKey({
        sql,
        columns,
        rowCount: rows.length,
        total: totalProp,
        query: nav?.query,
        page: paging?.page,
        perPage: paging?.perPage,
        sort: sorting?.sort,
        dir: sorting?.dir,
      }),
  );
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setChecked(new Set());
    setClientPage(1);
    setFilter('');
    setClientSort(null);
  }

  const server = !!paging;
  const total = totalProp ?? rows.length;

  const filtered = useMemo(() => {
    const idx = filterRowIndexes(rows, filter);
    if (sorting || !clientSort) return idx;
    return sortRowIndexes(rows, idx, clientSort.col, clientSort.dir);
  }, [rows, filter, sorting, clientSort]);

  const perPage = paging ? paging.perPage : clientPer;
  const pageCount = paging
    ? paging.pageCount
    : pageCountOf(filtered.length, perPage);
  const page = paging
    ? paging.page
    : Math.min(Math.max(1, clientPage), pageCount);
  const shown = paging
    ? filtered
    : filtered.slice((page - 1) * perPage, page * perPage);
  // Offset of the first row of this page within the result.
  const rowOffset = (page - 1) * perPage;
  // Server mode: the query result; client mode: the filtered rows (as the footer).
  // "Filtruj wiersze" hides rows of the page in both modes; then count what is visible.
  const message =
    server && filtered.length === rows.length
      ? resultMessage({
          start: rowOffset,
          count: rows.length,
          total,
          elapsedMs,
        })
      : resultMessage({
          start: rowOffset,
          count: shown.length,
          total: filtered.length,
          elapsedMs,
          unfiltered: rows.length,
        });

  const pageParam = paging?.pageParam ?? 'page';
  const perParam = paging?.perPageParam ?? 'per';
  const sortParam = sorting?.sortParam ?? 'sort';
  const dirParam = sorting?.dirParam ?? 'dir';
  const href = (over: Record<string, string | number | null>) =>
    nav ? withParams(nav.basePath, nav.query, over) : null;
  const pageHref = (p: number) => href({ [pageParam]: p <= 1 ? null : p });
  const goPage = (p: number) => {
    if (server) {
      const h = pageHref(p);
      if (h) router.push(h);
    } else setClientPage(p);
  };
  const setPer = (n: number) => {
    if (server) {
      const h = href({ [perParam]: n, [pageParam]: null });
      if (h) router.push(h);
    } else {
      setClientPer(n);
      setClientPage(1);
    }
  };

  const previewHref = (id: number) =>
    href({ [nav?.previewParam ?? 'preview']: id });
  const fileIdOf = (r: Cell[]) =>
    fileColumn === undefined ? null : materialIdOf(r[fileColumn]);
  const hasActions = fileColumn !== undefined;
  const badgeCol = linkColumn ?? 0;

  // Checked rows of the filtered result, across client pages, in display order.
  const checkedRows = checkedInOrder(filtered, checked);
  const allChecked = shown.length > 0 && shown.every((i) => checked.has(i));
  const toggleAll = () =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const i of shown) {
        if (allChecked) next.delete(i);
        else next.add(i);
      }
      return next;
    });
  const toggleRow = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const editHref = editSqlHref ?? `/sql?q=${encodeURIComponent(sql)}`;
  const refresh = onRefresh ?? (() => router.refresh());
  const exportAll = () => downloadCsv(`${name}.csv`, columns, rows);
  const exportChecked = () => {
    if (checkedRows.length === 0) return;
    downloadCsv(
      `${name}-selected.csv`,
      columns,
      checkedRows.map((i) => rows[i]),
    );
  };
  const csvLink = (icon: ReactNode) =>
    csvHref ? (
      <a href={csvHref} className={linkCls}>
        {icon}
        Export CSV
      </a>
    ) : (
      <button type="button" onClick={exportAll} className={linkCls}>
        {icon}
        Export CSV
      </button>
    );

  const serverSortKey = (i: number, col: string): string | null => {
    const k = sorting?.sortKeys?.[i];
    return k === undefined ? col : k;
  };
  const sortState = (i: number, col: string): 'asc' | 'desc' | null => {
    if (sorting) {
      const k = serverSortKey(i, col);
      return k !== null && sorting.sort === k ? (sorting.dir ?? 'asc') : null;
    }
    return clientSort?.col === i ? clientSort.dir : null;
  };

  const cellPad = 'px-2.5 py-1';
  const wrap = showFull
    ? 'whitespace-normal break-words'
    : 'max-w-[22rem] overflow-hidden text-ellipsis whitespace-nowrap';
  const perOptions: number[] = PER_PAGE_OPTIONS.includes(
    perPage as (typeof PER_PAGE_OPTIONS)[number],
  )
    ? [...PER_PAGE_OPTIONS]
    : [...PER_PAGE_OPTIONS, perPage].sort((a, b) => a - b);

  const renderCell = (c: Cell, ci: number, r: Cell[], ri: number) => {
    if (c === null || c === undefined) {
      return <i className="text-faint">NULL</i>;
    }
    const id = fileIdOf(r);
    const objPreview =
      typeof c === 'object' && c.preview !== undefined ? c.preview : null;
    const previewId =
      objPreview ?? (ci === linkColumn && id !== null ? id : null);
    const text = cellText(c);
    let body: ReactNode = text;
    const linkText = 'font-sans font-medium';
    if (previewId !== null && (nav || onPreview)) {
      body = onPreview ? (
        <button
          type="button"
          onClick={() => onPreview(previewId)}
          className={`${linkCls} ${linkText}`}
        >
          {text}
        </button>
      ) : (
        <Link
          href={previewHref(previewId) ?? '#'}
          className={`link ${linkText}`}
          scroll={false}
        >
          {text}
        </Link>
      );
    } else if (typeof c === 'object' && c.href) {
      body = (
        <Link href={c.href} className={`link ${linkText}`}>
          {text}
        </Link>
      );
    }
    const state = ci === badgeCol ? badges?.[ri] : null;
    const chips = (
      <>
        {typeof c === 'object' &&
          c.badges?.map((b) => (
            <span key={b.id} className="ml-1">
              <TagBadge name={b.name} />
            </span>
          ))}
        {(state === 'pending' || state === 'failed') && (
          <span
            className={`ml-1.5 rounded-full border px-1.5 font-sans text-[11px] ${BADGE[state][1]}`}
          >
            {BADGE[state][0]}
          </span>
        )}
      </>
    );
    const hasChips =
      state === 'pending' ||
      state === 'failed' ||
      (typeof c === 'object' && !!c.badges?.length);
    if (!hasChips) return body;
    if (showFull) {
      return (
        <>
          {body}
          {chips}
        </>
      );
    }
    // Ellipsis on the text only, so the chips stay visible.
    return (
      <span className="flex items-center">
        <span className="min-w-0 overflow-hidden text-ellipsis">{body}</span>
        <span className="flex shrink-0">{chips}</span>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="status"
        className="flex items-center gap-2 rounded-md border border-ok-line bg-ok-bg px-3 py-2 text-ok-fg"
      >
        <CheckCircle weight="fill" size={16} aria-hidden="true" />
        <span>{message}</span>
      </div>

      <div className="rounded-md border border-line-strong bg-bar">
        <pre className="m-0 whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[12.5px] leading-[1.55]">
          <SqlText sql={sql} />
        </pre>
        <div className="flex flex-wrap justify-end gap-x-3.5 gap-y-1 border-t border-line px-3 py-1.5 text-xs">
          <Link href={editHref} className={linkCls}>
            <PencilSimple aria-hidden="true" />
            Edit in SQL console
          </Link>
          {csvLink(<DownloadSimple aria-hidden="true" />)}
          <button type="button" onClick={refresh} className={linkCls}>
            <ArrowClockwise aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Result pages" className="flex items-center gap-0.5">
          <PagerItem
            pos="first"
            label="First page"
            icon={<CaretDoubleLeft aria-hidden="true" />}
            href={server && page > 1 ? pageHref(1) : null}
            onClick={!server && page > 1 ? () => goPage(1) : null}
          />
          <PagerItem
            pos="mid"
            label="Previous page"
            icon={<CaretLeft aria-hidden="true" />}
            href={server && page > 1 ? pageHref(page - 1) : null}
            onClick={!server && page > 1 ? () => goPage(page - 1) : null}
          />
          <select
            aria-label="Page"
            value={page}
            onChange={(e) => goPage(Number(e.target.value))}
            className="h-[26px] border border-line-strong bg-page px-1.5 text-fg"
          >
            {pageOptions(page, pageCount).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <PagerItem
            pos="mid"
            label="Next page"
            icon={<CaretRight aria-hidden="true" />}
            href={server && page < pageCount ? pageHref(page + 1) : null}
            onClick={
              !server && page < pageCount ? () => goPage(page + 1) : null
            }
          />
          <PagerItem
            pos="last"
            label="Last page"
            icon={<CaretDoubleRight aria-hidden="true" />}
            href={server && page < pageCount ? pageHref(pageCount) : null}
            onClick={
              !server && page < pageCount ? () => goPage(pageCount) : null
            }
          />
        </nav>
        <label className="flex items-center gap-1.5 text-muted">
          Rows per page:
          <select
            value={perPage}
            onChange={(e) => setPer(Number(e.target.value))}
            className={selectCls}
          >
            {perOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-muted">
          Filter rows:
          <input
            type="search"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setClientPage(1);
            }}
            placeholder="Search this table"
            className="h-[26px] w-[200px] max-w-full rounded border border-line-strong bg-page px-2 text-fg placeholder:text-faint"
          />
        </label>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            checked={showFull}
            onChange={(e) => setShowFull(e.target.checked)}
          />
          Full text
        </label>
      </div>

      <div className="max-h-[70vh] shrink-0 overflow-auto rounded-md border border-line-strong">
        <table className="w-full border-collapse font-mono text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky top-0 z-[1] w-7 border-b border-line-strong bg-surface px-2 py-[7px]">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allChecked}
                  onChange={toggleAll}
                />
              </th>
              {hasActions && (
                <th className="sticky top-0 z-[1] border-b border-line-strong bg-surface px-2 py-[7px]">
                  <span className="sr-only">Akcje</span>
                </th>
              )}
              {columns.map((col, i) => {
                const st = sortState(i, col);
                const Caret = st === 'desc' ? CaretDown : CaretUp;
                const label = (
                  <span className="inline-flex items-center gap-1">
                    {col}
                    {st && (
                      <Caret
                        weight="bold"
                        size={11}
                        className="text-fg"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                );
                const nextDir = st === 'asc' ? 'desc' : 'asc';
                const sk = sorting ? serverSortKey(i, col) : null;
                const sortHref = sk
                  ? href({
                      [sortParam]: sk,
                      [dirParam]: nextDir,
                      [pageParam]: null,
                    })
                  : null;
                return (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: SQL results may repeat column names
                    key={`${i}-${col}`}
                    scope="col"
                    aria-sort={
                      st === 'asc'
                        ? 'ascending'
                        : st === 'desc'
                          ? 'descending'
                          : undefined
                    }
                    className="sticky top-0 z-[1] whitespace-nowrap border-b border-l border-b-line-strong border-l-line bg-surface p-0 text-left font-semibold hover:bg-box-head"
                  >
                    {sortHref ? (
                      <Link
                        href={sortHref}
                        className="block px-2.5 py-[7px] text-accent-ink hover:text-accent-ink-hover"
                      >
                        {label}
                      </Link>
                    ) : sorting ? (
                      <span className="block px-2.5 py-[7px] text-fg">
                        {label}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setClientSort({ col: i, dir: nextDir });
                          setClientPage(1);
                        }}
                        className="block w-full cursor-pointer px-2.5 py-[7px] text-left font-semibold text-accent-ink hover:text-accent-ink-hover"
                      >
                        {label}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((ri, n) => {
              const r = rows[ri];
              const id = fileIdOf(r);
              const isSel = id !== null && selectedId === id;
              const isChecked = checked.has(ri);
              const bg = isSel
                ? 'bg-selected'
                : isChecked
                  ? 'bg-checked'
                  : n % 2
                    ? 'bg-zebra'
                    : '';
              return (
                <tr
                  key={ri}
                  data-selected={isSel || undefined}
                  className={`${bg} hover:bg-row-hover`}
                >
                  <td className={`${cellPad} border-b border-line`}>
                    <input
                      type="checkbox"
                      aria-label={`Select row ${rowOffset + n + 1}`}
                      checked={isChecked}
                      onChange={() => toggleRow(ri)}
                    />
                  </td>
                  {hasActions && (
                    <td
                      className={`${cellPad} whitespace-nowrap border-b border-line font-sans`}
                    >
                      {id !== null && (
                        <span className="inline-flex gap-2.5">
                          {onPreview ? (
                            <button
                              type="button"
                              onClick={() => onPreview(id)}
                              className={linkCls}
                            >
                              <Eye aria-hidden="true" />
                              Preview
                            </button>
                          ) : (
                            nav && (
                              <Link
                                href={previewHref(id) ?? '#'}
                                scroll={false}
                                className={linkCls}
                              >
                                <Eye aria-hidden="true" />
                                Preview
                              </Link>
                            )
                          )}
                          <a href={`/files/${id}/original`} className={linkCls}>
                            <DownloadSimple aria-hidden="true" />
                            Download
                          </a>
                        </span>
                      )}
                    </td>
                  )}
                  {r.map((c, ci) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed column order
                      key={ci}
                      title={cellText(c)}
                      className={`${cellPad} ${wrap} border-b border-l border-b-line border-l-surface align-top ${typeof c === 'number' ? 'text-right' : 'text-left'}`}
                    >
                      {renderCell(c, ci, r, ri)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (hasActions ? 2 : 1)}
                  className="p-6 text-center font-sans text-muted"
                >
                  {filter.trim()
                    ? 'No rows match the filter.'
                    : 'The query returned no rows.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 text-muted">
        <ArrowBendLeftUp size={16} className="ml-2" aria-hidden="true" />
        <button
          type="button"
          onClick={toggleAll}
          className="cursor-pointer text-accent-ink hover:text-accent-ink-hover hover:underline"
        >
          Select all
        </button>
        <span>With selected ({checkedRows.length}):</span>
        <button
          type="button"
          onClick={exportChecked}
          disabled={checkedRows.length === 0}
          className="inline-flex items-center gap-1 rounded border border-line-strong bg-page px-2.5 py-[3px] text-accent-ink enabled:cursor-pointer enabled:hover:border-accent disabled:opacity-60"
        >
          <Export aria-hidden="true" />
          Export CSV
        </button>
        <span className="flex-1" />
        <span className="font-mono text-xs">
          {footerText(server ? total : filtered.length, page, pageCount)}
        </span>
      </div>

      <fieldset className="mt-1 rounded-md border border-line-strong px-3 pt-2 pb-2.5">
        <legend className="px-1.5 font-semibold">
          Query results operations
        </legend>
        <div className="flex flex-wrap gap-[18px]">
          <button
            type="button"
            onClick={() => window.print()}
            className={linkCls}
          >
            <Printer aria-hidden="true" />
            Print
          </button>
          {csvLink(<Export aria-hidden="true" />)}
          <Link href={editHref} className={linkCls}>
            <TerminalWindow aria-hidden="true" />
            Open in SQL
          </Link>
        </div>
      </fieldset>
    </div>
  );
}
