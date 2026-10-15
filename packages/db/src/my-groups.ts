import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { classGroups, userGroups } from './schema.js';

/** Class id (as string) -> the user's group id in that class. */
export type MyGroups = Record<string, number>;

export async function getMyGroups(db: Db, userId: number): Promise<MyGroups> {
  const rows = await db
    .select({ classId: userGroups.classId, groupId: userGroups.groupId })
    .from(userGroups)
    .where(eq(userGroups.userId, userId));
  return Object.fromEntries(rows.map((r) => [String(r.classId), r.groupId]));
}

async function groupBelongsToClass(
  db: Db,
  classId: number,
  groupId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: classGroups.id })
    .from(classGroups)
    .where(and(eq(classGroups.id, groupId), eq(classGroups.classId, classId)))
    .limit(1);
  return !!row;
}

export async function setMyGroup(
  db: Db,
  userId: number,
  classId: number,
  groupId: number | null,
): Promise<{ ok: boolean }> {
  if (groupId === null) {
    await db
      .delete(userGroups)
      .where(
        and(eq(userGroups.userId, userId), eq(userGroups.classId, classId)),
      );
    return { ok: true };
  }
  if (!(await groupBelongsToClass(db, classId, groupId))) return { ok: false };
  await db
    .insert(userGroups)
    .values({ userId, classId, groupId })
    .onDuplicateKeyUpdate({ set: { groupId } });
  return { ok: true };
}

export async function clearMyGroups(db: Db, userId: number): Promise<void> {
  await db.delete(userGroups).where(eq(userGroups.userId, userId));
}

/**
 * Writes only when the user has no rows yet; invalid pairs are skipped. All
 * pairs are checked with one query and written in one transaction. True when
 * at least one pair was imported.
 */
export async function importMyGroups(
  db: Db,
  userId: number,
  groups: MyGroups,
): Promise<boolean> {
  const pairs = Object.entries(groups)
    .map(([cid, gid]) => ({ classId: Number(cid), groupId: gid }))
    .filter((p) => Number.isInteger(p.classId) && Number.isInteger(p.groupId));
  if (pairs.length === 0) return false;
  const found = await db
    .select({ id: classGroups.id, classId: classGroups.classId })
    .from(classGroups)
    .where(
      inArray(
        classGroups.id,
        pairs.map((p) => p.groupId),
      ),
    );
  const classOf = new Map(found.map((g) => [g.id, g.classId]));
  const valid = pairs.filter((p) => classOf.get(p.groupId) === p.classId);
  if (valid.length === 0) return false;
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ classId: userGroups.classId })
      .from(userGroups)
      .where(eq(userGroups.userId, userId))
      .limit(1);
    if (existing.length > 0) return false;
    await tx
      .insert(userGroups)
      .values(valid.map((p) => ({ userId, ...p })))
      // A concurrent import got there first: keep its rows.
      .onDuplicateKeyUpdate({ set: { groupId: sql`${userGroups.groupId}` } });
    return true;
  });
}
