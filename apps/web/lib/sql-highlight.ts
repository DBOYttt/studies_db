/**
 * Display-only SQL tokenizer for the result grid's SQL box (port of the
 * design's `tokenize`, docs/design/studies-db-phpmyadmin.dc.html). Joining the
 * token texts gives back the input unchanged.
 */
export type SqlTokenKind =
  | 'space'
  | 'string'
  | 'identifier'
  | 'number'
  | 'keyword'
  | 'word'
  | 'punct';

export type SqlToken = { text: string; kind: SqlTokenKind };

export const SQL_KEYWORDS: ReadonlySet<string> = new Set(
  'SELECT FROM WHERE AND OR NOT LEFT RIGHT INNER JOIN ON GROUP BY ORDER ASC DESC LIMIT OFFSET AS COUNT IS NULL LIKE IN NOW INTERVAL DAY DISTINCT HAVING SUM AVG MIN MAX CAST CHAR'.split(
    ' ',
  ),
);

const TOKEN_RE = /'[^']*'?|`[^`]*`?|\s+|\w+|[^\s\w]/g;

function kindOf(t: string): SqlTokenKind {
  if (/^\s+$/.test(t)) return 'space';
  if (t[0] === "'") return 'string';
  if (t[0] === '`' || /^v_\w+$/.test(t)) return 'identifier';
  if (/^\d+$/.test(t)) return 'number';
  if (SQL_KEYWORDS.has(t.toUpperCase())) return 'keyword';
  if (/^\w+$/.test(t)) return 'word';
  return 'punct';
}

export function tokenizeSql(sql: string): SqlToken[] {
  return (sql.match(TOKEN_RE) ?? []).map((text) => ({
    text,
    kind: kindOf(text),
  }));
}
