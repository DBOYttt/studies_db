import type { Icon } from '@phosphor-icons/react';
import {
  CalendarBlank,
  ListBullets,
  UsersThree,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { getPlanSyncStatus, type PlanSyncStatus } from '@studies/db';
import Link from 'next/link';
import { MyGroupsForm } from '@/components/plan/MyGroupsForm';
import { WeekView } from '@/components/plan/WeekView';
import { ResultGrid } from '@/components/ResultGrid';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { toCells } from '@/lib/cells';
import { getDb, getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import {
  type EntityGridParams,
  entityGridQuery,
  parseEntityGrid,
  parseEntityTab,
} from '@/lib/entity-page';
import {
  defaultWeek,
  isoWeekOf,
  nowWall,
  parseIsoWeek,
  weekDays,
} from '@/lib/plan';
import {
  listMyGroupOptions,
  listWeekSessions,
  planListPage,
  sessionRange,
} from '@/lib/plan-queries';
import {
  formatSyncTime,
  syncFailed,
  toWeekSession,
  wallDateKey,
  wallSqlText,
  weekNav,
} from '@/lib/plan-view';
import { loadLinkContext } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const TABS = ['week', 'list', 'groups'] as const;
type PlanTab = (typeof TABS)[number];

const SUB_TABS: [PlanTab, string, Icon, string][] = [
  ['week', 'Tydzień', CalendarBlank, '/plan'],
  ['list', 'Lista', ListBullets, '/plan?tab=list'],
  ['groups', 'Moje grupy', UsersThree, '/plan?tab=groups'],
];

const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';

/** Plan zajęć (timetable): Tydzień, Lista, Moje grupy. */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireUser();
  const sp = await searchParams;
  const tab = parseEntityTab(sp, TABS);
  // Without the status the screen still works, just without the footer.
  const status = await getPlanSyncStatus(getDb()).catch(() => null);

  return (
    <>
      <ScreenHeader
        crumbs={[{ icon: CalendarBlank, label: 'Plan zajęć', href: '/plan' }]}
        tabs={dbTabs('plan')}
      />
      <h1 className="sr-only">Plan zajęć</h1>
      <div className="flex flex-col gap-3.5">
        <nav
          aria-label="Widok planu"
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
        {status && syncFailed(status) && <SyncWarning status={status} />}
        {tab === 'week' && <WeekTab sp={sp} />}
        {tab === 'list' && <ListTab grid={parseEntityGrid(sp)} />}
        {tab === 'groups' && <GroupsTab />}
        {status && (
          <p className="m-0 text-xs text-muted">
            {status.lastOkAt
              ? `Ostatnia synchronizacja: ${formatSyncTime(status.lastOkAt)}`
              : 'Plan nie był jeszcze synchronizowany'}
          </p>
        )}
      </div>
    </>
  );
}

function SyncWarning({ status }: { status: PlanSyncStatus }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <Warning size={15} aria-hidden />
        Synchronizacja nie powiodła się — pokazuję ostatnie dane
      </span>
      <details>
        <summary className="cursor-pointer">Szczegóły błędu</summary>
        <pre className="mt-1 font-mono text-xs break-words whitespace-pre-wrap">
          {status.lastError}
        </pre>
      </details>
    </div>
  );
}

async function WeekTab({ sp }: { sp: SP }) {
  const pool = getRoPool();
  const now = nowWall();
  const raw = typeof sp.week === 'string' ? sp.week : undefined;
  try {
    const week =
      parseIsoWeek(raw) ?? defaultWeek(now, await sessionRange(pool));
    const [{ rows }, links] = await Promise.all([
      listWeekSessions(pool, week),
      // Without the lookups blocks link to the subject only.
      loadLinkContext(getDb()).catch(() => undefined),
    ]);
    return (
      <WeekView
        week={week}
        days={weekDays(rows, week).map((d) => d.toISOString())}
        sessions={rows.map((s) => toWeekSession(s, links))}
        nav={weekNav('/plan', week, isoWeekOf(now))}
        today={wallDateKey(now)}
        myGroupsFilter
      />
    );
  } catch (err) {
    return (
      <div role="alert" className={errBox}>
        Nie udało się wczytać planu: {roErrorMessage(err)}
      </div>
    );
  }
}

/** Wall DATETIME columns of v_class_sessions, shown as MariaDB prints them. */
const WALL_COLUMNS = new Set(['starts_at', 'ends_at']);

async function ListTab({ grid }: { grid: EntityGridParams }) {
  const [result, links] = await Promise.all([
    planListPage(getRoPool(), { page: grid.page, perPage: grid.perPage }).then(
      (page) => ({ page, error: null }),
      (err: unknown) => ({ page: null, error: roErrorMessage(err) }),
    ),
    loadLinkContext(getDb()).catch(() => undefined),
  ]);
  const { page } = result;
  if (!page) {
    return (
      <div role="alert" className={errBox}>
        Nie udało się wczytać danych: {result.error ?? 'brak danych'}
      </div>
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
  return (
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
        query: entityGridQuery('list', grid, page.page),
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
      name="plan-zajec"
    />
  );
}

async function GroupsTab() {
  try {
    const options = await listMyGroupOptions(getRoPool());
    return <MyGroupsForm options={options} weekHref="/plan" />;
  } catch (err) {
    return (
      <div role="alert" className={errBox}>
        Nie udało się wczytać zajęć: {roErrorMessage(err)}
      </div>
    );
  }
}
