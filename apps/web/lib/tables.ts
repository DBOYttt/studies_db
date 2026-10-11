import { PUBLIC_VIEWS, type PublicView } from '@studies/db';
import type mysql from 'mysql2/promise';
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS } from './result-grid';
import { toJsonValue } from './sql-console';

export type { PublicView };

/** Page sizes the table page accepts (`per`); anything else -> the default. */
export function parsePerPage(v: unknown): number {
  const n = Number(v);
  return (PER_PAGE_OPTIONS as readonly number[]).includes(n)
    ? n
    : DEFAULT_PER_PAGE;
}
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

export interface ViewColumn {
  position: number;
  name: string;
  /** COLUMN_TYPE without trailing attributes, e.g. `int(11)`, `varchar(20)`. */
  type: string;
  /** Trailing attributes of COLUMN_TYPE, upper-cased: `UNSIGNED`, `UNSIGNED ZEROFILL`. */
  attributes: string;
  collation: string | null;
  nullable: boolean;
  /** COLUMN_DEFAULT as MariaDB reports it (`'pending'`, `0`, `NULL`), null = none. */
  defaultValue: string | null;
}

/** COLUMN_TYPE -> [type, attributes]: `int(10) unsigned` -> [`int(10)`, `UNSIGNED`]. */
export function splitColumnType(columnType: string): [string, string] {
  const m = /^(.*?)((?:\s+(?:unsigned|signed|zerofill))+)$/i.exec(columnType);
  return m ? [m[1], m[2].trim().toUpperCase()] : [columnType, ''];
}

/**
 * Columns of one public view from information_schema.COLUMNS (RO pool), in
 * ordinal order. The view name is bound as a parameter.
 */
export async function describeView(
  pool: mysql.Pool,
  view: PublicView,
): Promise<ViewColumn[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ORDINAL_POSITION AS pos, COLUMN_NAME AS name, COLUMN_TYPE AS type,
            COLLATION_NAME AS coll, IS_NULLABLE AS nul, COLUMN_DEFAULT AS def
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [view],
  );
  return rows.map((r) => {
    const [type, attributes] = splitColumnType(String(r.type));
    return {
      position: Number(r.pos),
      name: String(r.name),
      type,
      attributes,
      collation: r.coll === null ? null : String(r.coll),
      nullable: r.nul === 'YES',
      defaultValue: r.def === null ? null : String(r.def),
    };
  });
}

export interface ViewQuery {
  sort?: string;
  dir?: 'asc' | 'desc';
  filters?: Record<string, string>;
  /** Page size (25/50/100); kept in URLs as `per` when not the default. */
  perPage?: number;
}

export interface BrowseQuery extends ViewQuery {
  page?: number;
}

export interface BrowseResult {
  columns: string[];
  rows: unknown[][];
  total: number;
  page: number;
  pageCount: number;
  perPage: number;
  /** The page query as text, values inlined (what the grid shows). */
  sql: string;
}

const MAX_FILTER_LEN = 200;

/**
 * Table-page URL params (`sort`, `dir`, `f_<col>`, `page`, `per`) -> query.
 * Shared by the table page and its CSV export so both see the same rows (the
 * export ignores `page`/`per`).
 */
export function parseViewParams(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): {
  sort?: string;
  dir: 'asc' | 'desc';
  filters: Record<string, string>;
  page: number;
  perPage: number;
} {
  const params =
    sp instanceof URLSearchParams
      ? sp
      : new URLSearchParams(
          Object.entries(sp).flatMap(([k, v]) => {
            const val = Array.isArray(v) ? v[0] : v;
            return val === undefined ? [] : [[k, val]];
          }),
        );
  const filters: Record<string, string> = {};
  for (const [k, v] of params) {
    if (k.startsWith('f_') && v && !(k.slice(2) in filters)) {
      filters[k.slice(2)] = v.slice(0, MAX_FILTER_LEN);
    }
  }
  return {
    sort: params.get('sort') || undefined,
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
    filters,
    page: Number(params.get('page')) || 1,
    perPage: parsePerPage(params.get('per')),
  };
}

/**
 * Back to URL params (no page), e.g. for links that keep the current view.
 * `per` only when it differs from the default.
 */
export function viewQueryString(q: ViewQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.sort) {
    p.set('sort', q.sort);
    p.set('dir', q.dir === 'desc' ? 'desc' : 'asc');
  }
  for (const [k, v] of Object.entries(q.filters ?? {})) p.set(`f_${k}`, v);
  if (q.perPage !== undefined && q.perPage !== DEFAULT_PER_PAGE) {
    p.set('per', String(q.perPage));
  }
  return p;
}

const quoteId = (name: string) => `\`${name.replace(/`/g, '``')}\``;
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
/** MariaDB string literal (default sql_mode: backslash escapes). Display only. */
export const quoteString = (v: string) =>
  `'${v.replace(/[\\']/g, (c) => `\\${c}`)}'`;

/**
 * `FROM ... WHERE ...` and `ORDER BY ...` for a public view. Unknown
 * sort/filter columns are ignored. Identifiers are only interpolated after
 * being matched against the view's real columns; values are always `?` params.
 */
export async function buildViewSql(
  pool: mysql.Pool,
  view: PublicView,
  q: ViewQuery,
): Promise<{
  from: string;
  orderBy: string;
  params: string[];
  /** Same query as text with the values inlined, one clause per line. */
  text: string;
}> {
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

  // Stable order: chosen column, then the first column as a tiebreaker.
  const order: string[] = [];
  const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
  if (q.sort && known.includes(q.sort)) {
    order.push(`${quoteId(q.sort)} ${dir}`);
  }
  if (known[0] && q.sort !== known[0]) order.push(`${quoteId(known[0])} ASC`);

  const orderBy = order.length ? ` ORDER BY ${order.join(', ')}` : '';
  let i = 0;
  const textWhere = where.map((w) =>
    w.replace('?', () => quoteString(params[i++])),
  );
  const text = [
    `SELECT * FROM ${quoteId(view)}`,
    ...(textWhere.length ? [`WHERE ${textWhere.join(' AND ')}`] : []),
    ...(orderBy ? [orderBy.trimStart()] : []),
  ].join('\n');
  return {
    from: ` FROM ${quoteId(view)}${whereSql}`,
    orderBy,
    params,
    text,
  };
}

/**
 * One page of a public view (`perPage` 25/50/100, default 25); null for
 * anything not in PUBLIC_VIEWS.
 */
export async function browseView(
  pool: mysql.Pool,
  view: string,
  q: BrowseQuery,
): Promise<BrowseResult | null> {
  if (!isPublicView(view)) return null;
  const { from, orderBy, params, text } = await buildViewSql(pool, view, q);
  const perPage = parsePerPage(q.perPage);

  const [countRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS n${from}`,
    params,
  );
  const total = Number(countRows[0].n);
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const requested = Math.floor(Number(q.page));
  const page = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), pageCount)
    : 1;

  // perPage and the offset are integers from a whitelist / clamped page.
  const limit = `LIMIT ${(page - 1) * perPage}, ${perPage}`;
  const [rows, fields] = await pool.query<mysql.RowDataPacket[][]>({
    sql: `SELECT *${from}${orderBy} ${limit}`,
    values: params,
    rowsAsArray: true,
  });
  return {
    columns: fields.map((f) => f.name),
    rows: rows.map((r) => (r as unknown[]).map(toJsonValue)),
    total,
    page,
    pageCount,
    perPage,
    sql: `${text}\n${limit}`,
  };
}

/**
 * Row count of every public view in one `UNION ALL` statement (RO pool).
 * Null when the RO connection or the query fails: the nav panel then shows no
 * counts instead of failing the layout.
 */
export async function countViewRows(
  pool: mysql.Pool,
): Promise<Record<PublicView, number> | null> {
  const sql = PUBLIC_VIEWS.map(
    (v) => `SELECT '${v}' AS v, COUNT(*) AS n FROM ${quoteId(v)}`,
  ).join(' UNION ALL ');
  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(sql);
    const out = Object.fromEntries(PUBLIC_VIEWS.map((v) => [v, 0])) as Record<
      PublicView,
      number
    >;
    for (const r of rows) {
      const v = String(r.v);
      if (isPublicView(v)) out[v] = Number(r.n);
    }
    return out;
  } catch {
    return null;
  }
}
