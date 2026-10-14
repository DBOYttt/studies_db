/**
 * Pure client-side rules of the admin write console
 * (components/admin/AdminSqlConsole.tsx). No Node imports: bundled for the
 * browser. The server (lib/admin-sql-handler.ts) enforces the same rules.
 */

import { pluralPl } from './format';

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

/** "1 wiersz", "2 wiersze", "5 wierszy". */
export const rowCount = (n: number): string =>
  `${n} ${pluralPl(n, 'wiersz', 'wiersze', 'wierszy')}`;

/** "1 wiersz zostanie zmieniony", "2 wiersze zostaną zmienione", … */
export const rowsWillChange = (n: number): string =>
  `${rowCount(n)} ${pluralPl(
    n,
    'zostanie zmieniony',
    'zostaną zmienione',
    'zostanie zmienionych',
  )}`;

/** Server error for a large change sent without the typed confirmation. */
export function confirmMessage(table: string | null, affected: number): string {
  return `Zmiana obejmuje ${rowCount(affected)}. Aby potwierdzić, wpisz ${
    table ? `nazwę tabeli „${table}”` : `„${confirmWord(table)}”`
  }.`;
}

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
