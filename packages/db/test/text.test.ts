import { describe, expect, it } from 'vitest';
import { plural } from '../src/text.js';

describe('plural', () => {
  it('uses the singular only for 1', () => {
    expect(plural(1, 'file', 'files')).toBe('1 file');
    expect(plural(0, 'file', 'files')).toBe('0 files');
    expect(plural(2, 'file', 'files')).toBe('2 files');
  });
});
