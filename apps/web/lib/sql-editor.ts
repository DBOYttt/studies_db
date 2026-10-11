/** Pure helpers for the SQL console screen (components/SqlConsole.tsx). */

export interface ConsoleColumn {
  /** Text in the "Kolumny" list. */
  label: string;
  /** Text inserted into the editor on double-click. */
  insert: string;
}

/**
 * "Kolumny" entries: every `view.column` of `schema` (view order kept), or
 * only the bare column names of one view when the console is embedded in a
 * view screen (`scope.columns` wins over `schema[scope.view]`).
 */
export function consoleColumns(
  schema: Record<string, string[]>,
  scope?: { view: string; columns?: string[] },
): ConsoleColumn[] {
  if (scope) {
    const cols = scope.columns ?? schema[scope.view] ?? [];
    return cols.map((c) => ({ label: c, insert: c }));
  }
  return Object.entries(schema).flatMap(([view, cols]) =>
    cols.map((c) => ({ label: `${view}.${c}`, insert: `${view}.${c}` })),
  );
}

/**
 * Change that inserts `text` over the selection `from..to` of `doc`, padded
 * with a space where it would otherwise stick to the neighbouring word.
 * `cursor` is the position right after the inserted name.
 */
export function columnInsertion(
  doc: string,
  from: number,
  to: number,
  text: string,
): { from: number; to: number; insert: string; cursor: number } {
  const before = from > 0 ? doc[from - 1] : '';
  const after = to < doc.length ? doc[to] : '';
  const lead = before && !/[\s(]/.test(before) ? ' ' : '';
  const trail = after && !/[\s,);]/.test(after) ? ' ' : '';
  const insert = `${lead}${text}${trail}`;
  return { from, to, insert, cursor: from + lead.length + text.length };
}

/**
 * Column holding the material id when a result lists files (first column
 * `material_id`, or first column `id` with an `original_filename` column),
 * so the grid offers previews; otherwise undefined.
 */
export function sqlFileColumn(columns: string[]): number | undefined {
  if (columns[0] === 'material_id') return 0;
  if (columns[0] === 'id' && columns.includes('original_filename')) return 0;
  return undefined;
}

/** One-line label of a history entry for the "Historia" select. */
export function historyLabel(q: string, max = 70): string {
  const one = q.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** `path` with `q=<sql>` added (keeps an existing query string). */
export function sqlHref(path: string, sql: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}q=${encodeURIComponent(sql)}`;
}

/** Local timestamp for CSV file names: `YYYY-MM-DD-HHmm`. */
export function csvStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Messages /api/sql writes itself (lib/sql-console.ts), not MariaDB's. */
const APP_MESSAGES = [
  /^Puste zapytanie\.$/,
  /^Przekroczono limit czasu \(/,
  /^Nie udało się połączyć z bazą danych\.$/,
  /^Serwer jest zajęty\./,
];

/**
 * True when an /api/sql error text came from MariaDB: the request reached
 * the database (HTTP 200) and it is not one of the API's own messages.
 */
export function isDbMessage(status: number, error: string): boolean {
  return status === 200 && !APP_MESSAGES.some((re) => re.test(error));
}
