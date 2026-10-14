import { ShieldCheck } from '@phosphor-icons/react/ssr';
import { navRow, navRowIdle } from './nav-classes';

/**
 * "Panel admina" in the simple sidebar. A server component, rendered only
 * for admins and passed to SimpleShell, so other users never receive it.
 * The admin pages live in the advanced shell: switch the mode cookie too,
 * so "/" does not bounce back to /s afterwards.
 */
export function SimpleAdminEntry() {
  return (
    <a
      href="/mode?to=advanced&next=%2Fadmin"
      className={`${navRow} font-medium text-accent-ink ${navRowIdle}`}
    >
      <span aria-hidden className="grid">
        <ShieldCheck size={18} />
      </span>
      Panel admina
    </a>
  );
}
