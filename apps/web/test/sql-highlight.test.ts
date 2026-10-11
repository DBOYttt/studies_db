import { describe, expect, it } from 'vitest';
import { tokenizeSql } from '../lib/sql-highlight';

const kinds = (sql: string) =>
  tokenizeSql(sql)
    .filter((t) => t.kind !== 'space')
    .map((t) => [t.text, t.kind]);

describe('tokenizeSql', () => {
  it('round-trips the input text', () => {
    const sql =
      "SELECT `id`, name\nFROM v_files WHERE x = 'a b' AND n >= 10 -- c\nLIMIT 0, 25";
    expect(
      tokenizeSql(sql)
        .map((t) => t.text)
        .join(''),
    ).toBe(sql);
  });

  it('classifies keywords case-insensitively, words, numbers, punctuation', () => {
    expect(kinds('select count(*) from t limit 5')).toEqual([
      ['select', 'keyword'],
      ['count', 'keyword'],
      ['(', 'punct'],
      ['*', 'punct'],
      [')', 'punct'],
      ['from', 'keyword'],
      ['t', 'word'],
      ['limit', 'keyword'],
      ['5', 'number'],
    ]);
  });

  it('marks backticked names and v_ views as identifiers', () => {
    expect(kinds('`size_bytes` v_materials vx')).toEqual([
      ['`size_bytes`', 'identifier'],
      ['v_materials', 'identifier'],
      ['vx', 'word'],
    ]);
  });

  it('keeps string literals whole, including keywords inside and unterminated ones', () => {
    expect(kinds("WHERE a = 'SELECT 1' OR b = 'open")).toEqual([
      ['WHERE', 'keyword'],
      ['a', 'word'],
      ['=', 'punct'],
      ["'SELECT 1'", 'string'],
      ['OR', 'keyword'],
      ['b', 'word'],
      ['=', 'punct'],
      ["'open", 'string'],
    ]);
  });

  it('treats digits glued to letters as a word, and whitespace as space', () => {
    expect(tokenizeSql('a1 \n\t2')).toEqual([
      { text: 'a1', kind: 'word' },
      { text: ' \n\t', kind: 'space' },
      { text: '2', kind: 'number' },
    ]);
  });

  it('returns no tokens for an empty string', () => {
    expect(tokenizeSql('')).toEqual([]);
  });
});
