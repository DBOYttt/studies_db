function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with CRLF line endings and a UTF-8 BOM (so Excel reads Polish chars). */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const lines = [columns, ...rows].map((r) => `${r.map(cell).join(',')}\r\n`);
  return `﻿${lines.join('')}`;
}
