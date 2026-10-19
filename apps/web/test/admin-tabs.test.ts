import { describe, expect, it } from 'vitest';
import { adminTabs } from '../components/shell/admin-tabs';

describe('adminTabs', () => {
  it('lists Overview, SQL — write and Audit log with their hrefs', () => {
    expect(adminTabs('sql').map((t) => [t.label, t.href])).toEqual([
      ['Overview', '/admin'],
      ['SQL — write', '/admin/sql'],
      ['Audit log', '/admin/audit'],
    ]);
  });
  it('marks only the active tab', () => {
    expect(
      adminTabs('sql')
        .filter((t) => t.active)
        .map((t) => t.label),
    ).toEqual(['SQL — write']);
    expect(
      adminTabs('audit')
        .filter((t) => t.active)
        .map((t) => t.href),
    ).toEqual(['/admin/audit']);
  });
});
