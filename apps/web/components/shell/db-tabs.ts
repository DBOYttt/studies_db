import {
  Books,
  CalendarBlank,
  MagnifyingGlass,
  Table,
  TerminalWindow,
  TreeStructure,
} from '@phosphor-icons/react/dist/ssr';
import type { Tab } from './ScreenHeader';

export type DbTab =
  | 'plan'
  | 'subjects'
  | 'structure'
  | 'sql'
  | 'search'
  | 'designer';

/** Database-level tab strip (design line 746) for `<ScreenHeader tabs>`. */
export function dbTabs(active: DbTab): Tab[] {
  const tabs: [DbTab, string, Tab['icon'], string][] = [
    ['plan', 'Plan', CalendarBlank, '/plan'],
    ['subjects', 'Przedmioty', Books, '/'],
    ['structure', 'Struktura', Table, '/structure'],
    ['sql', 'SQL', TerminalWindow, '/sql'],
    ['search', 'Szukaj', MagnifyingGlass, '/search'],
    ['designer', 'Projektant', TreeStructure, '/schema'],
  ];
  return tabs.map(([key, label, icon, href]) => ({
    label,
    icon,
    href,
    active: key === active,
  }));
}
