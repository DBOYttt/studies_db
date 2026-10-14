import { describe, expect, it } from 'vitest';
import {
  AUDIT_PAGE_SIZE,
  auditHref,
  auditStatementPreview,
  formatAuditTime,
  parseAuditQuery,
} from '../lib/admin-audit';

describe('parseAuditQuery', () => {
  it('defaults to page 1 without filters', () => {
    expect(parseAuditQuery({})).toEqual({ page: 1 });
  });
  it('reads user, action and page', () => {
    expect(
      parseAuditQuery({ user: '3', action: 'sql.rejected', page: '4' }),
    ).toEqual({ page: 4, userId: 3, action: 'sql.rejected' });
  });
  it('ignores invalid values', () => {
    expect(parseAuditQuery({ user: 'x', action: 'drop', page: '-2' })).toEqual({
      page: 1,
    });
    expect(parseAuditQuery({ user: ['1', '2'], page: '1.5' })).toEqual({
      page: 1,
    });
  });
});

describe('auditHref', () => {
  it('keeps filters and omits page 1', () => {
    expect(auditHref({ page: 1 })).toBe('/admin/audit');
    expect(auditHref({ page: 2, userId: 3, action: 'sql.execute' })).toBe(
      '/admin/audit?user=3&action=sql.execute&page=2',
    );
  });
});

describe('formatAuditTime', () => {
  it('formats in Europe/Warsaw', () => {
    // 2026-01-15 11:05:09 UTC = 12:05:09 in Warsaw (CET)
    expect(formatAuditTime(new Date(Date.UTC(2026, 0, 15, 11, 5, 9)))).toBe(
      '15.01.2026, 12:05:09',
    );
    // summer time (CEST, UTC+2)
    expect(formatAuditTime(new Date(Date.UTC(2026, 6, 1, 22, 0, 0)))).toBe(
      '02.07.2026, 00:00:00',
    );
  });
});

describe('auditStatementPreview', () => {
  it('keeps short statements on one line', () => {
    expect(auditStatementPreview('UPDATE t\n  SET a = 1')).toBe(
      'UPDATE t SET a = 1',
    );
  });
  it('cuts to 120 characters', () => {
    const s = auditStatementPreview(`SELECT ${'x'.repeat(300)}`);
    expect(s).toHaveLength(120);
    expect(s.endsWith('…')).toBe(true);
  });
  it('handles null', () => {
    expect(auditStatementPreview(null)).toBe('');
  });
});

it('pages by 50', () => {
  expect(AUDIT_PAGE_SIZE).toBe(50);
});
