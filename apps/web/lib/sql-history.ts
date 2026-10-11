/**
 * SQL console history in localStorage (browser only): newest first, unique,
 * at most 50 entries. Shared by the SQL console and the shell's console footer.
 */
export const SQL_HISTORY_KEY = 'studiesdb.sqlHistory';
export const SQL_HISTORY_MAX = 50;
/** Fired on window after pushSqlHistory() so same-tab listeners can refresh. */
export const SQL_HISTORY_EVENT = 'studiesdb:sql-history';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSqlHistory(): string[] {
  const s = storage();
  if (!s) return [];
  try {
    const v: unknown = JSON.parse(s.getItem(SQL_HISTORY_KEY) ?? '[]');
    if (!Array.isArray(v)) return [];
    // Unique strings only (older or hand-edited storage may hold duplicates).
    const unique = new Set(v.filter((x): x is string => typeof x === 'string'));
    return [...unique].slice(0, SQL_HISTORY_MAX);
  } catch {
    return [];
  }
}

/** Moves `q` to the front (deduplicated) and returns the new history. */
export function pushSqlHistory(q: string): string[] {
  const next = [q, ...readSqlHistory().filter((h) => h !== q)].slice(
    0,
    SQL_HISTORY_MAX,
  );
  const s = storage();
  if (!s) return next;
  try {
    s.setItem(SQL_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode: keep the in-memory result
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SQL_HISTORY_EVENT));
  }
  return next;
}
