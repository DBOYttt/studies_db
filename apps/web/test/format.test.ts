import { describe, expect, it } from 'vitest';
import { pluralPl } from '../lib/format';

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
