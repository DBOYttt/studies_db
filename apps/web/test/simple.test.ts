import { describe, expect, it } from 'vitest';
import {
  chipHref,
  fileIcon,
  highlightParts,
  parseFileParam,
  parsePageParam,
  parseSearchQuery,
  parseSimpleFilters,
  REPORT_LABELS,
  REPORT_META,
  statusBadge,
  withParam,
} from '../lib/simple';

describe('highlightParts', () => {
  it('folds case, accents and ł', () => {
    expect(highlightParts('Wykład ŁÓDŹ', 'lodz')).toEqual([
      { t: 'Wykład ', hit: false },
      { t: 'ŁÓDŹ', hit: true },
    ]);
  });
  it('treats regex metacharacters literally', () => {
    expect(highlightParts('a(b)a', '(b')).toEqual([
      { t: 'a', hit: false },
      { t: '(b', hit: true },
      { t: ')a', hit: false },
    ]);
    for (const q of ['[', '\\', '*', '%', '_', '(', '.*'])
      expect(() => highlightParts('x[y]\\*', q)).not.toThrow();
  });
  it('marks every occurrence', () => {
    expect(highlightParts('abab', 'ab').map((p) => [p.t, p.hit])).toEqual([
      ['ab', true],
      ['ab', true],
    ]);
  });
  it('returns one plain part without a match or with an empty query', () => {
    expect(highlightParts('abc', 'zzz')).toEqual([{ t: 'abc', hit: false }]);
    expect(highlightParts('abc', '')).toEqual([{ t: 'abc', hit: false }]);
    expect(highlightParts('abc', '  ')).toEqual([{ t: 'abc', hit: false }]);
  });
});

describe('static maps', () => {
  it('has three reports and the column labels', () => {
    expect(REPORT_META.map((r) => r.icon)).toEqual(['Books', 'Medal', 'Exam']);
    expect(REPORT_LABELS.liczba_plikow).toBe('Pliki');
    expect(REPORT_LABELS.created_at).toBe('Dodano');
  });
  it('fileIcon and statusBadge', () => {
    expect(fileIcon('pdf')).toEqual({ icon: 'FilePdf', tone: 'red' });
    expect(fileIcon('image').icon).toBe('FileImage');
    expect(fileIcon('text').tone).toBe('accent');
    expect(fileIcon('none')).toEqual({ icon: 'File', tone: 'muted' });
    expect(statusBadge('ready')).toBeNull();
    expect(statusBadge('pending')).toEqual({
      label: 'Przetwarzanie…',
      tone: 'warn',
    });
    expect(statusBadge('failed')).toEqual({
      label: 'Podgląd niedostępny',
      tone: 'err',
    });
  });
});

describe('parseSimpleFilters', () => {
  const kinds = ['wyklad', 'cwiczenia'] as const;
  // group numbers per kind (not ids)
  const groups = { wyklad: [], cwiczenia: [1, 2] };
  const k = [...kinds];
  it('accepts valid values', () => {
    expect(
      parseSimpleFilters(
        { class: 'cwiczenia', group: '1', tag: '9' },
        k,
        groups,
        [9],
      ),
    ).toEqual({ kind: 'cwiczenia', group: 1, tag: 9 });
  });
  it('drops unknown kind, foreign group and foreign tag', () => {
    expect(
      parseSimpleFilters(
        { class: 'lab', group: '1', tag: '3' },
        k,
        groups,
        [9],
      ),
    ).toEqual({ kind: null, group: null, tag: null });
    expect(
      parseSimpleFilters({ class: 'wyklad', group: '1' }, k, groups, []),
    ).toEqual({ kind: 'wyklad', group: null, tag: null });
    expect(parseSimpleFilters({ group: '1' }, k, groups, []).group).toBeNull();
  });
  it('ignores junk and arrays', () => {
    expect(
      parseSimpleFilters(
        { class: ['cwiczenia', 'x'], group: ['2'], tag: 'abc' },
        k,
        groups,
        [9],
      ),
    ).toEqual({ kind: 'cwiczenia', group: 2, tag: null });
    expect(
      parseSimpleFilters({ class: 'cwiczenia', group: '1.5' }, k, groups, [])
        .group,
    ).toBeNull();
  });
});

describe('simple page params', () => {
  it('parses ?file= as a positive id only', () => {
    expect(parseFileParam({ file: '42' })).toBe(42);
    expect(parseFileParam({ file: ['7', '8'] })).toBe(7);
    for (const v of ['0', '-1', 'abc', '1.5', '', undefined])
      expect(parseFileParam({ file: v })).toBeNull();
  });
  it('clamps ?page= to 1..max', () => {
    expect(parsePageParam({}, 5)).toBe(1);
    expect(parsePageParam({ page: 'x' }, 5)).toBe(1);
    expect(parsePageParam({ page: '3' }, 5)).toBe(3);
    expect(parsePageParam({ page: '99' }, 5)).toBe(5);
    expect(parsePageParam({ page: '2' }, 0)).toBe(1);
  });
  it('appends a param with the right separator', () => {
    expect(withParam('/s', 'file', 3)).toBe('/s?file=3');
    expect(withParam('/s/recent?page=2', 'file', 3)).toBe(
      '/s/recent?page=2&file=3',
    );
  });
});

describe('chipHref', () => {
  const cur = { kind: 'cwiczenia', group: 2, tag: 5 } as const;
  it('builds the subject URL with class, group and tag in that order', () => {
    expect(chipHref('PJP', cur, {})).toBe(
      '/s/subjects/PJP?class=cwiczenia&group=2&tag=5',
    );
    expect(chipHref('PJP', { kind: null, group: null, tag: null }, {})).toBe(
      '/s/subjects/PJP',
    );
  });
  it('drops the group when the kind changes', () => {
    expect(chipHref('PJP', cur, { kind: 'wyklad' })).toBe(
      '/s/subjects/PJP?class=wyklad&tag=5',
    );
    expect(chipHref('PJP', cur, { kind: null })).toBe('/s/subjects/PJP?tag=5');
  });
  it('keeps the group when the same kind is chosen again', () => {
    expect(chipHref('PJP', cur, { kind: 'cwiczenia' })).toBe(
      '/s/subjects/PJP?class=cwiczenia&group=2&tag=5',
    );
  });
  it('"Wszystkie" (null) removes the param, others replace it', () => {
    expect(chipHref('PJP', cur, { group: null })).toBe(
      '/s/subjects/PJP?class=cwiczenia&tag=5',
    );
    expect(chipHref('PJP', cur, { tag: null })).toBe(
      '/s/subjects/PJP?class=cwiczenia&group=2',
    );
    expect(chipHref('PJP', cur, { group: 3, tag: 9 })).toBe(
      '/s/subjects/PJP?class=cwiczenia&group=3&tag=9',
    );
  });
  it('encodes the subject code', () => {
    expect(chipHref('A B/ż', { kind: null, group: null, tag: null }, {})).toBe(
      '/s/subjects/A%20B%2F%C5%BC',
    );
  });
});

describe('parseSearchQuery', () => {
  it('trims, takes the first value and caps at 200 chars', () => {
    expect(parseSearchQuery({ q: '  sieci ' })).toBe('sieci');
    expect(parseSearchQuery({ q: ['a', 'b'] })).toBe('a');
    expect(parseSearchQuery({ q: '   ' })).toBe('');
    expect(parseSearchQuery({})).toBe('');
    expect(parseSearchQuery({ q: 'x'.repeat(250) })).toHaveLength(200);
  });
});
