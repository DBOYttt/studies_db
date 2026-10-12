import { describe, expect, it } from 'vitest';
import { formatDate, pluralPl, safeExternalUrl } from '../lib/format';

describe('pluralPl', () => {
  const f = (n: number) => pluralPl(n, 'plik', 'pliki', 'plików');
  it('1 -> singular', () => {
    expect(f(1)).toBe('plik');
  });
  it('2–4 (not 12–14) -> few', () => {
    for (const n of [2, 3, 4, 22, 23, 24, 32, 102, 104, 1002]) {
      expect(f(n), String(n)).toBe('pliki');
    }
  });
  it('everything else -> many', () => {
    for (const n of [
      0, 5, 9, 10, 11, 12, 13, 14, 15, 20, 21, 25, 101, 111, 112, 114, 1000,
    ]) {
      expect(f(n), String(n)).toBe('plików');
    }
  });
});

describe('formatDate', () => {
  it('formats Date and ISO string alike (JSON API dates)', () => {
    const iso = '2026-03-01T10:00:00.000Z';
    expect(formatDate(iso)).toBe(formatDate(new Date(iso)));
    expect(formatDate(iso)).toMatch(/2026/);
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
