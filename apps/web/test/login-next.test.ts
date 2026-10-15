import { describe, expect, it } from 'vitest';
import { safeLoginNext } from '../lib/login-next';

describe('safeLoginNext', () => {
  it('accepts /admin paths', () => {
    expect(safeLoginNext('/admin')).toBe('/admin');
    expect(safeLoginNext('/admin/sql')).toBe('/admin/sql');
  });
  it.each([
    '/',
    '/s',
    '/administrator',
    '//evil.com',
    '/\\evil',
    '/admin//x',
    'https://evil.com',
    '/admin%2F..',
    '/admin%2f..',
    '/admin%5Cx',
    '/admin\n',
    '/admin\r',
    '/admin:x',
    '/admin/ż',
    '/admin\0',
    '/admin\t',
    '/admin/ x',
    '/admin/\x7f',
    null,
    undefined,
    42,
    `/admin/${'a'.repeat(200)}`,
  ])('rejects %j', (raw) => {
    expect(safeLoginNext(raw)).toBeNull();
  });
  it('accepts exactly 200 characters', () => {
    const p = `/admin/${'a'.repeat(193)}`;
    expect(p).toHaveLength(200);
    expect(safeLoginNext(p)).toBe(p);
  });
});
