import {
  addEvent,
  addSeries,
  adminAudit,
  botRequests,
  botSettings,
  type Db,
  deleteEvent,
  type EventDetails,
  editEvent,
  enqueueBotRequest,
  eventSeries,
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
import { ChannelType, type Client } from 'discord.js';
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
  discordEventPostGuild,
  type EventPostFields,
  type EventPostGuild,
  eventForumCheck,
  eventPostContent,
  eventPostTitle,
  eventWhenText,
  PostGoneError,
  seriesPostContent,
  seriesPostTitle,
} from '../src/events/posts.js';
import {
  drainEventRequests,
  enqueueRenameRetry,
  recoverInterruptedRequests,
  startEventPoller,
} from '../src/events/worker.js';

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
    goneOnEdit: false,
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
      if (g.goneOnEdit) throw new PostGoneError('Unknown Message');
      Object.assign(p, post, { archived: false, locked: false });
    },
    async archivePost(threadId: string, content: string) {
      const p = posts.get(threadId);
      if (!p) throw new Error('Unknown Channel');
      Object.assign(p, { content, archived: true, locked: true });
    },
    async sendFiles() {
      return [];
    },
    async postExists(threadId: string) {
      return posts.has(threadId);
    },
  } satisfies EventPostGuild & Record<string, unknown>;
  return g;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "When" text for a day `days` from now at 10:00. */
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
const deps = () => ({
  db,
  guild,
  webBaseUrl: 'https://x.pl',
  storageDir: '/nonexistent',
});
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
  await db.delete(eventSeries);
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
    expect(post[1].title).toMatch(/^📝 Kolokwium 1 — \d{1,2} [A-Z][a-z]{2}$/);
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
    expect(p?.content).toContain('Place: sala 5');
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
      {
        id: expect.any(Number),
        eventId: id,
        seriesId: null,
        topicId: oldTopic.id,
      },
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
      'The subject forum is missing on Discord. Run /setup.',
    );
    expect(guild.posts.size).toBe(0);
  });

  it('fails when #wydarzenia was never set up', async () => {
    await db.delete(botSettings);
    await add({ subjectId: null });
    await drain();
    const [r] = await requests();
    expect(r.status).toBe('failed');
    expect(r.error).toBe('The #wydarzenia forum is missing. Run /setup.');
  });

  it('a Discord failure gives a generic Polish error and logs the details', async () => {
    guild.failCreate = new Error('boom');
    await add();
    await drain();
    const [r] = await requests();
    expect(r.status).toBe('failed');
    expect(r.error).toBe('Could not update the post on Discord.');
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

  it('a stop during a backlog returns after the current request', async () => {
    await add({ title: 'A' });
    await add({ title: 'B' });
    await add({ title: 'C' });
    let stopped = false;
    const create = guild.createPost;
    guild.createPost = async (forumId, post) => {
      stopped = true;
      return create(forumId, post);
    };
    const n = await drainEventRequests(deps(), log, () => stopped);
    expect(n).toBe(1);
    expect(guild.posts.size).toBe(1);
    expect((await requests()).map((r) => r.status)).toEqual([
      'done',
      'queued',
      'queued',
    ]);
  });

  it('stop() of the poller waits only for the current request', async () => {
    guild = fakeGuild(50);
    await add({ title: 'A' });
    await add({ title: 'B' });
    await add({ title: 'C' });
    const poller = startEventPoller(deps(), 1);
    await vi.waitFor(() => expect(guild.maxActive).toBe(1));
    await poller.stop();
    expect(guild.posts.size).toBe(1);
  });
});

describe('event post fixes', () => {
  it('a vanished first message recreates the post instead of failing', async () => {
    const id = await add();
    await drain();
    const [oldThread] = [...guild.posts.keys()];
    guild.goneOnEdit = true;
    await editEvent(db, userId, id, { place: 'sala 2' }, 'web');
    await drain();
    guild.goneOnEdit = false;
    expect((await requests()).every((r) => r.status === 'done')).toBe(true);
    const e = await eventRow(id);
    const [t] = await db
      .select()
      .from(topics)
      .where(eq(topics.id, e.topicId as number));
    expect(t.discordThreadId).not.toBe(oldThread);
    expect(guild.posts.get(t.discordThreadId)?.content).toContain('sala 2');
  });

  it('keeps the link when a long note must be trimmed', async () => {
    const id = await add({
      title: 'T'.repeat(100),
      place: 'P'.repeat(100),
      note: 'ż'.repeat(1000),
    });
    const e = await getEvent(db, id);
    if (!e) throw new Error('no event');
    const long = {
      ...e,
      subjectName: 'N'.repeat(300),
      createdByName: 'A'.repeat(500),
      updatedByName: 'B'.repeat(500),
    };
    const link = `Details and files: https://x.pl/s/wydarzenia/${id}`;
    const c = eventPostContent(long, 'https://x.pl');
    expect(c.length).toBeLessThanOrEqual(2000);
    expect(c.endsWith(link)).toBe(true);
    expect(c).toContain('Note: ż');
    expect(c).toContain('…\n');
    // A short note is untouched.
    expect(
      eventPostContent({ ...e, note: 'krótka' }, 'https://x.pl'),
    ).toContain('Note: krótka\n');
  });

  it('breaks masked links and headings in user text (L2)', async () => {
    const id = await add({
      place: '[Room](https://phish)',
      note: 'ok\n# Big\n[Notes](https://phish)',
    });
    const e = await getEvent(db, id);
    if (!e) throw new Error('no event');
    const c = eventPostContent(
      { ...e, createdByName: '[Admin](https://phish)' },
      'https://x.pl',
    );
    expect(c).toContain('Place: \\[Room](https://phish)');
    expect(c).toContain('\n\\# Big\n\\[Notes](https://phish)');
    expect(c).toContain('Added by \\[Admin](https://phish)');
    const sc = seriesPostContent(e, e, 'weekly', [e.startsAt], 'https://x.pl');
    expect(sc).toContain('Place: \\[Room](https://phish)');
    expect(sc).toContain('\\# Big');
  });

  it('escapes markdown in place, note and names, not in the link', async () => {
    const id = await add({ place: '*sala*', note: '__ważne__ `x`' });
    const e = await getEvent(db, id);
    if (!e) throw new Error('no event');
    const c = eventPostContent(
      { ...e, createdByName: 'A_b_', updatedByName: '~~c~~' },
      'https://x.pl',
    );
    expect(c).toContain('Place: \\*sala\\*');
    expect(c).toContain('Note: \\_\\_ważne\\_\\_ \\`x\\`');
    expect(c).toContain('Added by A\\_b\\_');
    expect(c).toContain('Last edited by \\~\\~c\\~\\~');
    expect(
      c.endsWith(`Details and files: https://x.pl/s/wydarzenia/${id}`),
    ).toBe(true);
    const sc = seriesPostContent(
      { ...e, createdByName: 'A_b_' },
      e,
      'weekly',
      [e.startsAt],
      'https://x.pl',
    );
    expect(sc).toContain('Place: \\*sala\\*');
    expect(sc).toContain('Added by A\\_b\\_');
  });

  it('boot recovery fails interrupted event requests, then the poller proceeds', async () => {
    const id = await add();
    await db.delete(botRequests);
    const old = new Date(Date.now() - 1000);
    await db.insert(botRequests).values([
      {
        kind: 'event_post_upsert',
        target: `event:${id}`,
        status: 'running',
        startedAt: old,
      },
      {
        kind: 'event_upload',
        target: 'event:9',
        status: 'running',
        startedAt: old,
      },
    ]);
    // event_upload is an event kind too: both are failed.
    expect(await recoverInterruptedRequests(db)).toBe(2);
    const rows = await requests();
    expect(rows[0]).toMatchObject({
      status: 'failed',
      error: 'Interrupted: the bot was restarted.',
    });
    expect(rows[1].status).toBe('failed');
    await enqueueBotRequest(db, 'event_post_upsert', `event:${id}`);
    const poller = startEventPoller(deps(), 1);
    await vi.waitFor(async () => {
      expect((await requests())[2].status).toBe('done');
    });
    await poller.stop();
    expect(guild.posts.size).toBe(1);
  });
});

describe('eventPostTitle', () => {
  it('stays within 100 characters', async () => {
    const id = await add({ title: 'x'.repeat(100) });
    const e = await getEvent(db, id);
    if (!e) throw new Error('no event');
    expect(eventPostTitle(e).length).toBeLessThanOrEqual(100);
    expect(eventPostTitle(e)).toMatch(/ — \d{1,2} [A-Z][a-z]{2}$/);
  });

  it('does not split surrogate pairs when clipping', async () => {
    const id = await add({ title: '😀'.repeat(50) });
    const e = await getEvent(db, id);
    if (!e) throw new Error('no event');
    const t = eventPostTitle(e);
    expect([...t].length).toBeLessThanOrEqual(100);
    expect(t).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(t).toContain('…');
  });
});

describe('series posts', () => {
  const dmyOf = (days: number) => when(days).slice(0, 10);
  const mk = async (over: Record<string, unknown> = {}) => {
    const r = await addSeries(
      db,
      userId,
      {
        kind: 'zajecia_dodatkowe',
        title: 'Konsultacje',
        subjectId: bdId,
        when: when(3),
        rule: 'weekly',
        until: dmyOf(24),
        ...over,
      },
      'web',
    );
    expect(r.ok, r.message).toBe(true);
    return r.id as number;
  };
  const occ = (sid: number) =>
    db
      .select()
      .from(events)
      .where(eq(events.seriesId, sid))
      .orderBy(events.startsAt);

  it('titles: code-point clip, weekly and biweekly', () => {
    expect(seriesPostTitle('Konsultacje', 'weekly')).toBe(
      '🔁 Konsultacje — every week',
    );
    expect(seriesPostTitle('K', 'biweekly')).toBe('🔁 K — every 2 weeks');
    const long = seriesPostTitle('😀'.repeat(150), 'weekly');
    expect(long.length).toBeLessThanOrEqual(100);
    for (const n of [40, 41, 42, 43]) {
      const t = seriesPostTitle(`${'a'.repeat(n)}${'😀'.repeat(60)}`, 'weekly');
      expect(t.length).toBeLessThanOrEqual(100);
      expect(t).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(t).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(long.endsWith(' — every week')).toBe(true);
    expect(long).not.toMatch(/\uFFFD/);
  });

  it('event titles also clip by UTF-16 length without splitting emoji', () => {
    for (const n of [60, 61, 62, 63, 64]) {
      const t = eventPostTitle({
        kind: 'inne',
        title: `${'a'.repeat(n)}${'😀'.repeat(60)}`,
        startsAt: new Date(Date.UTC(2026, 9, 20, 10)),
      } as never);
      expect(t.length).toBeLessThanOrEqual(100);
      expect(t).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });

  it('queues series:<id> and makes ONE post for all occurrences', async () => {
    const sid = await mk();
    expect((await requests()).map((r) => r.target)).toEqual([`series:${sid}`]);
    await drain();
    expect(guild.posts.size).toBe(1);
    const p = [...guild.posts.values()][0];
    expect(p.title).toBe('🔁 Konsultacje — every week');
    expect(p.tagName).toBe('Zajęcia dodatkowe');
    expect(p.content).toContain('Repeats: every week');
    const [s] = await db.select().from(eventSeries);
    expect(s.topicId).not.toBeNull();
    for (const e of await occ(sid)) expect(e.topicId).toBeNull();
    await enqueueBotRequest(db, 'event_post_upsert', `series:${sid}`);
    await drain();
    expect(guild.posts.size).toBe(1);
  });

  it('"Next" counts from the Warsaw wall clock, not UTC', async () => {
    const sid = await mk();
    const [first, second] = await occ(sid);
    // Wall time 10 minutes after the UTC clock: already past in Warsaw.
    await db
      .update(events)
      .set({ startsAt: new Date(Date.now() + 10 * 60_000), endsAt: null })
      .where(eq(events.id, first.id));
    await drain();
    const p = [...guild.posts.values()][0];
    expect(p.content).toContain(`/s/wydarzenia/${second.id}`);
  });

  it('a split shares one post; no second post, archived only when nothing is left', async () => {
    const sid = await mk();
    await drain();
    const [a, b] = await occ(sid);
    const r = await editEvent(
      db,
      userId,
      b.id,
      { title: 'Zmiana' },
      'web',
      'following',
    );
    expect(r.ok, r.message).toBe(true);
    expect(
      (await requests()).filter((q) => q.status === 'queued'),
    ).toHaveLength(2);
    await drain();
    expect(guild.posts.size).toBe(1);
    const all = await db.select().from(eventSeries);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((x) => x.topicId)).size).toBe(1);
    const p = [...guild.posts.values()][0];
    expect(p.title).toBe('🔁 Zmiana — every week');
    // the old series is deleted entirely: the post stays for the other one
    await deleteEvent(db, userId, a.id, 'web', 'following');
    await drain();
    expect([...guild.posts.values()][0].archived).toBe(false);
    expect(guild.posts.size).toBe(1);
    // the last live occurrences go: now it is archived
    await deleteEvent(db, userId, b.id, 'web', 'following');
    await drain();
    expect([...guild.posts.values()][0]).toMatchObject({
      archived: true,
      content: DELETED_TEXT,
    });
  });

  it('a split before the post exists still gives exactly one post', async () => {
    const sid = await mk();
    const [, b] = await occ(sid);
    const r = await editEvent(
      db,
      userId,
      b.id,
      { title: 'Zmiana' },
      'web',
      'following',
    );
    expect(r.ok, r.message).toBe(true);
    await drain();
    expect(guild.posts.size).toBe(1);
    const all = await db.select().from(eventSeries);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((x) => x.topicId)).size).toBe(1);
    expect(all[0].topicId).not.toBeNull();
    expect(await db.select().from(topics)).toHaveLength(1);
    await drain();
    expect(guild.posts.size).toBe(1);
  });

  it('a split after the first request failed still gives one post after the retry', async () => {
    const sid = await mk();
    guild.failCreate = new Error('boom');
    await drain();
    expect(guild.posts.size).toBe(0);
    guild.failCreate = null;
    const [, b] = await occ(sid);
    await editEvent(db, userId, b.id, { title: 'Zmiana' }, 'web', 'following');
    await drain();
    await enqueueBotRequest(db, 'event_post_upsert', `series:${sid}`);
    await drain();
    expect(guild.posts.size).toBe(1);
    expect(await db.select().from(topics)).toHaveLength(1);
  });

  it('a second split keeps one post for the whole lineage', async () => {
    const sid = await mk({ until: dmyOf(38) });
    const [, b] = await occ(sid);
    await editEvent(db, userId, b.id, { title: 'B' }, 'web', 'following');
    const [bRow] = await db.select().from(events).where(eq(events.id, b.id));
    const bs = bRow as { seriesId: number | null };
    const [, c] = await occ(bs.seriesId as number);
    await editEvent(db, userId, c.id, { title: 'C' }, 'web', 'following');
    await drain();
    expect(guild.posts.size).toBe(1);
    expect(await db.select().from(topics)).toHaveLength(1);
    expect([...guild.posts.values()][0].title).toBe('🔁 C — every week');
  });

  it('a deleted series archives its post; a restore reopens it', async () => {
    const sid = await mk();
    await drain();
    const [first] = await occ(sid);
    await deleteEvent(db, userId, first.id, 'web', 'following');
    await drain();
    expect([...guild.posts.values()][0]).toMatchObject({
      content: DELETED_TEXT,
      archived: true,
    });
    await restoreEvent(db, adminId, first.id, 'web');
    await drain();
    expect(guild.posts.size).toBe(1);
    expect([...guild.posts.values()][0].archived).toBe(false);
  });
});

describe('enqueueRenameRetry', () => {
  it('queues an upsert for the event or series that owns the thread', async () => {
    const id = await add();
    await drain();
    await db.delete(botRequests);
    const e = await eventRow(id);
    const [t] = await db
      .select()
      .from(topics)
      .where(eq(topics.id, e.topicId as number));
    expect(await enqueueRenameRetry(db, t.discordThreadId)).toBe(`event:${id}`);
    const [r] = await requests();
    expect(r).toMatchObject({
      kind: 'event_post_upsert',
      target: `event:${id}`,
      status: 'queued',
    });
    // Twice is still one queued request.
    await enqueueRenameRetry(db, t.discordThreadId);
    expect(await requests()).toHaveLength(1);
    expect(await enqueueRenameRetry(db, 'unknown-thread')).toBeNull();
  });
});

describe('discordEventPostGuild only touches its own event posts', () => {
  type FakeThread = {
    id: string;
    guildId: string;
    ownerId: string;
    parentId: string;
    archived: boolean;
    locked: boolean;
    name: string;
    appliedTags: string[];
    parent: null;
    isThread(): true;
    setArchived: ReturnType<typeof vi.fn>;
    setLocked: ReturnType<typeof vi.fn>;
    setName: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    fetchStarterMessage(): Promise<{ edit: ReturnType<typeof vi.fn> }>;
  };
  const thread = (id: string, ownerId: string, parentId: string) => {
    const edit = vi.fn(async () => undefined);
    const t: FakeThread = {
      id,
      guildId: 'G1',
      ownerId,
      parentId,
      archived: true,
      locked: true,
      name: 'x',
      appliedTags: [],
      parent: null,
      isThread: () => true,
      setArchived: vi.fn(async () => undefined),
      setLocked: vi.fn(async () => undefined),
      setName: vi.fn(async () => undefined),
      send: vi.fn(async () => ({ attachments: new Map(), id: 'm' })),
      fetchStarterMessage: async () => ({ edit }),
    };
    return t;
  };
  const threads = new Map<string, FakeThread>();
  const forums = new Map<string, unknown>();
  const client = {
    user: { id: 'bot' },
    channels: {
      fetch: async (id: string) => threads.get(id) ?? forums.get(id) ?? null,
    },
  } as unknown as Client;
  let now = 0;
  const opts = { guildId: 'G1', now: () => now };
  const post = { title: 't', content: 'c', tagName: 'Inne' };

  beforeEach(async () => {
    threads.clear();
    forums.clear();
    now = 0;
    await setSetting(db, 'events_forum_id', 'f-events');
    threads.set('own-ev', thread('own-ev', 'bot', 'f-events'));
    threads.set('own-bd', thread('own-bd', 'bot', 'f-bd'));
    threads.set('foreign-owner', thread('foreign-owner', 'u9', 'f-events'));
    threads.set('foreign-forum', thread('foreign-forum', 'bot', 'f-other'));
  });

  it('accepts bot threads in #wydarzenia or a subject forum', async () => {
    const g = discordEventPostGuild(client, eventForumCheck(db), opts);
    expect(await g.postExists('own-ev')).toBe(true);
    expect(await g.postExists('own-bd')).toBe(true);
    await g.editFirstMessage('own-bd', post);
    expect(threads.get('own-bd')?.setLocked).toHaveBeenCalledWith(
      false,
      'event',
    );
  });

  it('swaps the Polish kind tag when the kind changes (no duplicates)', async () => {
    const t = threads.get('own-ev') as unknown as {
      parent: unknown;
      appliedTags: string[];
      setAppliedTags: ReturnType<typeof vi.fn>;
    };
    t.parent = {
      type: ChannelType.GuildForum,
      availableTags: [
        { id: 'k', name: 'Kolokwium' },
        { id: 'e', name: 'Egzamin' },
        { id: 'n', name: 'Notatki' },
      ],
    };
    t.appliedTags = ['n', 'k'];
    t.setAppliedTags = vi.fn(async () => undefined);
    const g = discordEventPostGuild(client, eventForumCheck(db), opts);
    await g.editFirstMessage('own-ev', { ...post, tagName: 'Egzamin' });
    expect(t.setAppliedTags).toHaveBeenCalledWith(['n', 'e'], 'event');
  });

  it('renames a post at most once per 10 minutes; the next edit catches up (R4)', async () => {
    const t = threads.get('own-ev') as FakeThread;
    const g = discordEventPostGuild(client, eventForumCheck(db), opts);
    await g.editFirstMessage('own-ev', { ...post, title: 'A' });
    expect(t.setName).toHaveBeenCalledTimes(1);
    t.name = 'A';
    now = 9 * 60_000;
    await g.editFirstMessage('own-ev', { ...post, title: 'B' });
    // Skipped, but the rest of the edit still happens.
    expect(t.setName).toHaveBeenCalledTimes(1);
    expect(t.setLocked).toHaveBeenCalledTimes(2);
    now = 10 * 60_000 + 1;
    await g.editFirstMessage('own-ev', { ...post, title: 'B' });
    expect(t.setName).toHaveBeenCalledTimes(2);
    expect(t.setName).toHaveBeenLastCalledWith('B', 'event');
    // The window is per post.
    await g.editFirstMessage('own-bd', { ...post, title: 'C' });
    expect(threads.get('own-bd')?.setName).toHaveBeenCalledWith('C', 'event');
  });

  it('retries a postponed rename once, when the window has passed (R4)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const retryRename = vi.fn();
      const g = discordEventPostGuild(client, eventForumCheck(db), {
        ...opts,
        retryRename,
      });
      const t = threads.get('own-ev') as FakeThread;
      await g.editFirstMessage('own-ev', { ...post, title: 'A' });
      t.name = 'A';
      now = 9 * 60_000;
      await g.editFirstMessage('own-ev', { ...post, title: 'B' });
      now = 9.5 * 60_000;
      await g.editFirstMessage('own-ev', { ...post, title: 'C' });
      // One timer per thread, due when the window ends (10 min after A).
      await vi.advanceTimersByTimeAsync(60_000 - 1);
      expect(retryRename).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(retryRename).toHaveBeenCalledTimes(1);
      expect(retryRename).toHaveBeenCalledWith('own-ev');
      // dispose() drops a pending retry.
      now = 10 * 60_000 + 1;
      await g.editFirstMessage('own-ev', { ...post, title: 'D' });
      t.name = 'D';
      now = 11 * 60_000;
      await g.editFirstMessage('own-ev', { ...post, title: 'E' });
      g.dispose();
      await vi.advanceTimersByTimeAsync(20 * 60_000);
      expect(retryRename).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses threads and forums of another guild', async () => {
    const other = thread('other-guild', 'bot', 'f-events');
    other.guildId = 'G2';
    threads.set('other-guild', other);
    const create = vi.fn(async () => ({ id: 'new' }));
    const forum = (guildId: string) => ({
      id: 'f',
      guildId,
      type: ChannelType.GuildForum,
      availableTags: [],
      threads: { create },
    });
    forums.set('f-here', forum('G1'));
    forums.set('f-there', forum('G2'));
    const g = discordEventPostGuild(client, eventForumCheck(db), opts);
    expect(await g.postExists('other-guild')).toBe(false);
    await expect(
      g.editFirstMessage('other-guild', post),
    ).rejects.toBeInstanceOf(PostGoneError);
    expect(other.setArchived).not.toHaveBeenCalled();
    await expect(g.createPost('f-there', post)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(await g.createPost('f-here', post)).toBe('new');
  });

  it.each(['foreign-owner', 'foreign-forum'])(
    'refuses %s as gone, without touching it',
    async (id) => {
      const g = discordEventPostGuild(client, eventForumCheck(db), opts);
      expect(await g.postExists(id)).toBe(false);
      await expect(g.editFirstMessage(id, post)).rejects.toBeInstanceOf(
        PostGoneError,
      );
      await expect(g.archivePost(id, 'x')).rejects.toBeInstanceOf(
        PostGoneError,
      );
      await expect(g.sendFiles(id, 'x', [])).rejects.toBeInstanceOf(
        PostGoneError,
      );
      const t = threads.get(id);
      expect(t?.setArchived).not.toHaveBeenCalled();
      expect(t?.setLocked).not.toHaveBeenCalled();
      expect(t?.send).not.toHaveBeenCalled();
    },
  );
});

describe('eventWhenText', () => {
  const at = (iso: string) => new Date(`${iso}Z`);
  const e = (o: object) =>
    ({
      startsAt: at('2026-10-20T10:00:00'),
      endsAt: null,
      allDay: false,
      ...o,
    }) as unknown as EventDetails;
  it('formats en-GB wall-clock dates', () => {
    expect(eventWhenText(e({}))).toBe('Tue 20 Oct 2026, 10:00');
    expect(eventWhenText(e({ endsAt: at('2026-10-20T11:30:00') }))).toBe(
      'Tue 20 Oct 2026, 10:00–11:30',
    );
    expect(eventWhenText(e({ endsAt: at('2026-10-21T09:00:00') }))).toBe(
      'Tue 20 Oct 2026, 10:00 – Wed 21 Oct 2026, 09:00',
    );
    expect(eventWhenText(e({ allDay: true }))).toBe('Tue 20 Oct 2026, all day');
  });
});
