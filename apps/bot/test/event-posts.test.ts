import {
  addEvent,
  adminAudit,
  botRequests,
  botSettings,
  type Db,
  deleteEvent,
  editEvent,
  enqueueBotRequest,
  events,
  eventTopics,
  getEvent,
  restoreEvent,
  setSetting,
  subjects,
  topics,
  unlinkTopic,
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
import {
  DELETED_TEXT,
  type EventPostFields,
  type EventPostGuild,
  eventPostTitle,
} from '../src/events/posts.js';
import { drainEventRequests, startEventPoller } from '../src/events/worker.js';

type FakePost = EventPostFields & {
  forumId: string;
  archived: boolean;
  locked: boolean;
};

function fakeGuild(delayMs = 0) {
  const posts = new Map<string, FakePost>();
  let n = 0;
  let active = 0;
  const g = {
    posts,
    maxActive: 0,
    failCreate: null as Error | null,
    async createPost(forumId: string, post: EventPostFields) {
      active++;
      g.maxActive = Math.max(g.maxActive, active);
      try {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (g.failCreate) throw g.failCreate;
        const id = `th-${++n}`;
        posts.set(id, { ...post, forumId, archived: false, locked: false });
        return id;
      } finally {
        active--;
      }
    },
    async editFirstMessage(threadId: string, post: EventPostFields) {
      const p = posts.get(threadId);
      if (!p) throw new Error('Unknown Channel');
      Object.assign(p, post, { archived: false, locked: false });
    },
    async archivePost(threadId: string, content: string) {
      const p = posts.get(threadId);
      if (!p) throw new Error('Unknown Channel');
      Object.assign(p, { content, archived: true, locked: true });
    },
    async postExists(threadId: string) {
      return posts.has(threadId);
    },
  } satisfies EventPostGuild & Record<string, unknown>;
  return g;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "Kiedy" text for a day `days` from now at 10:00. */
const when = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} 10:00-11:30`;
};

let db: Db;
let userId: number;
let adminId: number;
let bdId: number;
let fizId: number;
let bareId: number;
let guild: ReturnType<typeof fakeGuild>;
const log = vi.fn();
const deps = () => ({ db, guild, webBaseUrl: 'https://x.pl' });
const drain = () => drainEventRequests(deps(), log);

beforeAll(async () => {
  db = await resetTestDb();
  [{ id: userId }] = await db
    .insert(users)
    .values({ discordUserId: 'u1', displayName: 'Ala' })
    .$returningId();
  [{ id: adminId }] = await db
    .insert(users)
    .values({ discordUserId: 'u2', displayName: 'Admin', isAdmin: true })
    .$returningId();
  const subj = async (code: string, channel: string | null) =>
    (
      await db
        .insert(subjects)
        .values({
          code,
          name: `Przedmiot ${code}`,
          semester: 1,
          ects: 5,
          discordChannelId: channel,
        })
        .$returningId()
    )[0].id;
  bdId = await subj('BD', 'f-bd');
  fizId = await subj('FIZ', 'f-fiz');
  bareId = await subj('BRAK', null);
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  guild = fakeGuild();
  log.mockClear();
  await db.delete(botRequests);
  await db.delete(eventTopics);
  await db.delete(events);
  await db.delete(topics);
  await db.delete(adminAudit);
});

const add = async (
  over: Partial<Parameters<typeof addEvent>[2]> = {},
): Promise<number> => {
  const r = await addEvent(
    db,
    userId,
    {
      kind: 'kolokwium',
      title: 'Kolokwium 1',
      subjectId: bdId,
      when: when(10),
      ...over,
    },
    'web',
  );
  expect(r.ok).toBe(true);
  const all = await db.select().from(events).orderBy(events.id);
  return all[all.length - 1].id;
};
const eventRow = async (id: number) =>
  (await db.select().from(events).where(eq(events.id, id)))[0];
const requests = () => db.select().from(botRequests).orderBy(botRequests.id);

describe('event posts', () => {
  it('creating an event and draining the queue gives exactly one post and sets topic_id', async () => {
    const id = await add();
    expect(await drain()).toBe(1);
    expect(guild.posts.size).toBe(1);
    const [post] = [...guild.posts.entries()];
    expect(post[1].forumId).toBe('f-bd');
    expect(post[1].tagName).toBe('Kolokwium');
    expect(post[1].title).toMatch(/^📝 Kolokwium 1 — \d\d\.\d\d$/);
    expect(post[1].content).toContain(`https://x.pl/s/wydarzenia/${id}`);
    const e = await eventRow(id);
    const [t] = await db.select().from(topics);
    expect(e.topicId).toBe(t.id);
    expect(t.discordThreadId).toBe(post[0]);
    expect(t.subjectId).toBe(bdId);
    expect((await requests()).map((r) => r.status)).toEqual(['done']);
    expect(await drain()).toBe(0);
    expect(guild.posts.size).toBe(1);
  });

  it('an edit changes the title and the message of the same post', async () => {
    const id = await add();
    await drain();
    const threadId = [...guild.posts.keys()][0];
    const r = await editEvent(
      db,
      userId,
      id,
      { title: 'Poprawka', kind: 'egzamin', place: 'sala 5' },
      'web',
    );
    expect(r.ok).toBe(true);
    await drain();
    expect(guild.posts.size).toBe(1);
    const p = guild.posts.get(threadId);
    expect(p?.title).toMatch(/^🎓 Poprawka — /);
    expect(p?.tagName).toBe('Egzamin');
    expect(p?.content).toContain('Miejsce: sala 5');
    const [t] = await db.select().from(topics);
    expect(t.title).toBe(p?.title);
  });

  it('a subject change gives a new post and links the old one', async () => {
    const id = await add();
    await drain();
    const [oldTopic] = await db.select().from(topics);
    await editEvent(db, userId, id, { subjectId: fizId }, 'web');
    await drain();
    expect(guild.posts.size).toBe(2);
    const e = await eventRow(id);
    expect(e.topicId).not.toBe(oldTopic.id);
    const [fresh] = await db
      .select()
      .from(topics)
      .where(eq(topics.id, e.topicId as number));
    expect(fresh.subjectId).toBe(fizId);
    expect(guild.posts.get(fresh.discordThreadId)?.forumId).toBe('f-fiz');
    const links = await db.select().from(eventTopics);
    expect(links).toEqual([
      { id: expect.any(Number), eventId: id, topicId: oldTopic.id },
    ]);
    // Another upsert changes nothing more.
    await enqueueBotRequest(db, 'event_post_upsert', `event:${id}`);
    await drain();
    expect(guild.posts.size).toBe(2);
    expect(await db.select().from(eventTopics)).toHaveLength(1);
  });

  it('a delete archives the post; a restore reopens it', async () => {
    const id = await add();
    await drain();
    const threadId = [...guild.posts.keys()][0];
    await deleteEvent(db, userId, id, 'web');
    await drain();
    expect(guild.posts.get(threadId)).toMatchObject({
      content: DELETED_TEXT,
      archived: true,
      locked: true,
    });
    await restoreEvent(db, adminId, id, 'web');
    await drain();
    expect(guild.posts.size).toBe(1);
    expect(guild.posts.get(threadId)).toMatchObject({
      archived: false,
      locked: false,
    });
    expect(guild.posts.get(threadId)?.content).not.toBe(DELETED_TEXT);
  });

  it('archiving a live event is a no-op', async () => {
    const id = await add();
    await drain();
    await enqueueBotRequest(db, 'event_post_archive', `event:${id}`);
    await drain();
    expect([...guild.posts.values()][0].archived).toBe(false);
    expect((await requests()).every((r) => r.status === 'done')).toBe(true);
  });

  it('a deleted post is recreated on the next upsert', async () => {
    const id = await add();
    await drain();
    const [oldThread] = [...guild.posts.keys()];
    guild.posts.delete(oldThread);
    await editEvent(db, userId, id, { place: 'sala 1' }, 'web');
    await drain();
    expect(guild.posts.size).toBe(1);
    const [newThread] = [...guild.posts.keys()];
    expect(newThread).not.toBe(oldThread);
    const e = await eventRow(id);
    const [t] = await db
      .select()
      .from(topics)
      .where(eq(topics.id, e.topicId as number));
    expect(t.discordThreadId).toBe(newThread);
    // The vanished post is not linked as a "linked post".
    expect(await db.select().from(eventTopics)).toHaveLength(0);
  });

  it('skips an upsert queued for a deleted event (unlink after delete)', async () => {
    const id = await add();
    await drain();
    const [t] = await db.select().from(topics);
    await db.insert(eventTopics).values({ eventId: id, topicId: t.id });
    await deleteEvent(db, userId, id, 'web');
    await unlinkTopic(db, userId, id, t.id, 'web');
    await drain();
    const kinds = await requests();
    expect(kinds.every((r) => r.status === 'done')).toBe(true);
    expect(guild.posts.size).toBe(1);
    expect([...guild.posts.values()][0].archived).toBe(true);
  });

  it('puts an event without a subject in #wydarzenia', async () => {
    await setSetting(db, 'events_forum_id', 'f-events');
    const id = await add({
      subjectId: null,
      kind: 'wyjazd',
      title: 'Wycieczka',
    });
    await drain();
    const [t] = await db.select().from(topics);
    expect(t.subjectId).toBeNull();
    expect([...guild.posts.values()][0]).toMatchObject({
      forumId: 'f-events',
      tagName: 'Wyjazd',
    });
    expect((await eventRow(id)).topicId).toBe(t.id);
    await db.delete(events);
    await db.delete(topics);
    await db.delete(botRequests);
  });

  it('fails with a Polish error when the subject has no forum', async () => {
    await add({ subjectId: bareId });
    await drain();
    const [r] = await requests();
    expect(r.status).toBe('failed');
    expect(r.error).toBe(
      'Brak forum przedmiotu na Discordzie — uruchom /setup.',
    );
    expect(guild.posts.size).toBe(0);
  });

  it('fails when #wydarzenia was never set up', async () => {
    await db.delete(botSettings);
    await add({ subjectId: null });
    await drain();
    const [r] = await requests();
    expect(r.status).toBe('failed');
    expect(r.error).toBe('Brak forum #wydarzenia — uruchom /setup.');
  });

  it('a Discord failure gives a generic Polish error and logs the details', async () => {
    guild.failCreate = new Error('boom');
    await add();
    await drain();
    const [r] = await requests();
    expect(r.status).toBe('failed');
    expect(r.error).toBe('Nie udało się zaktualizować posta na Discordzie.');
    expect(log).toHaveBeenCalled();
    expect(await db.select().from(topics)).toHaveLength(0);
  });

  it('the poller handles requests one at a time and never overlaps itself', async () => {
    guild = fakeGuild(20);
    await add({ title: 'A' });
    await add({ title: 'B' });
    await add({ title: 'C' });
    const poller = startEventPoller(deps(), 1);
    await vi.waitFor(
      async () => {
        expect((await requests()).every((r) => r.status === 'done')).toBe(true);
      },
      { timeout: 5000 },
    );
    await poller.stop();
    expect(guild.posts.size).toBe(3);
    expect(guild.maxActive).toBe(1);
  });
});

describe('eventPostTitle', () => {
  it('stays within 100 characters', async () => {
    const id = await add({ title: 'x'.repeat(100) });
    const e = await getEvent(db, id);
    if (!e) throw new Error('no event');
    expect(eventPostTitle(e).length).toBeLessThanOrEqual(100);
    expect(eventPostTitle(e)).toMatch(/ — \d\d\.\d\d$/);
  });
});
