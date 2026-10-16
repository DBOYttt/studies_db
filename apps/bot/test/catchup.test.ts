import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  botSettings,
  botState,
  type Db,
  materials,
  setSetting,
  subjects,
  topics,
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
import { catchUp, type ForumSource, fetchAllPages } from '../src/catchup.js';
import type { AttachmentInput } from '../src/ingest.js';
import type { ThreadInfo } from '../src/types.js';

const fixture = await readFile(
  fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url)),
);
const user = { discordUserId: 'u1', displayName: 'Ann', avatarUrl: null };

let db: Db;
let dir: string;

beforeAll(async () => {
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'catchup-'));
  await db.delete(materials);
  await db.delete(topics);
  await db.delete(botState);
  await db.delete(subjects);
  await db.insert(subjects).values([
    { name: 'A', code: 'A', semester: 1, ects: 5, discordChannelId: 'f1' },
    { name: 'B', code: 'B', semester: 1, ects: 5, discordChannelId: 'f2' },
  ]);
});

const fetchBody = () =>
  Promise.resolve(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(fixture);
        c.close();
      },
    }),
  );
const mkDeps = () => ({ db, storageDir: dir, fetchBody });

const thread = (id: string, forum: string): ThreadInfo => ({
  threadId: id,
  forumChannelId: forum,
  title: `T${id}`,
  ownerDiscordId: null,
  tagIds: [],
});
const att = (id: string, t: ThreadInfo): AttachmentInput => ({
  attachmentId: id,
  messageId: `m${id}`,
  url: `https://cdn/${id}`,
  filename: `${id}.pdf`,
  contentType: 'application/pdf',
  size: fixture.length,
  postedAt: new Date(),
  uploader: user,
  thread: t,
  threadOwner: null,
});

function makeSource(opts: { failForum?: string } = {}) {
  const t1 = thread('t1', 'f1');
  const t2 = thread('t2', 'f2');
  const listMessages = vi.fn(async function* (
    threadId: string,
    _after: Date | null,
  ) {
    const t = threadId === 't1' ? t1 : t2;
    yield {
      messageId: `m-${threadId}`,
      attachments: [att(`a-${threadId}`, t)],
    };
  });
  const source: ForumSource = {
    listTags: async () => [],
    listThreads: async (forum) => {
      if (forum === opts.failForum) throw new Error('no access');
      return forum === 'f1' ? [t1] : [t2];
    },
    listMessages,
  };
  return { source, listMessages };
}

const now = new Date('2026-01-01T12:00:00Z');

describe('catchUp', () => {
  it('first run ingests everything and sets watermark now-5min', async () => {
    const { source, listMessages } = makeSource();
    const r = await catchUp(mkDeps(), source, { ignoreWatermark: false, now });
    expect(r).toEqual({ topics: 2, created: 2, failed: 0 });
    expect(listMessages).toHaveBeenCalledWith('t1', null);
    const states = await db.select().from(botState);
    expect(states).toHaveLength(2);
    for (const s of states)
      expect(s.lastSyncedAt?.getTime()).toBe(now.getTime() - 5 * 60_000);
  });

  it('second run passes watermark as after and creates no duplicates', async () => {
    const { source, listMessages } = makeSource();
    await catchUp(mkDeps(), source, { ignoreWatermark: false, now });
    listMessages.mockClear();
    await catchUp(mkDeps(), source, { ignoreWatermark: false, now });
    const expected = new Date(now.getTime() - 5 * 60_000);
    expect(listMessages.mock.calls[0][1]?.getTime()).toBe(expected.getTime());
    expect(await db.select().from(materials)).toHaveLength(2);
  });

  it('ignoreWatermark passes null', async () => {
    const { source, listMessages } = makeSource();
    await catchUp(mkDeps(), source, { ignoreWatermark: false, now });
    listMessages.mockClear();
    await catchUp(mkDeps(), source, { ignoreWatermark: true, now });
    expect(listMessages.mock.calls.every((c) => c[1] === null)).toBe(true);
  });

  it('failing subject keeps its watermark; others advance', async () => {
    const { source } = makeSource({ failForum: 'f2' });
    const r = await catchUp(mkDeps(), source, { ignoreWatermark: false, now });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const [s1] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.discordChannelId, 'f1'));
    const [s2] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.discordChannelId, 'f2'));
    expect(
      await db.select().from(botState).where(eq(botState.subjectId, s1.id)),
    ).toHaveLength(1);
    expect(
      await db.select().from(botState).where(eq(botState.subjectId, s2.id)),
    ).toHaveLength(0);
  });
});

describe('catchUp #wydarzenia', () => {
  it('ingests the events forum as subject-less topics', async () => {
    await setSetting(db, 'events_forum_id', 'fe');
    try {
      const te = thread('te', 'fe');
      const source: ForumSource = {
        listTags: async () => [],
        listThreads: async (forum) => (forum === 'fe' ? [te] : []),
        listMessages: async function* (id) {
          if (id === 'te') {
            yield { messageId: 'mte', attachments: [att('ae', te)] };
          }
        },
      };
      const r = await catchUp(mkDeps(), source, {
        ignoreWatermark: false,
        now,
      });
      expect(r).toEqual({ topics: 1, created: 1, failed: 0 });
      const [t] = await db
        .select()
        .from(topics)
        .where(eq(topics.discordThreadId, 'te'));
      expect(t.subjectId).toBeNull();
      expect(await db.select().from(materials)).toHaveLength(1);
    } finally {
      await db.delete(botSettings);
    }
  });
});

describe('catchUp thread isolation', () => {
  it('a failing thread does not block the rest of the subject', async () => {
    const tA = thread('tA', 'f1');
    const tB = thread('tB', 'f1');
    const source: ForumSource = {
      listTags: async () => [],
      listThreads: async (f) => (f === 'f1' ? [tA, tB] : []),
      listMessages: async function* (id) {
        if (id === 'tA') throw new Error('boom');
        yield { messageId: 'mB', attachments: [att('aB', tB)] };
      },
    };
    const r = await catchUp(mkDeps(), source, { ignoreWatermark: false, now });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(r.created).toBe(1);
    expect(await db.select().from(materials)).toHaveLength(1);
    const [s1] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.discordChannelId, 'f1'));
    expect(
      await db.select().from(botState).where(eq(botState.subjectId, s1.id)),
    ).toHaveLength(0);
  });
});

describe('fetchAllPages', () => {
  it('collects all pages while hasMore', async () => {
    const pages = [
      { items: [1, 2], hasMore: true, cursor: 30 },
      { items: [3], hasMore: true, cursor: 20 },
      { items: [4], hasMore: false, cursor: 10 },
    ];
    const seen: (number | undefined)[] = [];
    let i = 0;
    const out = await fetchAllPages(async (b) => {
      seen.push(b);
      return pages[i++];
    });
    expect(out).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual([undefined, 30, 20]);
  });

  it('stops when the cursor does not advance', async () => {
    let calls = 0;
    const out = await fetchAllPages(async () => {
      calls++;
      return { items: [calls], hasMore: true, cursor: 5 };
    });
    expect(calls).toBe(2);
    expect(out).toEqual([1, 2]);
  });
});
