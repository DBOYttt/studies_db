import {
  consumeLoginToken,
  createLoginToken,
  type Db,
  ensureClass,
  ensureGroup,
  getMyGroups,
  subjects,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
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

const { saveMyGroupAction, clearMyGroupsAction, importMyGroupsAction } =
  await import('../lib/my-groups-actions');

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
    await expect(clearMyGroupsAction()).rejects.toThrow('redirect');
    await expect(importMyGroupsAction({})).rejects.toThrow('redirect');
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

  it('clears all choices', async () => {
    cookieSid = aliceSid;
    await saveMyGroupAction(classA, grA1);
    await saveMyGroupAction(classB, grB1);
    await clearMyGroupsAction();
    expect(await getMyGroups(db, aliceId)).toEqual({});
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
