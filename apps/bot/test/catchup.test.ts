import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { botState, type Db, materials, subjects, topics } from '@studies/db';
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
import { catchUp, type ForumSource } from '../src/catchup.js';
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
