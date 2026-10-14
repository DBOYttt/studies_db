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
    expect(await syncAdminFlag(db, u, ['x', 'r'])).toEqual({
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
    expect(await syncAdminFlag(db, u, ['r'])).toEqual({
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
