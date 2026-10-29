import { describe, expect, it } from 'vitest';
import { field } from '@/lib/admin-forms';

describe('field', () => {
  it('normalises CRLF and lone CR to LF', () => {
    const f = new FormData();
    f.set('a', 'x\r\ny\rz\n');
    expect(field(f, 'a')).toBe('x\ny\nz\n');
  });
  it('reads a missing or file entry as empty', () => {
    const f = new FormData();
    f.set('file', new Blob(['x']));
    expect(field(f, 'nope')).toBe('');
    expect(field(f, 'file')).toBe('');
  });
});
