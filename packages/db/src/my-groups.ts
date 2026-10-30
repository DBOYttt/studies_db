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

/**
 * Writes the classes a form changed (class id -> group id, null = "All
 * groups"), so the form's Save makes them stored even when another tab
 * changed them meanwhile (last Save of a class wins). Classes left out are
 * not touched. All or nothing: one group outside its class refuses it.
 */
export async function saveMyGroups(
  db: Db,
  userId: number,
  choice: Record<string, number | null>,
): Promise<{ ok: boolean }> {
  const entries = Object.entries(choice).map(([cid, gid]) => ({
    classId: Number(cid),
    groupId: gid,
  }));
  if (
    entries.some(
      (e) =>
        !Number.isSafeInteger(e.classId) ||
        (e.groupId !== null && !Number.isSafeInteger(e.groupId)),
    )
  ) {
    return { ok: false };
  }
  const picks = entries.filter(
    (e): e is { classId: number; groupId: number } => e.groupId !== null,
  );
  const drops = entries.filter((e) => e.groupId === null).map((e) => e.classId);
  // Checked inside the transaction under a shared lock, so a group deleted
  // meanwhile (the sync, an admin) refuses the save instead of an FK error.
  return db.transaction(async (tx) => {
    if (picks.length > 0) {
      // MariaDB has no FOR SHARE; LOCK IN SHARE MODE is its equivalent.
      const [found] = (await tx.execute(sql`
        SELECT id, class_id AS classId FROM class_groups
         WHERE ${inArray(
           classGroups.id,
           picks.map((p) => p.groupId),
         )}
         LOCK IN SHARE MODE`)) as unknown as [
        { id: number; classId: number }[],
      ];
      const classOf = new Map(found.map((g) => [g.id, g.classId]));
      if (picks.some((p) => classOf.get(p.groupId) !== p.classId)) {
        return { ok: false };
      }
    }
    if (drops.length > 0) {
      await tx
        .delete(userGroups)
        .where(
          and(
            eq(userGroups.userId, userId),
            inArray(userGroups.classId, drops),
          ),
        );
    }
    if (picks.length > 0) {
      await tx
        .insert(userGroups)
        .values(picks.map((p) => ({ userId, ...p })))
        .onDuplicateKeyUpdate({
          set: { groupId: sql`VALUES(${userGroups.groupId})` },
        });
    }
    return { ok: true };
  });
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
