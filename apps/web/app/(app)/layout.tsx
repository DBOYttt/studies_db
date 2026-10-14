import { SignOut } from '@phosphor-icons/react/dist/ssr';
import { PUBLIC_VIEWS } from '@studies/db/constants';
import type { ReactNode } from 'react';
import { AdminNavLink } from '@/components/shell/AdminNavLink';
import { ConsoleFooter } from '@/components/shell/ConsoleFooter';
import { ModeSwitch } from '@/components/shell/ModeSwitch';
import { NavPanel } from '@/components/shell/NavPanel';
import { ShellFrame } from '@/components/shell/ShellFrame';
import { getDb, getRoPool } from '@/lib/db';
import type { NavView } from '@/lib/nav-tree';
import { getNavSubjects } from '@/lib/queries';
import { requireUser } from '@/lib/session';
import { countViewRows } from '@/lib/tables';

async function viewCounts() {
  try {
    return await countViewRows(getRoPool());
  } catch {
    return null; // e.g. DATABASE_RO_URL missing: no counts, layout still renders
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [subjects, counts] = await Promise.all([
    getNavSubjects(getDb()),
    viewCounts(),
  ]);
  const views: NavView[] = PUBLIC_VIEWS.map((v) => ({
    name: v,
    rowCount: counts?.[v] ?? null,
    href: `/tables/${v}`,
  }));
  return (
    <ShellFrame
      nav={
        <NavPanel
          subjects={subjects}
          views={views}
          adminEntry={user.isAdmin ? <AdminNavLink /> : null}
        />
      }
      footer={<ConsoleFooter />}
      topbarEnd={
        <>
          <ModeSwitch mode="advanced" />
          <span className="text-subtle max-md:hidden" aria-hidden>
            |
          </span>
          {user.avatarUrl ? (
            // biome-ignore lint/performance/noImgElement: external Discord CDN avatar
            <img
              src={user.avatarUrl}
              alt=""
              width={22}
              height={22}
              className="size-[22px] rounded-full"
            />
          ) : (
            <span
              aria-hidden
              className="grid size-[22px] place-items-center rounded-full bg-discord text-[11px] font-semibold text-white"
            >
              {([...user.displayName.trim()][0] ?? '?').toLocaleUpperCase('pl')}
            </span>
          )}
          <span className="max-w-[160px] truncate text-fg max-md:sr-only">
            {user.displayName}
          </span>
          <span className="text-subtle max-md:hidden" aria-hidden>
            |
          </span>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="flex items-center gap-1 text-accent-ink hover:text-accent-ink-hover hover:underline"
            >
              <SignOut aria-hidden />
              <span className="max-md:sr-only">Wyloguj</span>
            </button>
          </form>
        </>
      }
    >
      {children}
    </ShellFrame>
  );
}
