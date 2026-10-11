import type { Cell } from '@/components/DataGrid';
import { pluralPl } from './format';

/** Row counts offered by "Liczba wierszy". */
export const PER_PAGE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 25;

/** Display text of a cell ('' for NULL). */
export function cellText(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'object') return c.text;
  return String(c);
}

/** Value written to CSV: cell objects export their text, NULL stays empty. */
export function cellCsvValue(c: Cell): unknown {
  if (c === null || c === undefined) return null;
  if (typeof c === 'object') return c.text;
  return c;
}

function sortKey(c: Cell): string | number {
  if (c !== null && typeof c === 'object') return c.sort ?? c.text;
  if (typeof c === 'number') return c;
  return cellText(c);
}

/** Numbers numerically, everything else with Polish collation (numeric-aware); NULL first. */
export function compareCells(a: Cell, b: Cell): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an === bn ? 0 : an ? -1 : 1;
  const x = sortKey(a);
  const y = sortKey(b);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), 'pl', { numeric: true });
}

/** Indexes of the rows containing `needle` (case-insensitive) in any cell. */
export function filterRowIndexes(rows: Cell[][], needle: string): number[] {
  const n = needle.trim().toLowerCase();
  const all = rows.map((_, i) => i);
  if (!n) return all;
  return all.filter((i) =>
    rows[i].some((c) => cellText(c).toLowerCase().includes(n)),
  );
}

/** Stable sort of row indexes by one column. */
export function sortRowIndexes(
  rows: Cell[][],
  idx: number[],
  col: number,
  dir: 'asc' | 'desc',
): number[] {
  const m = dir === 'desc' ? -1 : 1;
  return [...idx].sort(
    (a, b) => m * compareCells(rows[a][col], rows[b][col]) || a - b,
  );
}

/** Seconds with 4 decimals and a Polish decimal comma: 12.3 ms -> "0,0123". */
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(4).replace('.', ',');
}

/**
 * Success box text. `start` is the 0-based offset of the first shown row,
 * `count` the rows on this page, `total` the rows of the whole result.
 * Timing is omitted when `elapsedMs` is unknown.
 */
export function resultMessage({
  start,
  count,
  total,
  elapsedMs,
}: {
  start: number;
  count: number;
  total: number;
  elapsedMs?: number | null;
}): string {
  const s =
    elapsedMs === undefined || elapsedMs === null || !Number.isFinite(elapsedMs)
      ? null
      : formatSeconds(elapsedMs);
  if (total <= 0) {
    return `MariaDB zwrócił pusty wynik (zero wierszy).${s ? ` (Zapytanie trwało ${s} s.)` : ''}`;
  }
  if (count <= 0) {
    return `Brak wierszy na tej stronie (${total} łącznie${s ? `, zapytanie trwało ${s} s.` : ''})`;
  }
  return `Pokazano wiersze ${start} – ${start + count - 1} (${total} łącznie${s ? `, zapytanie trwało ${s} s.` : ''})`;
}

/** Footer text: "N wierszy · strona p / P". */
export function footerText(
  total: number,
  page: number,
  pageCount: number,
): string {
  return `${total} ${pluralPl(total, 'wiersz', 'wiersze', 'wierszy')} · strona ${page} / ${Math.max(1, pageCount)}`;
}

export function pageCountOf(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, perPage)));
}

/** Material id held by a cell: a positive safe integer, else null. */
export function materialIdOf(c: Cell): number | null {
  const v =
    c !== null && typeof c === 'object'
      ? c.text
      : typeof c === 'number'
        ? c
        : typeof c === 'string'
          ? c
          : null;
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string' || !/^[1-9]\d*$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * `basePath?query` with `over` applied (null deletes a param). The result has
 * no `?` when no params remain.
 */
export function withParams(
  basePath: string,
  query: string | undefined,
  over: Record<string, string | number | null>,
): string {
  const p = new URLSearchParams(query ?? '');
  for (const [k, v] of Object.entries(over)) {
    if (v === null) p.delete(k);
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${basePath}?${s}` : basePath;
}
