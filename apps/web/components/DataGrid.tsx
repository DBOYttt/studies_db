'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { TagBadge } from './TagBadge';

export type Cell =
  | string
  | number
  | boolean
  | null
  | undefined
  | {
      text: string;
      href?: string;
      sort?: string | number;
      badges?: { id: number; name: string }[];
    };

/** Server-driven mode: sorting/filtering are links/forms that reload the page. */
export interface ServerNav {
  basePath: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  filters: Record<string, string>;
}

function cellText(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'object') return c.text;
  return String(c);
}

function sortKey(c: Cell): string | number {
  if (c !== null && typeof c === 'object') return c.sort ?? c.text;
  if (typeof c === 'number') return c;
  return cellText(c);
}

function compare(a: Cell, b: Cell): number {
  const x = sortKey(a);
  const y = sortKey(b);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), 'pl', { numeric: true });
}

function CellView({ c }: { c: Cell }) {
  if (c === null || c === undefined) {
    return <span className="italic text-[var(--muted)]">NULL</span>;
  }
  if (typeof c === 'object') {
    return (
      <>
        {c.href ? (
          <Link href={c.href} className="link font-medium">
            {c.text}
          </Link>
        ) : (
          c.text
        )}
        {c.badges?.map((b) => (
          <span key={b.id} className="ml-1">
            <TagBadge name={b.name} />
          </span>
        ))}
      </>
    );
  }
  return <>{String(c)}</>;
}

export function DataGrid({
  columns,
  rows,
  server,
  empty = 'Brak wyników.',
  mono = false,
}: {
  columns: string[];
  rows: Cell[][];
  server?: ServerNav;
  empty?: string;
  mono?: boolean;
}) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    if (server) return rows;
    const needle = filter.trim().toLowerCase();
    let out = needle
      ? rows.filter((r) =>
          r.some((c) => cellText(c).toLowerCase().includes(needle)),
        )
      : rows;
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => dir * compare(a[col], b[col]));
    }
    return out;
  }, [rows, sort, filter, server]);

  const href = (over: { sort?: string; dir?: string }) => {
    if (!server) return '#';
    const p = new URLSearchParams();
    const s = over.sort ?? server.sort;
    if (s) p.set('sort', s);
    if (over.dir ?? server.dir) p.set('dir', over.dir ?? server.dir ?? 'asc');
    for (const [k, v] of Object.entries(server.filters))
      if (v) p.set(`f_${k}`, v);
    return `${server.basePath}?${p}`;
  };

  return (
    <div className="space-y-2">
      {!server && rows.length > 1 && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtruj…"
          aria-label="Filtruj wiersze"
          className="w-full max-w-xs rounded border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
        />
      )}
      {server && (
        <form
          method="get"
          action={server.basePath}
          className="flex flex-wrap items-end gap-2 text-xs"
        >
          {server.sort && (
            <input type="hidden" name="sort" value={server.sort} />
          )}
          {server.dir && <input type="hidden" name="dir" value={server.dir} />}
          {columns.map((name) => (
            <label key={name} className="flex flex-col gap-0.5">
              <span className="text-[var(--muted)]">{name}</span>
              <input
                name={`f_${name}`}
                defaultValue={server.filters[name] ?? ''}
                className="w-32 rounded border border-[var(--border)] bg-transparent px-2 py-1"
              />
            </label>
          ))}
          <button
            type="submit"
            className="rounded border border-[var(--border)] px-3 py-1 font-medium"
          >
            Filtruj
          </button>
        </form>
      )}
      <div className="max-h-[70vh] overflow-auto rounded border border-[var(--border)]">
        <table
          className={`w-full border-collapse text-sm ${mono ? 'font-mono' : ''}`}
        >
          <thead>
            <tr>
              {columns.map((name, i) => {
                const active = server ? server.sort === name : sort?.col === i;
                const dir = server
                  ? server.dir
                  : sort?.dir === -1
                    ? 'desc'
                    : 'asc';
                const mark = active ? (dir === 'desc' ? ' ▼' : ' ▲') : '';
                return (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: SQL results may repeat column names
                    key={`${i}-${name}`}
                    scope="col"
                    className="sticky top-0 z-10 whitespace-nowrap border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left font-semibold"
                  >
                    {server ? (
                      <Link
                        href={href({
                          sort: name,
                          dir: active && server.dir !== 'desc' ? 'desc' : 'asc',
                        })}
                      >
                        {name}
                        {mark}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setSort((s) =>
                            s?.col === i
                              ? { col: i, dir: s.dir === 1 ? -1 : 1 }
                              : { col: i, dir: 1 },
                          )
                        }
                      >
                        {name}
                        {mark}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-6 text-center text-[var(--muted)]"
                >
                  {empty}
                </td>
              </tr>
            )}
            {shown.map((r, ri) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity
                key={ri}
                className="odd:bg-transparent even:bg-[var(--surface)]"
              >
                {r.map((c, ci) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed column order
                    key={ci}
                    className="max-w-[28rem] truncate border-b border-[var(--border)] px-3 py-1.5 align-top"
                    title={cellText(c)}
                  >
                    <CellView c={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
