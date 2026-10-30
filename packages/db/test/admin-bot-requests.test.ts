import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_REQUEST_KINDS,
  BOT_BUSY_MESSAGE,
  cancelAdminBotRequest,
  claimNextBotRequest,
  enqueueAdminBotRequest,
  enqueueBotRequest,
  finishBotRequest,
  getAdminBotRequest,
  isCancelled,
  listAdminBotRequests,
  STUCK_AFTER_MS,
} from '../src/bot-requests.js';
import { createDb, type Db } from '../src/client.js';
import { botRequests, users } from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;
let alice: number;
let bob: number;

beforeAll(async () => {
  db = await resetTestDb();
  await db.insert(users).values([
    { discordUserId: 'abr-1', displayName: 'Alice', isAdmin: true },
    { discordUserId: 'abr-2', displayName: 'Bob', isAdmin: true },
  ]);
  const rows = await db.select().from(users);
  alice = rows.find((r) => r.displayName === 'Alice')?.id ?? 0;
  bob = rows.find((r) => r.displayName === 'Bob')?.id ?? 0;
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  await db.delete(botRequests);
});

/** Claims request `id` (the only queued one of its kind) so it can be finished. */
async function claim(id: number, kind: string) {
  const c = await claimNextBotRequest(db, [kind]);
  if (c?.id !== id) throw new Error(`claimed ${c?.id}, expected ${id}`);
}

async function adminRows() {
  const rows = await db.select().from(botRequests);
  return rows.filter((r) =>
    (ADMIN_REQUEST_KINDS as readonly string[]).includes(r.kind),
  );
}

describe('admin bot requests', () => {
  it('queues one request with target guild and the requester in the payload', async () => {
    const r = await enqueueAdminBotRequest(db, 'setup', alice);
    expect(r.ok).toBe(true);
    const rows = await adminRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'setup',
      target: 'guild',
      status: 'queued',
      payload: { requestedBy: alice },
    });
    if (r.ok) expect(r.id).toBe(rows[0].id);
  });

  it('refuses a second request while one is queued or running', async () => {
    expect((await enqueueAdminBotRequest(db, 'setup', alice)).ok).toBe(true);
    expect(await enqueueAdminBotRequest(db, 'resync', bob)).toEqual({
      ok: false,
      message: BOT_BUSY_MESSAGE,
    });
    const claimed = await claimNextBotRequest(db, [...ADMIN_REQUEST_KINDS]);
    expect(claimed?.status).toBe('running');
    expect(await enqueueAdminBotRequest(db, 'setup_dry_run', bob)).toEqual({
      ok: false,
      message: BOT_BUSY_MESSAGE,
    });
    if (!claimed) throw new Error('claim failed');
    await finishBotRequest(db, claimed.id, 'done');
    expect((await enqueueAdminBotRequest(db, 'resync', bob)).ok).toBe(true);
  });

  it('a queued event request does not block', async () => {
    await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    expect((await enqueueAdminBotRequest(db, 'setup', alice)).ok).toBe(true);
  });

  it('concurrent enqueues from two connections yield exactly one row', async () => {
    const url = process.env.TEST_DATABASE_URL ?? '';
    const a = createDb(url);
    const b = createDb(url);
    try {
      for (let round = 0; round < 5; round++) {
        await db.delete(botRequests);
        const results = await Promise.all([
          enqueueAdminBotRequest(a.db, 'setup', alice),
          enqueueAdminBotRequest(b.db, 'setup_dry_run', bob),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok)).toEqual([
          { ok: false, message: BOT_BUSY_MESSAGE },
        ]);
        expect(await adminRows()).toHaveLength(1);
      }
    } finally {
      await a.pool.end();
      await b.pool.end();
    }
  });

  it('releases the lock when the body throws', async () => {
    const url = process.env.TEST_DATABASE_URL ?? '';
    const a = createDb(url);
    const b = createDb(url);
    try {
      // A kind longer than varchar(40) makes the insert fail after the lock.
      const tooLong = 'x'.repeat(50) as unknown as 'setup';
      await expect(
        enqueueAdminBotRequest(a.db, tooLong, alice),
      ).rejects.toThrow();
      const started = Date.now();
      expect((await enqueueAdminBotRequest(b.db, 'setup', bob)).ok).toBe(true);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await a.pool.end();
      await b.pool.end();
    }
  });

  it('cancels a queued request but not a running one', async () => {
    const r = await enqueueAdminBotRequest(db, 'setup', alice);
    if (!r.ok) throw new Error('enqueue failed');
    expect(await cancelAdminBotRequest(db, r.id)).toBe(true);
    const [row] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, r.id));
    expect(row).toMatchObject({ status: 'failed', error: 'Cancelled.' });
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(await cancelAdminBotRequest(db, r.id)).toBe(false);

    const r2 = await enqueueAdminBotRequest(db, 'resync', alice);
    if (!r2.ok) throw new Error('enqueue failed');
    await claimNextBotRequest(db, ['resync']);
    expect(await cancelAdminBotRequest(db, r2.id)).toBe(false);
    const [running] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, r2.id));
    expect(running.status).toBe('running');
  });

  it('does not cancel a non-admin request', async () => {
    const e = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    expect(await cancelAdminBotRequest(db, e.id)).toBe(false);
  });

  it('stores a long report truncated to 60 000 chars plus an ellipsis', async () => {
    const r = await enqueueAdminBotRequest(db, 'setup', alice);
    if (!r.ok) throw new Error('enqueue failed');
    await claim(r.id, 'setup');
    await finishBotRequest(
      db,
      r.id,
      'done',
      undefined,
      new Date(),
      'x'.repeat(70_000),
    );
    const [row] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, r.id));
    expect(row.report).toHaveLength(60_001);
    expect(row.report?.endsWith('…')).toBe(true);
    expect(row.report?.slice(0, 60_000)).toBe('x'.repeat(60_000));
  });

  it('stores a long multibyte report (more than 64 KiB in utf8mb4)', async () => {
    const r = await enqueueAdminBotRequest(db, 'setup', alice);
    if (!r.ok) throw new Error('enqueue failed');
    await claim(r.id, 'setup');
    await finishBotRequest(
      db,
      r.id,
      'done',
      undefined,
      new Date(),
      'ł'.repeat(70_000),
    );
    const [row] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, r.id));
    expect(row.report).toHaveLength(60_001);
    expect(row.report?.endsWith('ł…')).toBe(true);
  });

  it('does not split a surrogate pair when truncating', async () => {
    const r = await enqueueAdminBotRequest(db, 'setup', alice);
    if (!r.ok) throw new Error('enqueue failed');
    await claim(r.id, 'setup');
    await finishBotRequest(
      db,
      r.id,
      'done',
      undefined,
      new Date(),
      `${'x'.repeat(59_999)}😀tail`,
    );
    const [row] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, r.id));
    expect(row.report).toBe(`${'x'.repeat(59_999)}…`);
  });

  it('keeps a short report as is, and no report stays null', async () => {
    const r = await enqueueAdminBotRequest(db, 'setup', alice);
    if (!r.ok) throw new Error('enqueue failed');
    await claim(r.id, 'setup');
    await finishBotRequest(db, r.id, 'done', undefined, new Date(), 'ok\n');
    const e = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    await claim(e.id, 'event_post_upsert');
    await finishBotRequest(db, e.id, 'failed', 'boom');
    const rows = await db.select().from(botRequests);
    expect(rows.find((x) => x.id === r.id)?.report).toBe('ok\n');
    expect(rows.find((x) => x.id === e.id)).toMatchObject({
      report: null,
      error: 'boom',
    });
  });

  it('lists admin requests newest first with the requester name', async () => {
    const r1 = await enqueueAdminBotRequest(db, 'setup', alice);
    if (!r1.ok) throw new Error('enqueue failed');
    await claim(r1.id, 'setup');
    await finishBotRequest(db, r1.id, 'done', undefined, new Date(), 'rep');
    await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    const r2 = await enqueueAdminBotRequest(db, 'resync', bob);
    if (!r2.ok) throw new Error('enqueue failed');

    const list = await listAdminBotRequests(db);
    expect(list.map((x) => x.id)).toEqual([r2.id, r1.id]);
    expect(list[0]).toMatchObject({
      kind: 'resync',
      status: 'queued',
      requestedBy: bob,
      requesterName: 'Bob',
      reportChars: 0,
    });
    expect(list[0]).not.toHaveProperty('report');
    expect(list[1]).toMatchObject({
      kind: 'setup',
      status: 'done',
      requestedBy: alice,
      requesterName: 'Alice',
      reportChars: 3,
    });
    expect(list[1]).not.toHaveProperty('report');
    expect(list[1].createdAt).toBeInstanceOf(Date);
    expect(await listAdminBotRequests(db, 1)).toHaveLength(1);
  });

  it('lists a request whose requester is gone with a null name', async () => {
    const [res] = await db.insert(users).values({
      discordUserId: 'abr-gone',
      displayName: 'Gone',
    });
    const r = await enqueueAdminBotRequest(db, 'setup', res.insertId);
    if (!r.ok) throw new Error('enqueue failed');
    await db.delete(users).where(eq(users.id, res.insertId));
    const [row] = await listAdminBotRequests(db);
    expect(row).toMatchObject({
      requestedBy: res.insertId,
      requesterName: null,
    });
  });
  it('counts report characters, not bytes', async () => {
    const r = await enqueueAdminBotRequest(db, 'setup', alice);
    if (!r.ok) throw new Error('enqueue failed');
    await claim(r.id, 'setup');
    await finishBotRequest(db, r.id, 'done', undefined, new Date(), 'łó😀');
    const [row] = await listAdminBotRequests(db);
    expect(row.reportChars).toBe(3); // code points, not UTF-8 bytes
  });

  it('getAdminBotRequest returns one admin request with its report', async () => {
    const r = await enqueueAdminBotRequest(db, 'setup_dry_run', alice);
    if (!r.ok) throw new Error('enqueue failed');
    await claim(r.id, 'setup_dry_run');
    await finishBotRequest(db, r.id, 'done', undefined, new Date(), 'plan\n');
    const got = await getAdminBotRequest(db, r.id);
    expect(got).toMatchObject({
      id: r.id,
      kind: 'setup_dry_run',
      status: 'done',
      report: 'plan\n',
      requestedBy: alice,
      requesterName: 'Alice',
    });
    expect(got?.createdAt).toBeInstanceOf(Date);
    expect(await getAdminBotRequest(db, r.id + 1000)).toBeNull();
    const e = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    expect(await getAdminBotRequest(db, e.id)).toBeNull();
  });

  it('cancels a running request only once it is stuck', async () => {
    expect(STUCK_AFTER_MS).toBe(15 * 60_000);
    const now = new Date();
    const r = await enqueueAdminBotRequest(db, 'setup', alice);
    if (!r.ok) throw new Error('enqueue failed');
    await claimNextBotRequest(db, ['setup'], new Date(now.getTime() - 60_000));
    expect(await cancelAdminBotRequest(db, r.id, now)).toBe(false);
    await db
      .update(botRequests)
      .set({ startedAt: new Date(now.getTime() - 16 * 60_000) })
      .where(eq(botRequests.id, r.id));
    expect(await cancelAdminBotRequest(db, r.id, now)).toBe(true);
    const [row] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, r.id));
    expect(row).toMatchObject({ status: 'failed', error: 'Cancelled.' });
    expect(isCancelled(row)).toBe(true);
    // The stuck run finishing later does not overwrite the cancellation.
    await finishBotRequest(db, r.id, 'done', undefined, now, 'late');
    const [after] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, r.id));
    expect(after).toMatchObject({
      status: 'failed',
      error: 'Cancelled.',
      report: null,
    });
    // ...and the queue is free again.
    expect((await enqueueAdminBotRequest(db, 'resync', bob)).ok).toBe(true);
  });

  it('isCancelled is a failed request with the cancel message', () => {
    expect(isCancelled({ status: 'failed', error: 'Cancelled.' })).toBe(true);
    expect(isCancelled({ status: 'failed', error: 'boom' })).toBe(false);
    expect(isCancelled({ status: 'done', error: 'Cancelled.' })).toBe(false);
  });

  it('the named lock is per database', async () => {
    const url = process.env.TEST_DATABASE_URL ?? '';
    const other = createDb(url);
    const conn = await other.pool.getConnection();
    try {
      // The old server-wide name no longer blocks.
      await conn.query("SELECT GET_LOCK('admin_bot_request', 0)");
      let started = Date.now();
      expect((await enqueueAdminBotRequest(db, 'setup', alice)).ok).toBe(true);
      expect(Date.now() - started).toBeLessThan(2000);
      await conn.query("SELECT RELEASE_LOCK('admin_bot_request')");
      await db.delete(botRequests);

      const [[held]] = (await conn.query(
        "SELECT GET_LOCK(CONCAT(DATABASE(), ':admin_bot_request'), 0) AS got",
      )) as unknown as [{ got: number }[]];
      expect(held.got).toBe(1);
      started = Date.now();
      expect(await enqueueAdminBotRequest(db, 'setup', alice)).toEqual({
        ok: false,
        message: BOT_BUSY_MESSAGE,
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(4000);
      expect(await adminRows()).toHaveLength(0);
    } finally {
      await conn.query('SELECT RELEASE_ALL_LOCKS()');
      conn.release();
      await other.pool.end();
    }
  }, 15_000);
});
