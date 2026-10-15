import { getSetting, setSetting, users } from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memberRoleIds, syncAdminFlag } from '../src/admin-flag.js';

let db: Awaited<ReturnType<typeof resetTestDb>>;
beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

const u = { discordUserId: 'u1', displayName: 'U', avatarUrl: null };
const flag = async () =>
  (await db.select().from(users).where(eq(users.discordUserId, 'u1')))[0]
    ?.isAdmin;

describe('syncAdminFlag', () => {
  it('sets the flag when the stored role is held', async () => {
    await setSetting(db, 'admin_role_id', 'r');
    expect(await syncAdminFlag(db, u, ['x', 'r'])).toMatchObject({
      isAdmin: true,
      roleId: 'r',
    });
    expect(await flag()).toBe(true);
  });
  it('clears a previously true flag when the role is missing', async () => {
    await setSetting(db, 'admin_role_id', 'r');
    await syncAdminFlag(db, u, ['r']);
    expect((await syncAdminFlag(db, u, ['x'])).isAdmin).toBe(false);
    expect(await flag()).toBe(false);
  });
  it('is false when no role id is stored', async () => {
    expect(await syncAdminFlag(db, u, ['r'])).toMatchObject({
      isAdmin: false,
      roleId: null,
    });
    expect(await flag()).toBe(false);
  });
  it('upserts the user and the flag in one statement', async () => {
    await setSetting(db, 'admin_role_id', 'r');
    await syncAdminFlag(db, u, ['r']);
    const insert = vi.spyOn(db, 'insert');
    const update = vi.spyOn(db, 'update');
    const res = await syncAdminFlag(
      db,
      { ...u, displayName: 'Nowe', avatarUrl: 'av' },
      ['r'],
    );
    expect(res.isAdmin).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'u1'));
    expect(row).toMatchObject({
      displayName: 'Nowe',
      avatarUrl: 'av',
      isAdmin: true,
    });
    expect(await getSetting(db, 'admin_role_id')).toBe('r');
  });
});

describe('syncAdminFlag userId', () => {
  const idOf = async (d: string) =>
    (await db.select().from(users).where(eq(users.discordUserId, d)))[0]?.id;
  it('returns users.id on both the insert and the update path', async () => {
    await db.insert(users).values({ discordUserId: 'pad', displayName: 'P' });
    const first = await syncAdminFlag(db, u, []);
    expect(first.userId).toBe(await idOf('u1'));
    const again = await syncAdminFlag(db, { ...u, displayName: 'Z' }, []);
    expect(again.userId).toBe(first.userId);
    const same = await syncAdminFlag(db, { ...u, displayName: 'Z' }, []);
    expect(same.userId).toBe(first.userId);
    const other = await syncAdminFlag(db, { ...u, discordUserId: 'u2' }, []);
    expect(other.userId).toBe(await idOf('u2'));
    expect(other.userId).not.toBe(first.userId);
  });
});

describe('memberRoleIds', () => {
  it('handles arrays, role caches and a missing member', () => {
    const a = (o: unknown) => o as never;
    expect(memberRoleIds(a({ member: { roles: ['a', 'b'] } }))).toEqual([
      'a',
      'b',
    ]);
    expect(
      memberRoleIds(a({ member: { roles: { cache: new Map([['r', {}]]) } } })),
    ).toEqual(['r']);
    expect(memberRoleIds(a({ member: null }))).toEqual([]);
  });
});
