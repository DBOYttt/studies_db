import { describe, expect, it } from 'vitest';
import {
  columnInsertion,
  consoleColumns,
  csvStamp,
  historyLabel,
  isDbMessage,
  sqlFileColumn,
  sqlHref,
} from '../lib/sql-editor';

const schema = { v_subjects: ['id', 'code'], v_files: ['material_id'] };

describe('consoleColumns', () => {
  it('lists every view.column in schema order', () => {
    expect(consoleColumns(schema)).toEqual([
      { label: 'v_subjects.id', insert: 'v_subjects.id' },
      { label: 'v_subjects.code', insert: 'v_subjects.code' },
      { label: 'v_files.material_id', insert: 'v_files.material_id' },
    ]);
  });
  it('scopes to one view with bare names', () => {
    expect(consoleColumns(schema, { view: 'v_subjects' })).toEqual([
      { label: 'id', insert: 'id' },
      { label: 'code', insert: 'code' },
    ]);
  });
  it('prefers explicit scoped columns and tolerates unknown views', () => {
    expect(
      consoleColumns(schema, { view: 'v_x', columns: ['a'] }).map(
        (c) => c.label,
      ),
    ).toEqual(['a']);
    expect(consoleColumns(schema, { view: 'v_x' })).toEqual([]);
  });
});

describe('columnInsertion', () => {
  it('inserts at the cursor with a leading space after a word', () => {
    const doc = 'SELECT FROM v';
    expect(columnInsertion(doc, 6, 6, 'v.id')).toEqual({
      from: 6,
      to: 6,
      insert: ' v.id',
      cursor: 11,
    });
  });
  it('adds no padding next to whitespace, start or punctuation', () => {
    expect(columnInsertion('', 0, 0, 'a').insert).toBe('a');
    expect(columnInsertion('SELECT ', 7, 7, 'a').insert).toBe('a');
    expect(columnInsertion('COUNT()', 6, 6, 'a').insert).toBe('a');
    expect(columnInsertion('SELECT ,b', 7, 7, 'a').insert).toBe('a');
  });
  it('pads before a following word and replaces the selection', () => {
    const r = columnInsertion('SELECT xx FROM', 7, 9, 'a');
    expect(r).toEqual({ from: 7, to: 9, insert: 'a', cursor: 8 });
    expect(columnInsertion('SELECT FROM', 7, 7, 'a').insert).toBe('a ');
  });
});

describe('sqlFileColumn', () => {
  it('detects file results', () => {
    expect(sqlFileColumn(['material_id', 'filename'])).toBe(0);
    expect(sqlFileColumn(['id', 'topic_id', 'original_filename'])).toBe(0);
  });
  it('ignores other results', () => {
    expect(sqlFileColumn(['id', 'code'])).toBeUndefined();
    expect(sqlFileColumn(['filename', 'material_id'])).toBeUndefined();
    expect(sqlFileColumn([])).toBeUndefined();
  });
});

describe('small helpers', () => {
  it('historyLabel collapses whitespace and shortens', () => {
    expect(historyLabel('SELECT *\n  FROM  v')).toBe('SELECT * FROM v');
    expect(historyLabel('x'.repeat(80), 10)).toBe(`${'x'.repeat(9)}…`);
  });
  it('sqlHref appends q', () => {
    expect(sqlHref('/sql', 'SELECT 1')).toBe('/sql?q=SELECT%201');
    expect(sqlHref('/tables/v_x?tab=sql', 'a&b')).toBe(
      '/tables/v_x?tab=sql&q=a%26b',
    );
  });
  it('csvStamp pads local time', () => {
    expect(csvStamp(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02-0304');
  });
});

describe('isDbMessage', () => {
  it('accepts MariaDB errors from a 200 response', () => {
    expect(isDbMessage(200, "Unknown column 'nope' in 'SELECT'")).toBe(true);
  });
  it('rejects API refusals and the API own messages', async () => {
    const { connectionErrorMessage } = await import('../lib/sql-console');
    expect(isDbMessage(429, 'Too many queries. Please wait a moment.')).toBe(
      false,
    );
    expect(isDbMessage(400, 'Invalid query.')).toBe(false);
    expect(isDbMessage(200, 'Empty query.')).toBe(false);
    expect(isDbMessage(200, 'Query timed out (5 s).')).toBe(false);
    expect(isDbMessage(200, connectionErrorMessage(new Error('x')))).toBe(
      false,
    );
    expect(isDbMessage(200, connectionErrorMessage({ errno: 1226 }))).toBe(
      false,
    );
  });
});
