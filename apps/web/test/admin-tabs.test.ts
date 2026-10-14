import { describe, expect, it } from 'vitest';
import { adminTabs } from '../components/shell/admin-tabs';

describe('adminTabs', () => {
  it('lists Przegląd, SQL — zapis and Dziennik with their hrefs', () => {
    expect(adminTabs('sql').map((t) => [t.label, t.href])).toEqual([
      ['Przegląd', '/admin'],
      ['SQL — zapis', '/admin/sql'],
      ['Dziennik', '/admin/audit'],
    ]);
  });
  it('marks only the active tab', () => {
    expect(
      adminTabs('sql')
        .filter((t) => t.active)
        .map((t) => t.label),
    ).toEqual(['SQL — zapis']);
    expect(
      adminTabs('audit')
        .filter((t) => t.active)
        .map((t) => t.href),
    ).toEqual(['/admin/audit']);
  });
});
