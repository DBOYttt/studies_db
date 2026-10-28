import { getMyGroups, listEventsInRange } from '@studies/db';
import { listWeekMarks } from '@studies/db/plan';
import { MyGroupsImport } from '@/components/plan/MyGroupsImport';
import { WeekView } from '@/components/plan/WeekView';
import { getDb, getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import {
  defaultWeek,
  type IsoWeek,
  isoWeekOf,
  nowWall,
  parseIsoWeek,
  sanitizeMyGroups,
  shiftWeek,
  weekDays,
  weekStart,
} from '@/lib/plan';
import {
  annotatePlanWeek,
  eventsForFilter,
  newEventHref,
} from '@/lib/plan-events';
import {
  listMyGroupOptions,
  listWeekSessions,
  type PlanFilter,
  sessionRange,
} from '@/lib/plan-queries';
import { toWeekSession, wallDateKey, weekNav } from '@/lib/plan-view';
import { loadLinkContext } from '@/lib/queries';
import { requireUser } from '@/lib/session';

const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';

/**
 * The week shown without `?week=` (`defaultWeek`): when that is the current
 * week, the ends of its sessions and events (as the plan filter keeps them)
 * decide whether it is already over.
 */
async function openingWeek(
  pool: ReturnType<typeof getRoPool>,
  now: Date,
  filter: PlanFilter,
): Promise<IsoWeek> {
  const range = await sessionRange(pool, filter);
  const current = isoWeekOf(now);
  const week = defaultWeek(now, range);
  if (week.year !== current.year || week.week !== current.week) return week;
  const [{ rows }, events] = await Promise.all([
    listWeekSessions(pool, current, filter),
    listEventsInRange(
      pool,
      weekStart(current),
      weekStart(shiftWeek(current, 1)),
    ),
  ]);
  const ends = [...rows, ...eventsForFilter(events, filter)].map(
    (s) => s.endsAt,
  );
  return defaultWeek(now, range, ends);
}

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
  /** Simple view: session links stay in /s, no SQL link. */
  simple?: boolean;
}) {
  const pool = getRoPool();
  const now = nowWall();
  // Outside the try: a redirect must not end up in the error box.
  const user = myGroupsFilter ? await requireUser() : null;
  const raw = typeof rawWeek === 'string' ? rawWeek : undefined;
  try {
    const week = parseIsoWeek(raw) ?? (await openingWeek(pool, now, filter));
    const [{ rows: classRows }, events, links, options, stored] =
      await Promise.all([
        listWeekSessions(pool, week, filter),
        listEventsInRange(pool, weekStart(week), weekStart(shiftWeek(week, 1))),
        // Without the lookups blocks link to the subject only.
        loadLinkContext(getDb()).catch(() => undefined),
        myGroupsFilter ? listMyGroupOptions(pool) : Promise.resolve(null),
        user ? getMyGroups(getDb(), user.id) : Promise.resolve(null),
      ]);
    const marks = await listWeekMarks(
      pool,
      classRows.flatMap((s) => (s.classId === null ? [] : [s.classId])),
    );
    // Badges first (Test, Entry quiz, exam dedup) against all the week's
    // events, then the plan filter on the rest; My groups filtering runs on
    // the annotated sessions in WeekView, so badges travel with them.
    const rows = annotatePlanWeek(classRows, events, marks, filter);
    const validGroups = options
      ? Object.fromEntries(
          options.map((o) => [String(o.classId), o.groups.map((g) => g.id)]),
        )
      : undefined;
    // Stale entries (group no longer in its class) are ignored.
    const myGroups =
      validGroups && stored ? sanitizeMyGroups(stored, validGroups) : undefined;
    return (
      <>
        {stored && (
          <MyGroupsImport hasStored={Object.keys(stored).length > 0} />
        )}
        <WeekView
          week={week}
          days={weekDays(rows, week).map((d) => d.toISOString())}
          sessions={rows.map((s) => toWeekSession(s, links, simple))}
          nav={weekNav(path, week, isoWeekOf(now), extra)}
          today={wallDateKey(now)}
          myGroupsFilter={myGroupsFilter}
          myGroups={myGroups}
          simple={simple}
          newEventHref={newEventHref(
            week,
            now,
            isoWeekOf(now),
            simple,
            filter.subjectId,
          )}
        />
      </>
    );
  } catch (err) {
    return (
      <div role="alert" className={errBox}>
        Could not load the timetable: {roErrorMessage(err)}
      </div>
    );
  }
}
