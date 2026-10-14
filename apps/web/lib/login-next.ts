const MAX_LEN = 200;

/**
 * Validates the `next` carried by a one-time login link. Only the web admin
 * panel is allowed (`/admin` or `/admin/...`); anything that could be read as
 * another origin, a path traversal or an encoded separator is rejected.
 */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_LEN) return null;
  if (raw !== '/admin' && !raw.startsWith('/admin/')) return null;
  if (raw.includes('//') || raw.includes('\\') || raw.includes(':'))
    return null;
  if (/[\r\n]/.test(raw)) return null;
  if (/%2f|%5c/i.test(raw)) return null;
  return raw;
}
