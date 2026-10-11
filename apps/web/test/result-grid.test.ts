import { describe, expect, it } from 'vitest';
import type { Cell } from '../components/DataGrid';
import {
  cellCsvValue,
  compareCells,
  filterRowIndexes,
  footerText,
  formatSeconds,
  materialIdOf,
  pageCountOf,
  resultMessage,
  sortRowIndexes,
  withParams,
} from '../lib/result-grid';

describe('resultMessage', () => {
  it('shows the row range, total and timing with a decimal comma', () => {
    expect(
      resultMessage({ start: 0, count: 25, total: 120, elapsedMs: 1.2 }),
    ).toBe('Pokazano wiersze 0 – 24 (120 łącznie, zapytanie trwało 0,0012 s.)');
  });
  it('offsets the range on later pages', () => {
    expect(
      resultMessage({ start: 50, count: 20, total: 70, elapsedMs: 340 }),
    ).toBe('Pokazano wiersze 50 – 69 (70 łącznie, zapytanie trwało 0,3400 s.)');
  });
  it('omits timing when unknown', () => {
    expect(resultMessage({ start: 0, count: 1, total: 1 })).toBe(
      'Pokazano wiersze 0 – 0 (1 łącznie)',
    );
  });
  it('empty result, with and without timing', () => {
    expect(resultMessage({ start: 0, count: 0, total: 0 })).toBe(
      'MariaDB zwrócił pusty wynik (zero wierszy).',
    );
    expect(
      resultMessage({ start: 0, count: 0, total: 0, elapsedMs: 0.5 }),
    ).toBe(
      'MariaDB zwrócił pusty wynik (zero wierszy). (Zapytanie trwało 0,0005 s.)',
    );
  });
  it('page past the end', () => {
    expect(resultMessage({ start: 100, count: 0, total: 30 })).toBe(
      'Brak wierszy na tej stronie (30 łącznie)',
    );
  });
});

describe('formatSeconds', () => {
  it('4 decimals, comma', () => {
    expect(formatSeconds(0)).toBe('0,0000');
    expect(formatSeconds(1234.56)).toBe('1,2346');
  });
});

describe('footerText', () => {
  it('uses the Polish plural of "wiersz"', () => {
    expect(footerText(1, 1, 1)).toBe('1 wiersz · strona 1 / 1');
    expect(footerText(3, 1, 1)).toBe('3 wiersze · strona 1 / 1');
    expect(footerText(12, 1, 1)).toBe('12 wierszy · strona 1 / 1');
    expect(footerText(22, 2, 3)).toBe('22 wiersze · strona 2 / 3');
    expect(footerText(0, 1, 0)).toBe('0 wierszy · strona 1 / 1');
  });
});

describe('pageCountOf', () => {
  it('at least one page', () => {
    expect(pageCountOf(0, 25)).toBe(1);
    expect(pageCountOf(25, 25)).toBe(1);
    expect(pageCountOf(26, 25)).toBe(2);
  });
});

describe('filter and sort', () => {
  const rows: Cell[][] = [
    ['b', 10, null],
    ['Ą', 2, { text: 'Plik.pdf', preview: 7 }],
    ['a', 2, 'x'],
  ];
  it('filters case-insensitively over cell texts, blank needle keeps all', () => {
    expect(filterRowIndexes(rows, '  ')).toEqual([0, 1, 2]);
    expect(filterRowIndexes(rows, 'PLIK')).toEqual([1]);
    expect(filterRowIndexes(rows, '1')).toEqual([0]);
  });
  it('sorts numbers numerically and stably', () => {
    expect(sortRowIndexes(rows, [0, 1, 2], 1, 'asc')).toEqual([1, 2, 0]);
    expect(sortRowIndexes(rows, [0, 1, 2], 1, 'desc')).toEqual([0, 1, 2]);
  });
  it('sorts text with Polish collation, NULL first', () => {
    expect(sortRowIndexes(rows, [0, 1, 2], 0, 'asc')).toEqual([2, 1, 0]);
    expect(sortRowIndexes(rows, [0, 1, 2], 2, 'asc')).toEqual([0, 1, 2]);
  });
  it('uses the sort key of cell objects', () => {
    expect(compareCells({ text: 'b', sort: 1 }, { text: 'a', sort: 2 })).toBe(
      -1,
    );
  });
});

describe('cellCsvValue', () => {
  it('keeps primitives so the CSV formula guard still applies to strings', () => {
    expect(cellCsvValue(null)).toBeNull();
    expect(cellCsvValue(5)).toBe(5);
    expect(cellCsvValue('=1+1')).toBe('=1+1');
    expect(cellCsvValue({ text: '=HYPERLINK()' })).toBe('=HYPERLINK()');
  });
});

describe('materialIdOf', () => {
  it('accepts positive safe integers only', () => {
    expect(materialIdOf(12)).toBe(12);
    expect(materialIdOf('12')).toBe(12);
    expect(materialIdOf({ text: '9', preview: 9 })).toBe(9);
    for (const v of [0, -1, 1.5, '012', 'x', null, '9007199254740993', true]) {
      expect(materialIdOf(v as Cell), String(v)).toBeNull();
    }
  });
});

describe('withParams', () => {
  it('overrides, deletes and drops an empty query', () => {
    expect(withParams('/t', 'sort=a&page=3', { page: null, dir: 'desc' })).toBe(
      '/t?sort=a&dir=desc',
    );
    expect(withParams('/t', 'page=2', { page: null })).toBe('/t');
    expect(withParams('/t', undefined, { preview: 4 })).toBe('/t?preview=4');
  });
});
