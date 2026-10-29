import { describe, expect, it } from 'vitest';
import { adminTabs } from '../components/shell/admin-tabs';

describe('adminTabs', () => {
  it('lists every admin tab in order with its href', () => {
    expect(adminTabs('sql').map((t) => [t.label, t.href])).toEqual([
      ['Overview', '/admin'],
      ['Subjects', '/admin/subjects'],
      ['Lecturers', '/admin/lecturers'],
      ['Users', '/admin/users'],
      ['Sync', '/admin/sync'],
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
    expect(
      adminTabs('lecturers')
        .filter((t) => t.active)
        .map((t) => t.href),
    ).toEqual(['/admin/lecturers']);
  });
});
