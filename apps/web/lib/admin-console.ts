/**
 * Pure client-side rules of the admin write console
 * (components/admin/AdminSqlConsole.tsx). No Node imports: bundled for the
 * browser. The server (lib/admin-sql-handler.ts) enforces the same rules.
 */

import { plural } from './format';

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
  /**
   * The statement may delete rows in other tables through ON DELETE
   * CASCADE (`cascadeConfirm` in lib/admin-sql.ts): the typed confirmation
   * is required whatever the row count.
   */
  cascade: boolean;
}

/** Preview note of a statement that may cascade. */
export const CASCADE_NOTE =
  'Rows in other tables that reference these rows are deleted too.';

/**
 * The typed confirmation is required: a large change, or a cascade that
 * matches at least one row (one that matches none deletes nothing anywhere).
 */
export const needsConfirm = (
  p: Pick<WritePreview, 'affected' | 'cascade'>,
  threshold: number,
): boolean => (p.cascade && p.affected > 0) || p.affected > threshold;

/** Word the user types to confirm a large change. */
export const confirmWord = (table: string | null): string => table ?? 'YES';

/** "1 row", "2 rows". */
export const rowCount = (n: number): string => plural(n, 'row', 'rows');

/** "1 row will be changed", "2 rows will be changed". */
export const rowsWillChange = (n: number): string =>
  `${rowCount(n)} will be changed`;

/** Server error for a large change sent without the typed confirmation. */
export function confirmMessage(table: string | null, affected: number): string {
  return `This change affects ${rowCount(affected)}. To confirm, type ${
    table ? `the table name “${table}”` : `“${confirmWord(table)}”`
  }.`;
}

/**
 * "Run" is enabled only for a pending preview whose text still equals
 * the editor, with no request in flight and, above `threshold` rows or for
 * a cascading statement, the typed confirmation. The preview is cleared
 * after every execute, so one preview commits at most once.
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
  return !needsConfirm(p, s.threshold) || s.confirm === confirmWord(p.table);
}
