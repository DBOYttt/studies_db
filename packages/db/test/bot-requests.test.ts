import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claimNextBotRequest,
  enqueueBotRequest,
  failStaleBotRequests,
  finishBotRequest,
  lastBotRequest,
  pruneBotRequests,
} from '../src/bot-requests.js';
import { createDb, type Db } from '../src/client.js';
import { botRequests } from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;

beforeAll(async () => {
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  await db.delete(botRequests);
});

describe('bot request queue', () => {
  it('a duplicate queued request is a no-op', async () => {
    const a = await enqueueBotRequest(db, 'event_post_upsert', 'event:1', {
      x: 1,
    });
    const b = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    await enqueueBotRequest(db, 'event_post_archive', 'event:1');
    await enqueueBotRequest(db, 'event_post_upsert', 'event:2');
    const rows = await db.select().from(botRequests);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === a.id)).toMatchObject({
      status: 'queued',
      payload: { x: 1 },
    });
  });

  it('a running request does not block a new queued one', async () => {
    await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    const claimed = await claimNextBotRequest(db, ['event_post_upsert']);
    expect(claimed).toMatchObject({
      kind: 'event_post_upsert',
      target: 'event:1',
    });
    const again = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    expect(again.created).toBe(true);
  });

  it('claims the oldest queued request of the given kinds and marks it running', async () => {
    const a = await enqueueBotRequest(db, 'setup', 'guild');
    const b = await enqueueBotRequest(db, 'event_post_upsert', 'event:1', {
      p: true,
    });
    const c = await enqueueBotRequest(db, 'event_post_archive', 'event:2');
    const r = await claimNextBotRequest(db, [
      'event_post_upsert',
      'event_post_archive',
    ]);
    expect(r).toMatchObject({
      id: b.id,
      kind: 'event_post_upsert',
      target: 'event:1',
      payload: { p: true },
    });
    const [row] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, b.id));
    expect(row.status).toBe('running');
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(
      (
        await claimNextBotRequest(db, [
          'event_post_upsert',
          'event_post_archive',
        ])
      )?.id,
    ).toBe(c.id);
    expect(
      await claimNextBotRequest(db, [
        'event_post_upsert',
        'event_post_archive',
      ]),
    ).toBeNull();
    expect(await claimNextBotRequest(db, [])).toBeNull();
    expect((await claimNextBotRequest(db, ['setup']))?.id).toBe(a.id);
  });

  it('claiming is exclusive: two concurrent claims get one row', async () => {
    const other = createDb(process.env.TEST_DATABASE_URL as string).db;
    try {
      await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
      const [x, y] = await Promise.all([
        claimNextBotRequest(db, ['event_post_upsert']),
        claimNextBotRequest(other, ['event_post_upsert']),
      ]);
      expect([x, y].filter((r) => r !== null)).toHaveLength(1);
    } finally {
      await closeTestDb(other);
    }
  });

  it('finishBotRequest records the outcome; lastBotRequest returns the newest', async () => {
    expect(await lastBotRequest(db, 'event_post_upsert', 'event:1')).toBeNull();
    const a = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    await claimNextBotRequest(db, ['event_post_upsert']);
    await finishBotRequest(db, a.id, 'failed', 'x'.repeat(600));
    const last = await lastBotRequest(db, 'event_post_upsert', 'event:1');
    expect(last).toMatchObject({ id: a.id, status: 'failed' });
    expect(last?.error).toHaveLength(500);
    expect(last?.finishedAt).toBeInstanceOf(Date);
    const b = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    expect(
      await lastBotRequest(db, 'event_post_upsert', 'event:1'),
    ).toMatchObject({ id: b.id, status: 'queued', error: null });
    await claimNextBotRequest(db, ['event_post_upsert']);
    await finishBotRequest(db, b.id, 'done');
    expect(
      await lastBotRequest(db, 'event_post_upsert', 'event:1'),
    ).toMatchObject({ id: b.id, status: 'done', error: null });
  });

  it('finishBotRequest leaves a row that is no longer running alone', async () => {
    const a = await enqueueBotRequest(db, 'event_post_upsert', 'event:9');
    await claimNextBotRequest(db, ['event_post_upsert']);
    await finishBotRequest(db, a.id, 'failed', 'first');
    await finishBotRequest(db, a.id, 'done');
    expect(
      await lastBotRequest(db, 'event_post_upsert', 'event:9'),
    ).toMatchObject({ id: a.id, status: 'failed', error: 'first' });
    const q = await enqueueBotRequest(db, 'event_post_upsert', 'event:10');
    await finishBotRequest(db, q.id, 'done');
    expect(
      await lastBotRequest(db, 'event_post_upsert', 'event:10'),
    ).toMatchObject({ id: q.id, status: 'queued' });
  });

  it('a stale running request is failed', async () => {
    const old = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    const fresh = await enqueueBotRequest(db, 'event_post_upsert', 'event:2');
    const queued = await enqueueBotRequest(db, 'event_post_upsert', 'event:3');
    const now = new Date('2030-01-01T12:00:00Z');
    await db
      .update(botRequests)
      .set({ status: 'running', startedAt: new Date('2030-01-01T11:40:00Z') })
      .where(eq(botRequests.id, old.id));
    await db
      .update(botRequests)
      .set({ status: 'running', startedAt: new Date('2030-01-01T11:50:00Z') })
      .where(eq(botRequests.id, fresh.id));
    expect(await failStaleBotRequests(db, now)).toBe(1);
    const rows = new Map(
      (await db.select().from(botRequests)).map((r) => [r.id, r]),
    );
    expect(rows.get(old.id)).toMatchObject({
      status: 'failed',
      finishedAt: now,
    });
    expect(rows.get(old.id)?.error).toMatch(/\S/);
    expect(rows.get(fresh.id)?.status).toBe('running');
    expect(rows.get(queued.id)?.status).toBe('queued');
    // every running request when olderThanMs is 0
    expect(await failStaleBotRequests(db, now, 0)).toBe(1);
  });

  it('pruneBotRequests deletes only finished requests older than the cutoff', async () => {
    const now = new Date('2030-03-01T12:00:00Z');
    const old = new Date('2030-01-01T12:00:00Z');
    const recent = new Date('2030-02-25T12:00:00Z');
    const add = async (
      status: 'queued' | 'running' | 'done' | 'failed',
      createdAt: Date,
      finishedAt: Date | null,
    ) => {
      const [r] = await db.insert(botRequests).values({
        kind: 'event_post_upsert',
        target: `event:${status}:${createdAt.getTime()}`,
        status,
        createdAt,
        finishedAt,
      });
      return r.insertId;
    };
    await add('done', old, old);
    await add('failed', old, old);
    const keepQueued = await add('queued', old, null);
    const keepRunning = await add('running', old, null);
    const keepRecent = await add('done', recent, recent);
    // created long ago but finished recently: kept too
    const keepLateFinish = await add('failed', old, recent);
    expect(await pruneBotRequests(db, now)).toBe(2);
    const left = (await db.select({ id: botRequests.id }).from(botRequests))
      .map((r) => r.id)
      .sort((a, b) => a - b);
    expect(left).toEqual(
      [keepQueued, keepRunning, keepRecent, keepLateFinish].sort(
        (a, b) => a - b,
      ),
    );
  });
});
