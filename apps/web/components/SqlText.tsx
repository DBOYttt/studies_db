import { useMemo } from 'react';
import { type SqlTokenKind, tokenizeSql } from '@/lib/sql-highlight';

const TOKEN_CLASS: Record<SqlTokenKind, string> = {
  space: '',
  string: 'text-sql-string',
  identifier: 'text-accent-ink font-medium',
  number: 'text-sql-number',
  keyword: 'text-sql-keyword font-semibold',
  word: 'text-fg',
  punct: 'text-faint',
};

/** SQL as coloured token spans (the design's `tokenize`); wrap it in a `<pre>`. */
export function SqlText({ sql }: { sql: string }) {
  const tokens = useMemo(() => tokenizeSql(sql), [sql]);
  return tokens.map((t, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no identity
    <span key={i} className={TOKEN_CLASS[t.kind]}>
      {t.text}
    </span>
  ));
}
