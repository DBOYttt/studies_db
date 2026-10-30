import {
  clearMyGroups,
  consumeLoginToken,
  createLoginToken,
  type Db,
  disableReminders,
  ensureClass,
  ensureGroup,
  getMyGroups,
  getReminderPrefs,
  setMyGroup,
  subjects,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
// React `cache` memoises per request; outside a request, call through.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));

const {
  saveMyGroupAction,
  saveMyGroupsAction,
  clearMyGroupsAction,
  importMyGroupsAction,
  saveRemindersAction,
} = await import('../lib/my-groups-actions');

let aliceId: number;
let aliceSid: string;
let bobId: number;
let classA: number;
let grA1: number;
let grA2: number;
let classB: number;
let grB1: number;

async function login(discordUserId: string) {
  const id = await upsertUser(db, {
    discordUserId,
    displayName: discordUserId,
    avatarUrl: null,
  });
  const r = await consumeLoginToken(db, await createLoginToken(db, id));
  return { id, sid: (r as { sessionToken: string }).sessionToken };
}

beforeAll(async () => {
  db = await resetTestDb();
  const [{ id: s1 }, { id: s2 }] = await Promise.all([
    db
      .insert(subjects)
      .values({ name: 'Alfa', code: 'ALF', semester: 1, ects: 1 })
      .$returningId()
      .then((r) => r[0]),
    db
      .insert(subjects)
      .values({ name: 'Beta', code: 'BET', semester: 1, ects: 1 })
      .$returningId()
      .then((r) => r[0]),
  ]);
  classA = await ensureClass(db, s1, 'cwiczenia');
  grA1 = await ensureGroup(db, classA, 1);
  grA2 = await ensureGroup(db, classA, 2);
  classB = await ensureClass(db, s2, 'laboratorium');
  grB1 = await ensureGroup(db, classB, 1);
  const alice = await login('alice');
  aliceId = alice.id;
  aliceSid = alice.sid;
  bobId = (await login('bob')).id;
});
afterAll(() => closeTestDb(db));

describe('my-groups actions', () => {
  it('every action requires a session', async () => {
    cookieSid = undefined;
    await expect(saveMyGroupAction(classA, grA1)).rejects.toThrow('redirect');
    await expect(saveMyGroupsAction({})).rejects.toThrow('redirect');
    await expect(clearMyGroupsAction()).rejects.toThrow('redirect');
    await expect(importMyGroupsAction({})).rejects.toThrow('redirect');
    await expect(saveRemindersAction(true, true)).rejects.toThrow('redirect');
    expect((await getReminderPrefs(db, aliceId)).dayBefore).toBe(false);
    expect(await getMyGroups(db, aliceId)).toEqual({});
  });

  it('saves and clears one choice for the session user only', async () => {
    cookieSid = aliceSid;
    expect(await saveMyGroupAction(classA, grA1)).toEqual({ ok: true });
    expect(await saveMyGroupAction(classA, grA2)).toEqual({ ok: true });
    expect(await getMyGroups(db, aliceId)).toEqual({ [classA]: grA2 });
    expect(await getMyGroups(db, bobId)).toEqual({});
    expect(await saveMyGroupAction(classA, null)).toEqual({ ok: true });
    expect(await getMyGroups(db, aliceId)).toEqual({});
  });

  it('rejects bad ids and groups outside the class', async () => {
    cookieSid = aliceSid;
    const bad: [unknown, unknown][] = [
      [1.5, grA1],
      [classA, 2.5],
      [Number.NaN, grA1],
      [-1, grA1],
      [classA, 0],
      ['1', grA1],
      [classA, undefined],
      [classA, grB1], // group of another class
    ];
    for (const [c, g] of bad)
      expect(await saveMyGroupAction(c as number, g as number)).toEqual({
        ok: false,
      });
    expect(await getMyGroups(db, aliceId)).toEqual({});
  });

  it('clears all choices of the session user only', async () => {
    await setMyGroup(db, bobId, classA, grA2);
    cookieSid = aliceSid;
    await saveMyGroupAction(classA, grA1);
    await saveMyGroupAction(classB, grB1);
    await clearMyGroupsAction();
    expect(await getMyGroups(db, aliceId)).toEqual({});
    expect(await getMyGroups(db, bobId)).toEqual({ [classA]: grA2 });
    await clearMyGroups(db, bobId);
  });

  it('Save writes the whole shown choice (last Save wins)', async () => {
    cookieSid = aliceSid;
    // Another tab picked these meanwhile.
    await saveMyGroupAction(classA, grA1);
    await saveMyGroupAction(classB, grB1);
    expect(
      await saveMyGroupsAction({ [classA]: grA2, [classB]: null }),
    ).toEqual({ ok: true });
    expect(await getMyGroups(db, aliceId)).toEqual({ [classA]: grA2 });
    expect(await getMyGroups(db, bobId)).toEqual({});
    await clearMyGroups(db, aliceId);
  });

  it('Save refuses malformed choices and writes nothing', async () => {
    cookieSid = aliceSid;
    await saveMyGroupAction(classA, grA1);
    const bad: unknown[] = [
      null,
      [],
      'x',
      { [classA]: 2.5 },
      { [classA]: '3' },
      { '01': grA1 },
      { x: grA1 },
      { [classA]: grB1 }, // group of another class
      Object.fromEntries(
        Array.from({ length: 501 }, (_, i) => [String(1_000_001 + i), null]),
      ),
    ];
    for (const b of bad)
      expect(
        await saveMyGroupsAction(b as Record<string, number | null>),
        JSON.stringify(b)?.slice(0, 40),
      ).toEqual({ ok: false });
    expect(await getMyGroups(db, aliceId)).toEqual({ [classA]: grA1 });
    await clearMyGroups(db, aliceId);
  });

  it('import keeps only canonical numeric keys', async () => {
    cookieSid = aliceSid;
    const keys = { [classA]: grA1, '01': grB1, '1e3': grB1, ' 5': grB1 };
    expect(await importMyGroupsAction(keys)).toBe(true);
    expect(await getMyGroups(db, aliceId)).toEqual({ [classA]: grA1 });
    await clearMyGroups(db, aliceId);
  });

  it('import only looks at the first 50 entries', async () => {
    cookieSid = aliceSid;
    // Own-key order of a plain object is numeric for integer keys, so a
    // Proxy fixes the order: 50 junk entries, then the one valid pair.
    const keys = Array.from({ length: 50 }, (_, i) => String(1_000_001 + i));
    keys.push(String(classA));
    const value = (k: string | symbol) => (k === String(classA) ? grA1 : 1);
    const groups = (n: number) =>
      new Proxy({} as Record<string, number>, {
        ownKeys: () => keys.slice(-n),
        get: (_t, k) => value(k),
        getOwnPropertyDescriptor: (_t, k) => ({
          value: value(k),
          enumerable: true,
          configurable: true,
        }),
      });
    expect(await importMyGroupsAction(groups(51))).toBe(false);
    expect(await getMyGroups(db, aliceId)).toEqual({});
    // Control: with the valid pair inside the first 50 it is imported.
    expect(await importMyGroupsAction(groups(50))).toBe(true);
    expect(await getMyGroups(db, aliceId)).toEqual({ [classA]: grA1 });
    await clearMyGroups(db, aliceId);
  });

  it('imports once, skipping invalid pairs and garbage', async () => {
    cookieSid = aliceSid;
    const junk = {
      [classA]: grA2,
      [classB]: grA1, // wrong class
      x: 3,
      '-4': 1,
      [`${classB}`]: 'nope',
    } as unknown as Record<string, number>;
    expect(await importMyGroupsAction(junk)).toBe(true);
    expect(await getMyGroups(db, aliceId)).toEqual({ [classA]: grA2 });
    // a second import never overwrites existing choices
    expect(await importMyGroupsAction({ [classA]: grA1 })).toBe(false);
    expect(await getMyGroups(db, aliceId)).toEqual({ [classA]: grA2 });
    expect(await importMyGroupsAction(null as never)).toBe(false);
  });
});

describe('reminders action', () => {
  it('saves the toggles for the session user and clears the DM-closed reason', async () => {
    cookieSid = aliceSid;
    await disableReminders(db, aliceId, 'DMs closed');
    expect(await saveRemindersAction(true, false)).toEqual({ ok: true });
    expect(await getReminderPrefs(db, aliceId)).toEqual({
      dayBefore: true,
      hourBefore: false,
      disabledReason: null,
    });
    expect((await getReminderPrefs(db, bobId)).dayBefore).toBe(false);
  });

  it('rejects non-boolean arguments', async () => {
    cookieSid = aliceSid;
    expect(
      await saveRemindersAction('yes' as never, undefined as never),
    ).toEqual({ ok: false });
    expect((await getReminderPrefs(db, aliceId)).dayBefore).toBe(true);
  });
});
