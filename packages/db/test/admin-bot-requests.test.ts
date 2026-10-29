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
  listAdminBotRequests,
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
    await finishBotRequest(db, r.id, 'done', undefined, new Date(), 'ok\n');
    const e = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
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
      report: null,
    });
    expect(list[1]).toMatchObject({
      kind: 'setup',
      status: 'done',
      requestedBy: alice,
      requesterName: 'Alice',
      report: 'rep',
    });
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
});
