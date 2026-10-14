import { describe, expect, it } from 'vitest';
import { safeNext } from '../lib/login-next';

describe('login safeNext', () => {
  it('accepts /admin paths', () => {
    expect(safeNext('/admin')).toBe('/admin');
    expect(safeNext('/admin/sql')).toBe('/admin/sql');
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
    null,
    undefined,
    42,
    `/admin/${'a'.repeat(200)}`,
  ])('rejects %j', (raw) => {
    expect(safeNext(raw)).toBeNull();
  });
  it('accepts exactly 200 characters', () => {
    const p = `/admin/${'a'.repeat(193)}`;
    expect(p).toHaveLength(200);
    expect(safeNext(p)).toBe(p);
  });
});
