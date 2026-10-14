/**
 * Pure client-side rules of the admin write console
 * (components/admin/AdminSqlConsole.tsx). No Node imports: bundled for the
 * browser. The server (lib/admin-sql-handler.ts) enforces the same rules.
 */

export type WriteKind = 'insert' | 'update' | 'delete' | 'replace';

/** A successful write preview from POST /api/admin/sql. */
export interface WritePreview {
  /** The exact text that was previewed (the token is bound to it). */
  sql: string;
  token: string;
  kind: WriteKind;
  table: string | null;
  affected: number;
  columns: string[];
  rows: unknown[][];
}

/** Word the user types to confirm a large change. */
export const confirmWord = (table: string | null): string => table ?? 'TAK';

/**
 * "Wykonaj" is enabled only for a pending preview whose text still equals
 * the editor, with no request in flight and, above `threshold` rows, the
 * typed confirmation. The preview is cleared after every execute, so one
 * preview commits at most once.
 */
export function canExecute(s: {
  preview: WritePreview | null;
  query: string;
  busy: boolean;
  confirm: string;
  threshold: number;
}): boolean {
  const p = s.preview;
  if (!p || s.busy || s.query !== p.sql) return false;
  return p.affected <= s.threshold || s.confirm === confirmWord(p.table);
}
