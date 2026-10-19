import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import {
  enqueueMissingEventPosts,
  retryEventPost,
} from '../src/event-posts.js';
import { addSeries } from '../src/event-series.js';
import {
  addEvent,
  BANNED_MESSAGE,
  deleteEvent,
  editEvent,
} from '../src/events.js';
import {
  adminAudit,
  botRequests,
  eventSeries,
  events,
  subjects,
  topics,
  users,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;
const id = {} as Record<string, number>;

const dmy = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};
const lastId = async () => {
  const all = await db.select().from(events).orderBy(events.id);
  return all[all.length - 1].id;
};
const mkEvent = async () => {
  const r = await addEvent(
    db,
    id.u,
    {
      kind: 'kolokwium',
      title: 'K',
      subjectId: id.sub,
      when: `${dmy(5)} 10:00`,
    },
    'web',
  );
  expect(r.ok).toBe(true);
  return lastId();
};
const mkSeries = async () => {
  const r = await addSeries(
    db,
    id.u,
    {
      kind: 'zajecia_dodatkowe',
      title: 'S',
      subjectId: id.sub,
      when: `${dmy(5)} 10:00-11:00`,
      rule: 'weekly',
      until: dmy(30),
    },
    'web',
  );
  expect(r.ok, r.message).toBe(true);
  return r.id as number;
};
const targets = async () =>
  (
    await db
      .select({ kind: botRequests.kind, target: botRequests.target })
      .from(botRequests)
      .where(eq(botRequests.status, 'queued'))
      .orderBy(botRequests.id)
  ).map((r) => `${r.kind} ${r.target}`);

beforeAll(async () => {
  db = await resetTestDb();
  [{ id: id.u }] = await db
    .insert(users)
    .values({ discordUserId: 'd-u', displayName: 'Ala' })
    .$returningId();
  [{ id: id.banned }] = await db
    .insert(users)
    .values({ discordUserId: 'd-b', displayName: 'Ban', isBanned: true })
    .$returningId();
  [{ id: id.sub }] = await db
    .insert(subjects)
    .values({ code: 'BD', name: 'Bazy', semester: 1, ects: 5 })
    .$returningId();
  [{ id: id.topic }] = await db
    .insert(topics)
    .values({ subjectId: id.sub, title: 'P', discordThreadId: 'th-1' })
    .$returningId();
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  await db.delete(botRequests);
  await db.delete(adminAudit);
  await db.delete(events);
  await db.delete(eventSeries);
});

describe('enqueueMissingEventPosts', () => {
  it('queues live events and series without a post, once', async () => {
    const lone = await mkEvent();
    const posted = await mkEvent();
    await db
      .update(events)
      .set({ topicId: id.topic })
      .where(eq(events.id, posted));
    const gone = await mkEvent();
    await deleteEvent(db, id.u, gone, 'web');
    const s = await mkSeries();
    await db.delete(botRequests);
    // One already queued: not duplicated.
    await db.insert(botRequests).values({
      kind: 'event_post_upsert',
      target: `event:${lone}`,
    });
    expect(await enqueueMissingEventPosts(db)).toBe(1);
    expect(await targets()).toEqual([
      `event_post_upsert event:${lone}`,
      `event_post_upsert series:${s}`,
    ]);
    expect(await enqueueMissingEventPosts(db)).toBe(0);
  });
});

describe('retryEventPost', () => {
  it('queues the upsert and audits it', async () => {
    const e = await mkEvent();
    await db.delete(botRequests);
    expect((await retryEventPost(db, id.u, e, 'web')).ok).toBe(true);
    expect(await targets()).toEqual([`event_post_upsert event:${e}`]);
    const audit = await db
      .select()
      .from(adminAudit)
      .where(
        and(
          eq(adminAudit.action, 'event.post_retry'),
          eq(adminAudit.target, String(e)),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toMatchObject({ source: 'web' });
  });

  it('a series occurrence retries the series post', async () => {
    const s = await mkSeries();
    await db.delete(botRequests);
    const [first] = await db
      .select()
      .from(events)
      .where(eq(events.seriesId, s));
    expect((await retryEventPost(db, id.u, first.id, 'web')).ok).toBe(true);
    expect(await targets()).toEqual([`event_post_upsert series:${s}`]);
    const [a] = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, 'event.post_retry'));
    expect(a.target).toBe(`series:${s}`);
  });

  it('refuses banned users and deleted events', async () => {
    const e = await mkEvent();
    await db.delete(botRequests);
    expect(await retryEventPost(db, id.banned, e, 'web')).toEqual({
      ok: false,
      message: BANNED_MESSAGE,
    });
    await deleteEvent(db, id.u, e, 'web');
    await db.delete(botRequests);
    expect((await retryEventPost(db, id.u, e, 'web')).ok).toBe(false);
    expect(await targets()).toEqual([]);
  });
});

describe('a no-op edit of an event without a post', () => {
  it('queues the upsert of the event', async () => {
    const e = await mkEvent();
    await db.delete(botRequests);
    const r = await editEvent(db, id.u, e, { title: 'K' }, 'web');
    expect(r).toEqual({ ok: true, message: 'No changes.' });
    expect(await targets()).toEqual([`event_post_upsert event:${e}`]);
  });

  it('queues nothing when the post exists', async () => {
    const e = await mkEvent();
    await db.update(events).set({ topicId: id.topic }).where(eq(events.id, e));
    await db.delete(botRequests);
    await editEvent(db, id.u, e, { title: 'K' }, 'web');
    expect(await targets()).toEqual([]);
  });

  it('queues the series upsert for an occurrence', async () => {
    const s = await mkSeries();
    await db.delete(botRequests);
    const [first] = await db
      .select()
      .from(events)
      .where(eq(events.seriesId, s));
    const r = await editEvent(db, id.u, first.id, { title: 'S' }, 'web');
    expect(r.message).toBe('No changes.');
    expect(await targets()).toEqual([`event_post_upsert series:${s}`]);
  });
});
