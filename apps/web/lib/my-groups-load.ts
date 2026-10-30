/**
 * A user's My groups with stale picks dropped (a class or group that no
 * longer exists). The start page loads it once and hands the promise to the
 * Today and Upcoming cards, so each request reads it only once.
 */
import { type DbExecutor, getMyGroups } from '@studies/db';
import type mysql from 'mysql2/promise';
import { type MyGroups, sanitizeMyGroups } from './plan';
import { listMyGroupOptions } from './plan-queries';

export async function loadMyGroups(
  db: DbExecutor,
  pool: mysql.Pool,
  userId: number,
): Promise<MyGroups> {
  const [stored, options] = await Promise.all([
    getMyGroups(db, userId),
    listMyGroupOptions(pool),
  ]);
  const valid = Object.fromEntries(
    options.map((o) => [String(o.classId), o.groups.map((g) => g.id)]),
  );
  return sanitizeMyGroups(stored, valid);
}
