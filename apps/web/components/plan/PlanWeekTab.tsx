import { WeekView } from '@/components/plan/WeekView';
import { getDb, getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
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
  type PlanFilter,
  sessionRange,
} from '@/lib/plan-queries';
import { toWeekSession, wallDateKey, weekNav } from '@/lib/plan-view';
import { loadLinkContext } from '@/lib/queries';

const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';

/**
 * Week timetable of /plan, a subject or a lecturer (server part): `?week=`
 * or the default week of the filtered sessions; week links go to `path` with
 * the `extra` params (e.g. `tab=plan`) before `week`.
 */
export async function PlanWeekTab({
  week: rawWeek,
  path,
  extra,
  filter = {},
  myGroupsFilter,
  simple = false,
}: {
  week: string | string[] | undefined;
  path: string;
  extra?: Record<string, string>;
  filter?: PlanFilter;
  myGroupsFilter: boolean;
  /** Simple (Prosty) view: session links stay in /s, no SQL link. */
  simple?: boolean;
}) {
  const pool = getRoPool();
  const now = nowWall();
  const raw = typeof rawWeek === 'string' ? rawWeek : undefined;
  try {
    const week =
      parseIsoWeek(raw) ?? defaultWeek(now, await sessionRange(pool, filter));
    const [{ rows }, links, options] = await Promise.all([
      listWeekSessions(pool, week, filter),
      // Without the lookups blocks link to the subject only.
      loadLinkContext(getDb()).catch(() => undefined),
      myGroupsFilter ? listMyGroupOptions(pool) : Promise.resolve(null),
    ]);
    const validGroups = options
      ? Object.fromEntries(
          options.map((o) => [String(o.classId), o.groups.map((g) => g.id)]),
        )
      : undefined;
    return (
      <WeekView
        week={week}
        days={weekDays(rows, week).map((d) => d.toISOString())}
        sessions={rows.map((s) => toWeekSession(s, links, simple))}
        nav={weekNav(path, week, isoWeekOf(now), extra)}
        today={wallDateKey(now)}
        myGroupsFilter={myGroupsFilter}
        validGroups={validGroups}
        simple={simple}
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
