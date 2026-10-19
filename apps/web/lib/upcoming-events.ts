import { type DbExecutor, getMyGroups, listUpcomingEvents } from '@studies/db';
import type mysql from 'mysql2/promise';
import {
  filterMyGroups,
  type MyGroups,
  type PlanSession,
  sanitizeMyGroups,
} from './plan';
import { listMyGroupOptions } from './plan-queries';

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
): Promise<PlanSession[]> {
  const [events, stored, options] = await Promise.all([
    listUpcomingEvents(pool, nowWall, SCAN),
    getMyGroups(db, userId),
    listMyGroupOptions(pool),
  ]);
  const valid = Object.fromEntries(
    options.map((o) => [String(o.classId), o.groups.map((g) => g.id)]),
  );
  return pickUpcoming(events, sanitizeMyGroups(stored, valid), limit);
}
