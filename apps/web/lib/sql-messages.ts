/**
 * Messages /api/sql writes itself (not MariaDB's). Dependency-free so both
 * the server (lib/sql-console.ts) and the client console (lib/sql-editor.ts)
 * can import it; lib/sql-console.ts pulls in mysql2 and must stay server-only.
 */
export const EMPTY_QUERY_ERROR = 'Puste zapytanie.';
export const BUSY_ERROR = 'Serwer jest zajęty. Spróbuj za chwilę.';
export const CONNECT_ERROR = 'Nie udało się połączyć z bazą danych.';
export const timeoutMessage = (seconds: number) =>
  `Przekroczono limit czasu (${seconds} s).`;

/** Database names from the pool URLs (path segments), for schema-prefix stripping. */
export function configuredDbNames(): string[] {
  if (typeof process === 'undefined') return [];
  const names = new Set<string>();
  for (const k of [
    'DATABASE_URL',
    'DATABASE_RO_URL',
    'DATABASE_RW_URL',
    'TEST_DATABASE_URL',
  ]) {
    const v = process.env[k];
    if (!v) continue;
    try {
      const n = decodeURIComponent(new URL(v).pathname.replace(/^\//, ''));
      if (n) names.add(n);
    } catch {
      // Not a URL: nothing to learn from it.
    }
  }
  return [...names];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Strips what a MariaDB message reveals about the deployment (DB user, host,
 * schema name) while keeping the part that explains the refusal. Text inside
 * a `near '…'` clause is the user's own SQL and is never touched.
 */
export function sanitizeDbMessage(
  message: string,
  dbNames: string[] = configuredDbNames(),
): string {
  const at = message.search(/ near '/);
  const head = at < 0 ? message : message.slice(0, at);
  const tail = at < 0 ? '' : message.slice(at);
  let out = head
    .replace(/ (?:to|for) user '[^']*'@'[^']*'/g, '')
    .replace(/(Access denied) to database '[^']*'/g, '$1 to database');
  for (const db of dbNames) {
    const d = escapeRe(db);
    out = out
      .replace(new RegExp(`\`${d}\`\\.`, 'g'), '')
      .replace(new RegExp(`'${d}\\.`, 'g'), "'")
      .replace(new RegExp(`(?<![\\w$])${d}\\.`, 'g'), '');
  }
  return out + tail;
}
