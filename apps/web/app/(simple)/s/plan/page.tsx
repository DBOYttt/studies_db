import {
  CalendarBlank,
  UsersThree,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { getPlanSyncStatus, type PlanSyncStatus } from '@studies/db';
import Link from 'next/link';
import { Suspense } from 'react';
import { GroupsTab } from '@/components/plan/GroupsTab';
import { PlanWeekTab } from '@/components/plan/PlanWeekTab';
import { PlanWeekSkeleton } from '@/components/Skeleton';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb } from '@/lib/db';
import { parseEntityTab } from '@/lib/entity-page';
import { syncFailed, syncLine } from '@/lib/plan-view';
import { requireUser } from '@/lib/session';
import { navSubjects } from '@/lib/simple-page';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const TABS = ['week', 'groups'] as const;

const SUB_TABS = [
  ['week', 'Week', CalendarBlank, '/s/plan'],
  ['groups', 'My groups', UsersThree, '/s/plan?tab=groups'],
] as const;

/** Timetable in the simple view: Week and My groups. */
export default async function SimplePlan({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = parseEntityTab(sp, TABS);
  const db = getDb();
  // Without the status the screen still works, just without the footer.
  // Not awaited here: it loads alongside the tab's data.
  const status = getPlanSyncStatus(db).catch(() => null);
  const cards = await cachedSubjectCards();
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'plan' }}
      crumbs={[
        { label: 'Start', href: '/s' },
        { label: 'Timetable', href: '/s/plan' },
      ]}
      user={user}
      adminEntry={user.isAdmin ? <SimpleAdminEntry /> : null}
    >
      <div>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">
          Timetable
        </h1>
        <p className="mt-1 mb-0 text-pretty text-muted">
          Classes week by week. Pick your groups in the My groups tab to see
          only your own classes.
        </p>
      </div>
      <nav
        aria-label="Timetable view"
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
      <SyncWarning status={status} />
      {tab === 'week' ? (
        <Suspense fallback={<PlanWeekSkeleton />}>
          <PlanWeekTab week={sp.week} path="/s/plan" myGroupsFilter simple />
        </Suspense>
      ) : (
        <GroupsTab weekHref="/s/plan" />
      )}
      <SyncFooter status={status} />
    </SimpleShell>
  );
}

type StatusPromise = Promise<PlanSyncStatus | null>;

async function SyncWarning({ status }: { status: StatusPromise }) {
  const s = await status;
  if (!s || !syncFailed(s)) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-1.5 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
    >
      <Warning size={15} aria-hidden />
      Timetable sync failed; showing the last data.
    </div>
  );
}

async function SyncFooter({ status }: { status: StatusPromise }) {
  const s = await status;
  return s ? (
    <p className="m-0 text-xs text-muted">{syncLine(s.lastOkAt)}</p>
  ) : null;
}
