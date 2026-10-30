import { type DbExecutor, listUpcomingEvents } from '@studies/db';
import type mysql from 'mysql2/promise';
import { loadMyGroups } from './my-groups-load';
import { filterMyGroups, type MyGroups, type PlanSession } from './plan';

/** The first `limit` events matching My groups (pure; input in time order). */
export const pickUpcoming = (
  events: PlanSession[],
  mine: MyGroups,
  limit: number,
): PlanSession[] => filterMyGroups(events, mine).slice(0, limit);

/** How many upcoming events are scanned before Moje grupy drops some. */
const SCAN = 100;

/** "Upcoming events" of the start page: next 5 matching My groups. */
export async function upcomingForUser(
  db: DbExecutor,
  pool: mysql.Pool,
  userId: number,
  nowWall: Date,
  limit = 5,
  /** My groups already being loaded for this request (`loadMyGroups`). */
  mine?: Promise<MyGroups>,
): Promise<PlanSession[]> {
  const [events, groups] = await Promise.all([
    listUpcomingEvents(pool, nowWall, SCAN),
    mine ?? loadMyGroups(db, pool, userId),
  ]);
  return pickUpcoming(events, groups, limit);
}
