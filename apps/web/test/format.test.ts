import { describe, expect, it } from 'vitest';
import { whenLabel } from '../lib/event-view';
import { formatDate, plural, safeExternalUrl } from '../lib/format';

describe('plural', () => {
  it('uses the singular only for 1', () => {
    expect(plural(0, 'file', 'files')).toBe('0 files');
    expect(plural(1, 'file', 'files')).toBe('1 file');
    expect(plural(2, 'file', 'files')).toBe('2 files');
    expect(plural(5, 'file', 'files')).toBe('5 files');
  });
});

describe('whenLabel', () => {
  const W = (y: number, m: number, d: number, h = 0, mi = 0) =>
    new Date(Date.UTC(y, m - 1, d, h, mi));
  it('formats a wall time in English', () => {
    expect(whenLabel(W(2026, 10, 20, 10), null, false)).toBe(
      'Tue 20 Oct 2026, 10:00',
    );
    expect(whenLabel(W(2026, 10, 20, 10), W(2026, 10, 20, 11, 30), false)).toBe(
      'Tue 20 Oct 2026, 10:00–11:30',
    );
    expect(whenLabel(W(2026, 10, 20), null, true)).toBe(
      'Tue 20 Oct 2026, all day',
    );
  });
});

describe('formatDate', () => {
  it('formats Date and ISO string alike (JSON API dates)', () => {
    const iso = '2026-03-01T10:00:00.000Z';
    expect(formatDate(iso)).toBe(formatDate(new Date(iso)));
    expect(formatDate(iso)).toMatch(/2026/);
  });
  it('spells September "Sep", not "Sept"', () => {
    expect(formatDate(new Date('2026-09-15T10:00:00Z'))).toBe('15 Sep 2026');
  });
});

describe('safeExternalUrl', () => {
  it('keeps http(s) URLs', () => {
    expect(safeExternalUrl('https://upel.agh.edu.pl/x')).toBe(
      'https://upel.agh.edu.pl/x',
    );
    expect(safeExternalUrl('  http://example.edu/a?b=1  ')).toBe(
      'http://example.edu/a?b=1',
    );
  });
  it('rejects other schemes, relative and malformed URLs', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,x',
      'mailto:a@example.edu',
      'ftp://example.edu/',
      '//example.edu/x',
      '/relative',
      'upel.agh.edu.pl',
      'https://',
      '',
    ]) {
      expect(safeExternalUrl(bad), bad).toBeNull();
    }
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});
