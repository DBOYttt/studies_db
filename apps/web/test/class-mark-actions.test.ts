import {
  adminAudit,
  CONFLICT,
  classMarkSkips,
  classMarks,
  classSessions,
  consumeLoginToken,
  createLoginToken,
  type Db,
  ensureClass,
  ensureGroup,
  MARK_ALREADY_ON,
  MARK_NOT_FOUND,
  subjects,
  upsertUser,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
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
const revalidated: string[] = [];
vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => {
    revalidated.push(p);
  },
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));

const A = await import('../lib/class-mark-actions');

async function login(discordUserId: string) {
  const id = await upsertUser(db, {
    discordUserId,
    displayName: discordUserId,
    avatarUrl: null,
  });
  const r = await consumeLoginToken(db, await createLoginToken(db, id));
  return { id, sid: (r as { sessionToken: string }).sessionToken };
}

let alice: { id: number; sid: string };
let admin: { id: number; sid: string };
let banned: { id: number; sid: string };
let labId: number;
let gr1: number;

const marks = () => db.select().from(classMarks);
const skips = () => db.select().from(classMarkSkips);

beforeAll(async () => {
  db = await resetTestDb();
  const [{ id: subjectId }] = await db
    .insert(subjects)
    .values({ name: 'Alfa', code: 'ALF', semester: 1, ects: 1 })
    .$returningId();
  labId = await ensureClass(db, subjectId, 'laboratorium');
  gr1 = await ensureGroup(db, labId, 1);
  const start = new Date(Date.UTC(2026, 9, 13, 10, 0));
  await db.insert(classSessions).values({
    uid: 'u1',
    occurrenceStart: start,
    subjectId,
    classId: labId,
    groupId: gr1,
    label: 'Laboratorium',
    startsAt: start,
    endsAt: new Date(Date.UTC(2026, 9, 13, 11, 30)),
  });
  alice = await login('alice');
  admin = await login('admin');
  banned = await login('banned');
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
  await db.update(users).set({ isBanned: true }).where(eq(users.id, banned.id));
});
afterAll(() => closeTestDb(db));

describe('class mark actions', () => {
  it('every action refuses a missing session', async () => {
    cookieSid = undefined;
    await expect(A.addMarkAction(labId, null, null)).rejects.toThrow(
      'redirect',
    );
    await expect(A.editMarkAction(1, 'x', 0)).rejects.toThrow('redirect');
    await expect(A.removeMarkAction(1)).rejects.toThrow('redirect');
    await expect(A.skipMarkAction(1, '2026-10-13')).rejects.toThrow('redirect');
    await expect(A.unskipMarkAction(1, '2026-10-13')).rejects.toThrow(
      'redirect',
    );
    await expect(A.restoreMarkAction(1)).rejects.toThrow('notFound');
    expect(await marks()).toHaveLength(0);
  });

  it('a banned user changes nothing', async () => {
    cookieSid = banned.sid;
    const r = await A.addMarkAction(labId, null, null).catch((e) => String(e));
    expect(JSON.stringify(r)).not.toContain('"ok":true');
    expect(await marks()).toHaveLength(0);
  });

  it('refuses malformed arguments', async () => {
    cookieSid = alice.sid;
    expect(await A.addMarkAction(-1, null, null)).toEqual({
      ok: false,
      message: 'Class not found.',
    });
    expect(await A.skipMarkAction(0, '2026-10-13')).toEqual({
      ok: false,
      message: MARK_NOT_FOUND,
    });
    expect(await A.editMarkAction(1, 42 as unknown as string, 0)).toMatchObject(
      { ok: false },
    );
    expect(await marks()).toHaveLength(0);
  });

  it('turns on, edits, skips, unskips, turns off; restore is admin only', async () => {
    cookieSid = alice.sid;
    revalidated.length = 0;
    const on = await A.addMarkAction(labId, gr1, ' Rozdział 3 ');
    expect(on).toMatchObject({ ok: true, message: 'Entry quiz turned on.' });
    expect(revalidated).toEqual(
      expect.arrayContaining(['/plan', '/s/plan', '/subjects/[code]']),
    );
    const [m] = await marks();
    expect(m).toMatchObject({
      classId: labId,
      groupId: gr1,
      note: 'Rozdział 3',
    });
    expect(await A.addMarkAction(labId, gr1, null)).toEqual({
      ok: false,
      message: MARK_ALREADY_ON,
    });

    expect(await A.editMarkAction(m.id, 'Nowa', 7)).toEqual({
      ok: false,
      message: CONFLICT,
    });
    expect(await A.editMarkAction(m.id, 'Nowa', 0)).toMatchObject({
      ok: true,
      version: 1,
    });

    expect(await A.skipMarkAction(m.id, '2026-10-13')).toMatchObject({
      ok: true,
    });
    expect((await skips()).map((s) => String(s.onDate))).toHaveLength(1);
    expect((await A.skipMarkAction(m.id, '2026-10-14')).ok).toBe(false);
    expect((await A.unskipMarkAction(m.id, '2026-10-13')).ok).toBe(true);
    expect(await skips()).toHaveLength(0);

    expect((await A.removeMarkAction(m.id, 0)).ok).toBe(false);
    expect((await A.removeMarkAction(m.id, 1)).ok).toBe(true);
    expect((await marks())[0].deletedAt).not.toBeNull();

    await expect(A.restoreMarkAction(m.id)).rejects.toThrow('notFound');
    cookieSid = admin.sid;
    expect(await A.restoreMarkAction(m.id)).toMatchObject({ ok: true });
    expect((await marks())[0].deletedAt).toBeNull();

    const actions = (await db.select().from(adminAudit)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'class_mark.add',
        'class_mark.edit',
        'class_mark.skip',
        'class_mark.unskip',
        'class_mark.remove',
        'class_mark.restore',
      ]),
    );
  });
});
