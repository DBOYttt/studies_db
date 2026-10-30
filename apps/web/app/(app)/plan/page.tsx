import type { Icon } from '@phosphor-icons/react';
import {
  CalendarBlank,
  ListBullets,
  UsersThree,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { getPlanSyncStatus, type PlanSyncStatus } from '@studies/db';
import Link from 'next/link';
import { Suspense } from 'react';
import { Notice } from '@/components/Notice';
import { errBox, GroupsTab } from '@/components/plan/GroupsTab';
import { PlanWeekTab } from '@/components/plan/PlanWeekTab';
import { ResultGrid } from '@/components/ResultGrid';
import { PlanWeekSkeleton } from '@/components/Skeleton';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { toCells } from '@/lib/cells';
import { getDb, getViewsPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import {
  type EntityGridParams,
  entityGridQuery,
  parseEntityGrid,
  parseEntityTab,
} from '@/lib/entity-page';
import { noticeFromSearchParams } from '@/lib/notices';
import { planListPage } from '@/lib/plan-queries';
import { syncFailed, syncLine, wallSqlText } from '@/lib/plan-view';
import { loadLinkContext } from '@/lib/queries';
import { requireUser } from '@/lib/session';
import { listFrom } from '@/lib/today';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const TABS = ['week', 'list', 'groups'] as const;
type PlanTab = (typeof TABS)[number];

const SUB_TABS: [PlanTab, string, Icon, string][] = [
  ['week', 'Week', CalendarBlank, '/plan'],
  ['list', 'List', ListBullets, '/plan?tab=list'],
  ['groups', 'My groups', UsersThree, '/plan?tab=groups'],
];

/** Timetable: Week, List, My groups. */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireUser();
  const sp = await searchParams;
  const tab = parseEntityTab(sp, TABS);
  // Without the status the screen still works, just without the footer.
  // Not awaited here: it loads alongside the tab's data.
  const status = getPlanSyncStatus(getDb()).catch(() => null);

  return (
    <>
      <ScreenHeader
        crumbs={[{ icon: CalendarBlank, label: 'Timetable', href: '/plan' }]}
        tabs={dbTabs('plan')}
      />
      <h1 className="sr-only">Timetable</h1>
      <div className="flex flex-col gap-3.5">
        <Notice text={noticeFromSearchParams(sp)} />
        <nav
          aria-label="Timetable view"
          className="flex self-start overflow-hidden rounded-md border border-line-strong"
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
        <SyncWarningSlot status={status} />
        {tab === 'week' && (
          <Suspense fallback={<PlanWeekSkeleton />}>
            <PlanWeekTab week={sp.week} path="/plan" myGroupsFilter />
          </Suspense>
        )}
        {tab === 'list' && (
          <ListTab grid={parseEntityGrid(sp)} from={listFrom(sp, new Date())} />
        )}
        {tab === 'groups' && <GroupsTab weekHref="/plan" />}
        <SyncFooter status={status} />
      </div>
    </>
  );
}

type StatusPromise = Promise<PlanSyncStatus | null>;

async function SyncWarningSlot({ status }: { status: StatusPromise }) {
  const s = await status;
  return s && syncFailed(s) ? <SyncWarning status={s} /> : null;
}

async function SyncFooter({ status }: { status: StatusPromise }) {
  const s = await status;
  return s ? (
    <p className="m-0 text-xs text-muted">{syncLine(s.lastOkAt)}</p>
  ) : null;
}

function SyncWarning({ status }: { status: PlanSyncStatus }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <Warning size={15} aria-hidden />
        Sync failed — showing the last data
      </span>
      <details>
        <summary className="cursor-pointer">Error details</summary>
        <pre className="mt-1 font-mono text-xs break-words whitespace-pre-wrap">
          {status.lastError}
        </pre>
      </details>
    </div>
  );
}

/** Wall DATETIME columns of v_class_sessions, shown as MariaDB prints them. */
const WALL_COLUMNS = new Set(['starts_at', 'ends_at']);

async function ListTab({
  grid,
  from,
}: {
  grid: EntityGridParams;
  /** Wall today 00:00, or null with "Show past". */
  from: Date | null;
}) {
  const [result, links] = await Promise.all([
    planListPage(getViewsPool(), {
      page: grid.page,
      perPage: grid.perPage,
      from,
    }).then(
      (page) => ({ page, error: null }),
      (err: unknown) => ({ page: null, error: roErrorMessage(err) }),
    ),
    loadLinkContext(getDb()).catch(() => undefined),
  ]);
  const { page } = result;
  const toggle = <PastToggle grid={grid} showingPast={from === null} />;
  if (!page) {
    return (
      <>
        {toggle}
        <div role="alert" className={errBox}>
          Could not load data: {result.error ?? 'no data'}
        </div>
      </>
    );
  }
  // toJsonValue turned the wall Dates into ISO strings with a misleading `Z`.
  const rows = page.rows.map((r) =>
    r.map((v, i) =>
      WALL_COLUMNS.has(page.columns[i]) && typeof v === 'string'
        ? wallSqlText(v)
        : v,
    ),
  );
  const query = (n: number) => {
    const q = entityGridQuery('list', grid, n);
    return from === null ? `${q}&past=1` : q;
  };
  return (
    <>
      {toggle}
      <ResultGrid
        columns={page.columns}
        rows={toCells(rows, {
          view: 'v_class_sessions',
          columns: page.columns,
          links,
        })}
        sql={page.sql}
        total={page.total}
        nav={{
          basePath: '/plan',
          query: query(page.page),
        }}
        paging={{
          page: page.page,
          pageCount: page.pageCount,
          perPage: page.perPage,
        }}
        // Fixed order (starts_at, id): no sortable headers.
        sorting={{
          sort: 'starts_at',
          dir: 'asc',
          sortKeys: page.columns.map(() => null),
        }}
        name="timetable"
      />
    </>
  );
}

/** "Show past" / "From today" switch above the List (back to page 1). */
function PastToggle({
  grid,
  showingPast,
}: {
  grid: EntityGridParams;
  showingPast: boolean;
}) {
  const q = entityGridQuery('list', grid, 1);
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-muted">
      {showingPast ? 'Showing all sessions.' : 'Showing sessions from today.'}
      <Link
        href={`/plan?${showingPast ? q : `${q}&past=1`}`}
        className="text-accent-ink hover:text-accent-ink-hover hover:underline"
      >
        {showingPast ? 'From today' : 'Show past'}
      </Link>
    </p>
  );
}
