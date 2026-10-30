import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import {
  clearMyGroups,
  getMyGroups,
  importMyGroups,
  saveMyGroups,
  setMyGroup,
} from '../src/my-groups.js';
import {
  classes,
  classGroups,
  subjects,
  userGroups,
  users,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;
let userId: number;
let c1: number;
let c2: number;
let g1: number;
let g2: number;
let h1: number;

beforeAll(async () => {
  db = await resetTestDb();
  const [s] = await db
    .insert(subjects)
    .values({
      name: 'X',
      code: 'MG',
      semester: 1,
      ects: 1,
      discordChannelId: 'mg-c',
    })
    .$returningId();
  [{ id: c1 }] = await db
    .insert(classes)
    .values({ subjectId: s.id, kind: 'laboratorium', name: 'Laboratorium' })
    .$returningId();
  [{ id: c2 }] = await db
    .insert(classes)
    .values({ subjectId: s.id, kind: 'cwiczenia', name: 'Ćwiczenia' })
    .$returningId();
  [{ id: g1 }, { id: g2 }] = await db
    .insert(classGroups)
    .values([
      { classId: c1, number: 1, name: 'Gr. 1' },
      { classId: c1, number: 2, name: 'Gr. 2' },
    ])
    .$returningId();
  [{ id: h1 }] = await db
    .insert(classGroups)
    .values({ classId: c2, number: 1, name: 'Gr. 1' })
    .$returningId();
  [{ id: userId }] = await db
    .insert(users)
    .values({ discordUserId: 'mg-u', displayName: 'U' })
    .$returningId();
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('my groups', () => {
  it('set, replace, remove', async () => {
    expect(await setMyGroup(db, userId, c1, g1)).toEqual({ ok: true });
    expect(await getMyGroups(db, userId)).toEqual({ [c1]: g1 });
    expect(await setMyGroup(db, userId, c1, g2)).toEqual({ ok: true });
    expect(await getMyGroups(db, userId)).toEqual({ [c1]: g2 });
    expect(await setMyGroup(db, userId, c1, null)).toEqual({ ok: true });
    expect(await getMyGroups(db, userId)).toEqual({});
  });
  it('rejects a group of another class', async () => {
    expect(await setMyGroup(db, userId, c1, h1)).toEqual({ ok: false });
    expect(await getMyGroups(db, userId)).toEqual({});
  });
  it('clear', async () => {
    await setMyGroup(db, userId, c1, g1);
    await setMyGroup(db, userId, c2, h1);
    await clearMyGroups(db, userId);
    expect(await getMyGroups(db, userId)).toEqual({});
  });
  it('import of nothing or only invalid pairs writes nothing', async () => {
    expect(await importMyGroups(db, userId, {})).toBe(false);
    expect(
      await importMyGroups(db, userId, { [c1]: h1, [c2]: g2, '999999': 1 }),
    ).toBe(false);
    expect(await getMyGroups(db, userId)).toEqual({});
  });
  it('import writes every valid pair', async () => {
    expect(
      await importMyGroups(db, userId, { [c1]: g2, [c2]: h1, '999999': 1 }),
    ).toBe(true);
    expect(await getMyGroups(db, userId)).toEqual({ [c1]: g2, [c2]: h1 });
    await clearMyGroups(db, userId);
  });
  it('import only into empty, skipping invalid pairs', async () => {
    expect(
      await importMyGroups(db, userId, { [c1]: g1, [c2]: g1, '999999': 1 }),
    ).toBe(true);
    expect(await getMyGroups(db, userId)).toEqual({ [c1]: g1 });
    expect(await importMyGroups(db, userId, { [c1]: g2, [c2]: h1 })).toBe(
      false,
    );
    expect(await getMyGroups(db, userId)).toEqual({ [c1]: g1 });
  });
  it('save writes the whole shown choice: picks and drops', async () => {
    await clearMyGroups(db, userId);
    await setMyGroup(db, userId, c1, g1);
    await setMyGroup(db, userId, c2, h1);
    expect(await saveMyGroups(db, userId, { [c1]: g2, [c2]: null })).toEqual({
      ok: true,
    });
    expect(await getMyGroups(db, userId)).toEqual({ [c1]: g2 });
    // A class left out of the choice is not touched.
    await setMyGroup(db, userId, c2, h1);
    expect(await saveMyGroups(db, userId, { [c1]: null })).toEqual({
      ok: true,
    });
    expect(await getMyGroups(db, userId)).toEqual({ [c2]: h1 });
    expect(await saveMyGroups(db, userId, {})).toEqual({ ok: true });
    expect(await getMyGroups(db, userId)).toEqual({ [c2]: h1 });
  });
  it('save refuses the whole choice when one pair is invalid', async () => {
    await clearMyGroups(db, userId);
    await setMyGroup(db, userId, c1, g1);
    expect(await saveMyGroups(db, userId, { [c1]: g2, [c2]: g1 })).toEqual({
      ok: false,
    });
    expect(await saveMyGroups(db, userId, { [c1]: null, '999999': 1 })).toEqual(
      { ok: false },
    );
    expect(await getMyGroups(db, userId)).toEqual({ [c1]: g1 });
    await clearMyGroups(db, userId);
    await importMyGroups(db, userId, { [c1]: g1 });
  });
  it('cascades when the group is deleted', async () => {
    await db.delete(classGroups).where(eq(classGroups.id, g1));
    expect(await getMyGroups(db, userId)).toEqual({});
    expect(await db.select().from(userGroups)).toHaveLength(0);
  });
});
