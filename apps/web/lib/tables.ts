import { PUBLIC_VIEWS } from '@studies/db';
import type mysql from 'mysql2/promise';
import { toJsonValue } from './sql-console';

export type PublicView = (typeof PUBLIC_VIEWS)[number];

export const PAGE_SIZE = 50;
const COLUMNS_TTL_MS = 60_000;

export function isPublicView(name: string): name is PublicView {
  return (PUBLIC_VIEWS as readonly string[]).includes(name);
}

let columnsCache: { at: number; value: Record<PublicView, string[]> } | null =
  null;

/** Column names of every public view, in ordinal order. Cached for 60 s. */
export async function listViewColumns(
  pool: mysql.Pool,
): Promise<Record<PublicView, string[]>> {
  const now = Date.now();
  if (columnsCache && now - columnsCache.at < COLUMNS_TTL_MS) {
    return columnsCache.value;
  }
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [PUBLIC_VIEWS],
  );
  const value = Object.fromEntries(
    PUBLIC_VIEWS.map((v) => [v, [] as string[]]),
  ) as Record<PublicView, string[]>;
  for (const r of rows) {
    const t = String(r.t);
    if (isPublicView(t)) value[t].push(String(r.c));
  }
  columnsCache = { at: now, value };
  return value;
}

export interface BrowseQuery {
  page?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  filters?: Record<string, string>;
}

export interface BrowseResult {
  columns: string[];
  rows: unknown[][];
  total: number;
  page: number;
  pageCount: number;
}

const quoteId = (name: string) => `\`${name.replace(/`/g, '``')}\``;
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * One page of a public view. Returns null for anything not in PUBLIC_VIEWS;
 * unknown sort/filter columns are ignored. Identifiers are only interpolated
 * after being matched against the whitelist; values are always parameters.
 */
export async function browseView(
  pool: mysql.Pool,
  view: string,
  q: BrowseQuery,
): Promise<BrowseResult | null> {
  if (!isPublicView(view)) return null;
  const known = (await listViewColumns(pool))[view];

  const where: string[] = [];
  const params: string[] = [];
  for (const [col, value] of Object.entries(q.filters ?? {})) {
    if (!known.includes(col) || typeof value !== 'string' || value === '') {
      continue;
    }
    where.push(`CAST(${quoteId(col)} AS CHAR) LIKE ?`);
    params.push(`%${escapeLike(value)}%`);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const from = ` FROM ${quoteId(view)}${whereSql}`;

  const [countRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS n${from}`,
    params,
  );
  const total = Number(countRows[0].n);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Math.floor(Number(q.page));
  const page = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), pageCount)
    : 1;

  // Stable order: chosen column, then the first column as a tiebreaker.
  const order: string[] = [];
  const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
  if (q.sort && known.includes(q.sort)) {
    order.push(`${quoteId(q.sort)} ${dir}`);
  }
  if (known[0] && q.sort !== known[0]) order.push(`${quoteId(known[0])} ASC`);
  const orderSql = order.length ? ` ORDER BY ${order.join(', ')}` : '';

  const [rows, fields] = await pool.query<mysql.RowDataPacket[][]>({
    sql: `SELECT *${from}${orderSql} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    values: params,
    rowsAsArray: true,
  });
  return {
    columns: fields.map((f) => f.name),
    rows: rows.map((r) => (r as unknown[]).map(toJsonValue)),
    total,
    page,
    pageCount,
  };
}
