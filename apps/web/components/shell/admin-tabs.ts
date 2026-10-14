import {
  ClipboardText,
  Gauge,
  PencilSimpleLine,
  ShieldCheck,
} from '@phosphor-icons/react/dist/ssr';
import type { Crumb, Tab } from './ScreenHeader';

/** First page crumb of every /admin screen. */
export const ADMIN_CRUMB: Crumb = {
  icon: ShieldCheck,
  kind: 'Panel:',
  label: 'Admin',
  href: '/admin',
};

export type AdminTab = 'overview' | 'sql' | 'audit';

/** Tab strip of the /admin area for `<ScreenHeader tabs>` (same pattern as dbTabs). */
export function adminTabs(active: AdminTab): Tab[] {
  const tabs: [AdminTab, string, Tab['icon'], string][] = [
    ['overview', 'Przegląd', Gauge, '/admin'],
    ['sql', 'SQL — zapis', PencilSimpleLine, '/admin/sql'],
    ['audit', 'Dziennik', ClipboardText, '/admin/audit'],
  ];
  return tabs.map(([key, label, icon, href]) => ({
    label,
    icon,
    href,
    active: key === active,
  }));
}
