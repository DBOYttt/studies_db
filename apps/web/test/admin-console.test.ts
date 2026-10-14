import { describe, expect, it } from 'vitest';
import {
  canExecute,
  confirmWord,
  type WritePreview,
} from '../lib/admin-console';

const preview: WritePreview = {
  sql: "UPDATE topics SET title = 'x' WHERE id = 1",
  token: 'tok',
  kind: 'update',
  table: 'topics',
  affected: 1,
  columns: [],
  rows: [],
};
const base = {
  preview,
  query: preview.sql,
  busy: false,
  confirm: '',
  threshold: 100,
};

describe('confirmWord', () => {
  it('is the table name, or TAK when unknown', () => {
    expect(confirmWord('topics')).toBe('topics');
    expect(confirmWord(null)).toBe('TAK');
  });
});

describe('canExecute', () => {
  it('allows the previewed statement', () => {
    expect(canExecute(base)).toBe(true);
  });
  it('needs a preview (none, or cleared after an execute)', () => {
    expect(canExecute({ ...base, preview: null })).toBe(false);
  });
  it('needs the editor text to equal the previewed text', () => {
    expect(canExecute({ ...base, query: `${preview.sql} ` })).toBe(false);
  });
  it('is off while a request is in flight', () => {
    expect(canExecute({ ...base, busy: true })).toBe(false);
  });
  it('requires the typed confirmation above the threshold', () => {
    const big = { ...base, preview: { ...preview, affected: 101 } };
    expect(canExecute(big)).toBe(false);
    expect(canExecute({ ...big, confirm: 'topic' })).toBe(false);
    expect(canExecute({ ...big, confirm: 'topics' })).toBe(true);
    expect(
      canExecute({ ...base, preview: { ...preview, affected: 100 } }),
    ).toBe(true);
    const unknown = { ...big, preview: { ...big.preview, table: null } };
    expect(canExecute({ ...unknown, confirm: 'TAK' })).toBe(true);
    expect(canExecute({ ...unknown, confirm: 'tak' })).toBe(false);
  });
});
