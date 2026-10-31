import {
  adminAudit,
  consumeLoginToken,
  createLoginToken,
  type Db,
  getPlanSyncStatus,
  listFeeds,
  maskFeedUrl,
  planSync,
  setFeed,
  upsertUser,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/count-cache', () => ({ invalidateCounts: () => {} }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));

const F = await import('../lib/admin-feeds');
const { loadFeedRows } = await import('../lib/admin-sync');

async function login(discordUserId: string) {
  const id = await upsertUser(db, {
    discordUserId,
    displayName: discordUserId,
    avatarUrl: null,
  });
  const r = await consumeLoginToken(db, await createLoginToken(db, id));
  return { id, sid: (r as { sessionToken: string }).sessionToken };
}
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

const CLASS = 'https://plan.agh.edu.pl/UniTime/export?secret=classtoken1';
const EXAM = 'https://plan.agh.edu.pl/UniTime/export?secret=examtoken2';
let admin: { id: number; sid: string };
let student: { id: number; sid: string };

beforeAll(async () => {
  db = await resetTestDb();
  admin = await login('admin-1');
  student = await login('student-1');
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
});
afterAll(() => closeTestDb(db));
beforeEach(() => {
  cookieSid = admin.sid;
});

describe('admin feeds actions', () => {
  it('a non-admin gets notFound', async () => {
    cookieSid = student.sid;
    await expect(
      F.saveFeedAction(null as never, fd({ semester: '3', class_url: CLASS })),
    ).rejects.toThrow('notFound');
    await expect(
      F.clearFeedAction(null as never, fd({ semester: '3' })),
    ).rejects.toThrow('notFound');
  });

  it('refuses semester 8', async () => {
    const r = await F.saveFeedAction(
      null as never,
      fd({ semester: '8', class_url: CLASS }),
    );
    expect(r?.ok).toBe(false);
    expect(await listFeeds(db)).toHaveLength(0);
  });

  it('a bad link names the field and never echoes the link', async () => {
    const bad = 'https://evil.example/x?secret=zzz';
    const r = await F.saveFeedAction(
      null as never,
      fd({ semester: '3', class_url: bad }),
    );
    expect(r).toMatchObject({ ok: false, field: 'class_url' });
    expect(JSON.stringify(r)).not.toContain('evil.example');
    expect(JSON.stringify(r)).not.toContain('zzz');
  });

  it('a missing class link on a new semester is refused', async () => {
    const r = await F.saveFeedAction(null as never, fd({ semester: '3' }));
    expect(r).toMatchObject({ ok: false, field: 'class_url' });
  });

  it('saves, audits hosts only, and requests a sync', async () => {
    const r = await F.saveFeedAction(
      null as never,
      fd({ semester: '3', class_url: ` ${CLASS} `, exam_url: EXAM }),
    );
    expect(r?.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain('http');
    const rows = await db.select().from(adminAudit);
    const row = rows[rows.length - 1];
    expect(row).toMatchObject({
      action: 'plan.feed_set',
      target: 'semester:3',
    });
    expect(row.details).toEqual({
      classHost: 'plan.agh.edu.pl',
      examHost: 'plan.agh.edu.pl',
      source: 'web',
    });
    expect(JSON.stringify(row)).not.toContain('http');
    expect((await getPlanSyncStatus(db)).requestedAt).not.toBeNull();
    expect((await listFeeds(db))[0]?.classUrl).toBe(CLASS);
  });

  it('empty fields keep, remove_exam clears the exam link', async () => {
    const keep = await F.saveFeedAction(
      null as never,
      fd({ semester: '3', class_url: '', exam_url: '' }),
    );
    expect(keep?.ok).toBe(true);
    expect((await listFeeds(db))[0]?.examUrl).toBe(EXAM);
    await F.saveFeedAction(
      null as never,
      fd({ semester: '3', class_url: '', exam_url: '', remove_exam: 'on' }),
    );
    expect((await listFeeds(db))[0]?.examUrl).toBeNull();
  });

  it('remove_exam wins over a typed exam_url', async () => {
    await F.saveFeedAction(
      null as never,
      fd({ semester: '3', class_url: CLASS, exam_url: EXAM }),
    );
    const r = await F.saveFeedAction(
      null as never,
      fd({ semester: '3', exam_url: EXAM, remove_exam: 'on' }),
    );
    expect(r?.ok).toBe(true);
    expect((await listFeeds(db))[0]?.examUrl).toBeNull();
  });

  it('a duplicated semester field uses the first value', async () => {
    const f = new FormData();
    f.append('semester', '4');
    f.append('semester', '5');
    f.set('class_url', CLASS);
    const r = await F.saveFeedAction(null as never, f);
    expect(r?.ok).toBe(true);
    const sems = (await listFeeds(db)).map((x) => x.semester);
    expect(sems).toContain(4);
    expect(sems).not.toContain(5);
    await F.clearFeedAction(null as never, fd({ semester: '4' }));
  });

  it('a failed sync request after the save is still ok', async () => {
    // The audit insert is the first db.insert; fail the plan_sync one.
    const real = db.insert.bind(db);
    let n = 0;
    const s2 = vi.spyOn(db, 'insert').mockImplementation(((t: never) => {
      n++;
      if (n >= 2) throw new Error('down');
      return real(t);
    }) as never);
    const r = await F.saveFeedAction(
      null as never,
      fd({ semester: '6', class_url: CLASS }),
    );
    s2.mockRestore();
    expect(r).toEqual({
      ok: true,
      message: 'Feed saved. The sync request failed; use Sync timetable.',
    });
    await F.clearFeedAction(null as never, fd({ semester: '6' }));
  });

  it('clearFeedAction deletes and audits', async () => {
    const r = await F.clearFeedAction(null as never, fd({ semester: '3' }));
    expect(r?.ok).toBe(true);
    expect(await listFeeds(db)).toHaveLength(0);
    const rows = await db.select().from(adminAudit);
    expect(rows[rows.length - 1]).toMatchObject({
      action: 'plan.feed_clear',
      target: 'semester:3',
    });
  });
});

describe('admin feeds actions: clear requests a sync, save errors stay secret', () => {
  it('clearFeedAction requests a timetable sync', async () => {
    await F.saveFeedAction(
      null as never,
      fd({ semester: '3', class_url: CLASS }),
    );
    await db.update(planSync).set({ requestedAt: null });
    const r = await F.clearFeedAction(null as never, fd({ semester: '3' }));
    expect(r).toEqual({
      ok: true,
      message: 'Semester 3 feed cleared. A timetable sync is requested.',
    });
    expect((await getPlanSyncStatus(db)).requestedAt).not.toBeNull();
  });

  it('a failed sync request after the clear is still ok', async () => {
    await F.saveFeedAction(
      null as never,
      fd({ semester: '3', class_url: CLASS }),
    );
    // The audit insert is the first db.insert; fail the plan_sync one.
    const real = db.insert.bind(db);
    let n = 0;
    const spy = vi.spyOn(db, 'insert').mockImplementation(((t: never) => {
      n++;
      if (n >= 2) throw new Error('down');
      return real(t);
    }) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await F.clearFeedAction(null as never, fd({ semester: '3' }));
    spy.mockRestore();
    err.mockRestore();
    expect(r).toEqual({
      ok: true,
      message: 'Feed cleared. The sync request failed; use Sync timetable.',
    });
    expect(await listFeeds(db)).toHaveLength(0);
  });

  it('a DB error while saving never logs or returns the link', async () => {
    const leak = new Error(`Failed query: insert ... params: 3,${CLASS}`);
    (leak as Error & { cause?: unknown }).cause = {
      code: 'ER_LOCK_WAIT_TIMEOUT',
    };
    const spy = vi.spyOn(db, 'transaction').mockRejectedValue(leak as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let r: Awaited<ReturnType<typeof F.saveFeedAction>>;
    try {
      r = await F.saveFeedAction(
        null as never,
        fd({ semester: '3', class_url: CLASS }),
      );
    } finally {
      spy.mockRestore();
    }
    const logged = JSON.stringify(err.mock.calls);
    err.mockRestore();
    expect(r).toEqual({
      ok: false,
      message: 'Could not save the feed. Try again.',
    });
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('plan.agh.edu.pl');
    expect(logged).toContain('ER_LOCK_WAIT_TIMEOUT');
  });
});

describe('loadFeedRows', () => {
  it('returns 7 rows with masked values only', async () => {
    await setFeed(db, {
      semester: 2,
      classUrl: CLASS,
      examUrl: EXAM,
      userId: admin.id,
    });
    const rows = await loadFeedRows(db);
    expect(rows.map((r) => r.semester)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rows[1]?.classMasked).toBe(maskFeedUrl(CLASS));
    expect(rows[1]?.classMasked).toMatch(/^plan\.agh\.edu\.pl\/…#[0-9a-f]{6}$/);
    expect(rows[1]?.examMasked).toMatch(/^plan\.agh\.edu\.pl\/…#[0-9a-f]{6}$/);
    expect(rows[0]).toMatchObject({
      classMasked: null,
      examMasked: null,
      updatedAt: null,
    });
    expect(JSON.stringify(rows)).not.toContain('secret');
  });
});
