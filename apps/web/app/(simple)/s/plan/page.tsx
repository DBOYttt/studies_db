import {
  CalendarBlank,
  UsersThree,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { getPlanSyncStatus } from '@studies/db';
import Link from 'next/link';
import { GroupsTab } from '@/components/plan/GroupsTab';
import { PlanWeekTab } from '@/components/plan/PlanWeekTab';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { getDb } from '@/lib/db';
import { parseEntityTab } from '@/lib/entity-page';
import { formatSyncTime, syncFailed } from '@/lib/plan-view';
import { requireUser } from '@/lib/session';
import { navSubjects } from '@/lib/simple-page';
import { listSubjectCards } from '@/lib/simple-queries';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const TABS = ['week', 'groups'] as const;

const SUB_TABS = [
  ['week', 'Tydzień', CalendarBlank, '/s/plan'],
  ['groups', 'Moje grupy', UsersThree, '/s/plan?tab=groups'],
] as const;

/** Plan zajęć in the simple view: Tydzień and Moje grupy. */
export default async function SimplePlan({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = parseEntityTab(sp, TABS);
  const db = getDb();
  const [cards, status] = await Promise.all([
    listSubjectCards(db),
    // Without the status the screen still works, just without the footer.
    getPlanSyncStatus(db).catch(() => null),
  ]);
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'plan' }}
      crumbs={[
        { label: 'Start', href: '/s' },
        { label: 'Plan zajęć', href: '/s/plan' },
      ]}
      user={user}
    >
      <div>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">
          Plan zajęć
        </h1>
        <p className="mt-1 mb-0 text-pretty text-muted">
          Zajęcia tydzień po tygodniu. W zakładce Moje grupy wybierz swoje
          grupy, aby widzieć tylko własne zajęcia.
        </p>
      </div>
      <nav
        aria-label="Widok planu"
        className="flex w-fit overflow-hidden rounded-md border border-line-strong"
      >
        {SUB_TABS.map(([key, label, I, href], i) => {
          const active = key === tab;
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-3 py-[5px] ${
                i > 0 ? 'border-l border-line-strong' : ''
              } ${
                active
                  ? 'bg-selected font-semibold text-fg'
                  : 'bg-panel text-accent-ink hover:bg-list-hover hover:underline'
              }`}
            >
              <I size={15} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      {status && syncFailed(status) && (
        <div
          role="status"
          className="flex items-center gap-1.5 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
        >
          <Warning size={15} aria-hidden />
          Synchronizacja planu nie powiodła się, pokazuję ostatnie dane.
        </div>
      )}
      {tab === 'week' ? (
        <PlanWeekTab week={sp.week} path="/s/plan" myGroupsFilter simple />
      ) : (
        <GroupsTab weekHref="/s/plan" />
      )}
      {status && (
        <p className="m-0 text-xs text-muted">
          {status.lastOkAt
            ? `Ostatnia synchronizacja: ${formatSyncTime(status.lastOkAt)}`
            : 'Plan nie był jeszcze synchronizowany'}
        </p>
      )}
    </SimpleShell>
  );
}
