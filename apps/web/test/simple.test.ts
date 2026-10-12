import { describe, expect, it } from 'vitest';
import {
  fileIcon,
  highlightParts,
  parseSimpleFilters,
  REPORT_LABELS,
  REPORT_META,
  statusBadge,
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
  const groups = { wyklad: [], cwiczenia: [5, 6] };
  const k = [...kinds];
  it('accepts valid values', () => {
    expect(
      parseSimpleFilters(
        { class: 'cwiczenia', group: '5', tag: '9' },
        k,
        groups,
        [9],
      ),
    ).toEqual({ kind: 'cwiczenia', group: 5, tag: 9 });
  });
  it('drops unknown kind, foreign group and foreign tag', () => {
    expect(
      parseSimpleFilters(
        { class: 'lab', group: '5', tag: '3' },
        k,
        groups,
        [9],
      ),
    ).toEqual({ kind: null, group: null, tag: null });
    expect(
      parseSimpleFilters({ class: 'wyklad', group: '5' }, k, groups, []),
    ).toEqual({ kind: 'wyklad', group: null, tag: null });
    expect(parseSimpleFilters({ group: '5' }, k, groups, []).group).toBeNull();
  });
  it('ignores junk and arrays', () => {
    expect(
      parseSimpleFilters(
        { class: ['cwiczenia', 'x'], group: ['6'], tag: 'abc' },
        k,
        groups,
        [9],
      ),
    ).toEqual({ kind: 'cwiczenia', group: 6, tag: null });
    expect(
      parseSimpleFilters({ class: 'cwiczenia', group: '5.5' }, k, groups, [])
        .group,
    ).toBeNull();
  });
});
