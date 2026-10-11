import { describe, expect, it } from 'vitest';
import type { Cell } from '../components/DataGrid';
import {
  cellCsvValue,
  checkedInOrder,
  compareCells,
  defaultResultKey,
  filterRowIndexes,
  footerText,
  formatSeconds,
  materialIdOf,
  pageCountOf,
  pageOptions,
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
  it('filter matched nothing (client mode)', () => {
    expect(
      resultMessage({ start: 0, count: 0, total: 0, unfiltered: 40 }),
    ).toBe('Brak wierszy pasujących do filtra (40 łącznie)');
    expect(
      resultMessage({
        start: 0,
        count: 0,
        total: 0,
        unfiltered: 40,
        elapsedMs: 2,
      }),
    ).toBe(
      'Brak wierszy pasujących do filtra (40 łącznie, zapytanie trwało 0,0020 s.)',
    );
  });
  it('filtered count drives the range (client mode)', () => {
    expect(
      resultMessage({ start: 0, count: 7, total: 7, unfiltered: 40 }),
    ).toBe('Pokazano wiersze 0 – 6 (7 łącznie)');
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

describe('pageOptions', () => {
  it('lists every page up to 50', () => {
    expect(pageOptions(1, 1)).toEqual([1]);
    expect(pageOptions(3, 0)).toEqual([1]);
    expect(pageOptions(2, 50)).toHaveLength(50);
  });
  it('caps many pages: ends, window around current, ~20 steps', () => {
    const o = pageOptions(500, 1000);
    expect(o[0]).toBe(1);
    expect(o.at(-1)).toBe(1000);
    for (let p = 490; p <= 510; p++) expect(o).toContain(p);
    expect(o).toContain(50);
    expect(o).toContain(950);
    expect(o.length).toBeLessThanOrEqual(45);
    expect([...o].sort((a, b) => a - b)).toEqual(o);
    expect(new Set(o).size).toBe(o.length);
  });
  it('always contains the current page, clamped', () => {
    expect(pageOptions(1000, 1000)).toContain(1000);
    expect(pageOptions(999, 1000)).toContain(999);
    expect(pageOptions(5000, 1000)).toContain(990);
  });
});

describe('checkedInOrder', () => {
  it('keeps display order and drops rows outside the order', () => {
    expect(checkedInOrder([5, 2, 9, 1], new Set([1, 5, 7]))).toEqual([5, 1]);
    expect(checkedInOrder([], new Set([1]))).toEqual([]);
  });
});

describe('defaultResultKey', () => {
  const base = { sql: 'SELECT 1', columns: ['a'], rowCount: 3 };
  it('is stable for equal inputs (rows array rebuilt)', () => {
    expect(defaultResultKey(base)).toBe(defaultResultKey({ ...base }));
  });
  it('changes with sql, columns, row count and server state', () => {
    const k = defaultResultKey(base);
    for (const over of [
      { sql: 'SELECT 2' },
      { columns: ['b'] },
      { rowCount: 4 },
      { page: 2 },
      { query: 'f_a=x' },
      { sort: 'a', dir: 'desc' },
      { perPage: 50 },
      { total: 9 },
    ]) {
      expect(
        defaultResultKey({ ...base, ...over }),
        JSON.stringify(over),
      ).not.toBe(k);
    }
  });
});
