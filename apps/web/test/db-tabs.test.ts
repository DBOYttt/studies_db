import { CalendarBlank } from '@phosphor-icons/react/dist/ssr';
import { describe, expect, it } from 'vitest';
import { dbTabs } from '../components/shell/db-tabs';

describe('dbTabs', () => {
  it('Plan comes first, then the existing tabs', () => {
    const tabs = dbTabs('plan');
    expect(tabs.map((t) => [t.label, t.href])).toEqual([
      ['Plan', '/plan'],
      ['Przedmioty', '/'],
      ['Struktura', '/structure'],
      ['SQL', '/sql'],
      ['Szukaj', '/search'],
      ['Projektant', '/schema'],
    ]);
    expect(tabs[0].icon).toBe(CalendarBlank);
    expect(tabs.filter((t) => t.active).map((t) => t.label)).toEqual(['Plan']);
  });
  it('marks only the active tab', () => {
    expect(
      dbTabs('sql')
        .filter((t) => t.active)
        .map((t) => t.label),
    ).toEqual(['SQL']);
  });
});
