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
