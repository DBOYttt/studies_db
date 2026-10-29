import {
  ArrowsClockwise,
  Books,
  ChalkboardTeacher,
  ClipboardText,
  Gauge,
  PencilSimpleLine,
  ShieldCheck,
  Users,
} from '@phosphor-icons/react/dist/ssr';
import type { Crumb, Tab } from './ScreenHeader';

/** First page crumb of every /admin screen. */
export const ADMIN_CRUMB: Crumb = {
  icon: ShieldCheck,
  kind: 'Panel:',
  label: 'Admin',
  href: '/admin',
};

export type AdminTab =
  | 'overview'
  | 'subjects'
  | 'lecturers'
  | 'users'
  | 'sync'
  | 'sql'
  | 'audit';

/** Tab strip of the /admin area for `<ScreenHeader tabs>` (same pattern as dbTabs). */
export function adminTabs(active: AdminTab): Tab[] {
  const tabs: [AdminTab, string, Tab['icon'], string][] = [
    ['overview', 'Overview', Gauge, '/admin'],
    ['subjects', 'Subjects', Books, '/admin/subjects'],
    ['lecturers', 'Lecturers', ChalkboardTeacher, '/admin/lecturers'],
    ['users', 'Users', Users, '/admin/users'],
    ['sync', 'Sync', ArrowsClockwise, '/admin/sync'],
    ['sql', 'SQL — write', PencilSimpleLine, '/admin/sql'],
    ['audit', 'Audit log', ClipboardText, '/admin/audit'],
  ];
  return tabs.map(([key, label, icon, href]) => ({
    label,
    icon,
    href,
    active: key === active,
  }));
}
