import { and, eq } from 'drizzle-orm';
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

/** Writes only when the user has no rows yet; invalid pairs are skipped. */
export async function importMyGroups(
  db: Db,
  userId: number,
  groups: MyGroups,
): Promise<boolean> {
  const existing = await db
    .select({ classId: userGroups.classId })
    .from(userGroups)
    .where(eq(userGroups.userId, userId))
    .limit(1);
  if (existing.length > 0) return false;
  let imported = false;
  for (const [cid, gid] of Object.entries(groups)) {
    const classId = Number(cid);
    if (!Number.isInteger(classId) || !Number.isInteger(gid)) continue;
    if (!(await groupBelongsToClass(db, classId, gid))) continue;
    await db
      .insert(userGroups)
      .values({ userId, classId, groupId: gid })
      .onDuplicateKeyUpdate({ set: { groupId: gid } });
    imported = true;
  }
  return imported;
}
