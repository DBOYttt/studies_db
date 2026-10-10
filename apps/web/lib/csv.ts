// Built from the code point so formatters can't turn it into an invisible literal.
const BOM = String.fromCharCode(0xfeff);

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Formula-injection guard: prefix JS strings (not numbers/bigints; DECIMAL-as-string gets it too — accepted).
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with CRLF line endings and a UTF-8 BOM (so Excel reads Polish chars). */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const lines = [columns, ...rows].map((r) => `${r.map(cell).join(',')}\r\n`);
  return `${BOM}${lines.join('')}`;
}
