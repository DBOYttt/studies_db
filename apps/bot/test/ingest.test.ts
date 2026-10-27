import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Db,
  jobs,
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
import {
  type AttachmentInput,
  DEFAULT_INGEST_LIMITS,
  ingestAttachment,
  UserByteQuota,
} from '../src/ingest.js';

const fixture = await readFile(
  fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url)),
);
const sha = createHash('sha256').update(fixture).digest('hex');
const user = { discordUserId: 'u1', displayName: 'Ann', avatarUrl: null };

let db: Db;
let dir: string;

beforeAll(async () => {
  db = await resetTestDb();
  await db.insert(subjects).values({
    name: 'Algebra',
    code: 'ALG',
    semester: 1,
    ects: 5,
    discordChannelId: 'forum1',
  });
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ingest-'));
  await db.delete(jobs);
  await db.delete(materials);
  await db.delete(topics);
});

const streamOf = (bytes: Uint8Array) => () =>
  Promise.resolve(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    }),
  );

const input = (over: Partial<AttachmentInput> = {}): AttachmentInput => ({
  attachmentId: 'a1',
  messageId: 'm1',
  url: 'https://cdn/x',
  filename: 'notes.pdf',
  contentType: 'application/pdf',
  size: fixture.length,
  postedAt: new Date(),
  uploader: user,
  thread: {
    threadId: 't1',
    forumChannelId: 'forum1',
    title: 'T',
    ownerDiscordId: 'u1',
    tagIds: [],
  },
  threadOwner: user,
  ...over,
});

const deps = (fetchBody = streamOf(fixture)) => ({
  db,
  storageDir: dir,
  fetchBody,
});

describe('ingestAttachment', () => {
  it('a file in #wydarzenia becomes a material of a topic with no subject', async () => {
    await setSetting(db, 'events_forum_id', 'events-forum');
    const r = await ingestAttachment(
      deps(),
      input({
        thread: {
          threadId: 'et1',
          forumChannelId: 'events-forum',
          title: 'Kolokwium',
          ownerDiscordId: 'u1',
          tagIds: ['some-tag'],
        },
      }),
    );
    expect(r).toBe('created');
    const [t] = await db.select().from(topics);
    expect(t.subjectId).toBeNull();
    expect(t.discordThreadId).toBe('et1');
    const [m] = await db.select().from(materials);
    expect(m.topicId).toBe(t.id);
  });

  it('ignores files in a forum that is neither a subject nor #wydarzenia', async () => {
    const r = await ingestAttachment(
      deps(),
      input({
        thread: {
          threadId: 'x1',
          forumChannelId: 'other-forum',
          title: 'T',
          ownerDiscordId: 'u1',
          tagIds: [],
        },
      }),
    );
    expect(r).toBe('ignored');
  });

  it('sets topics.created_by from threadOwner (starter message)', async () => {
    expect(await ingestAttachment(deps(), input())).toBe('created');
    const [t] = await db.select().from(topics);
    expect(t?.createdBy).not.toBeNull();
  });

  it('stores file by hash and creates material + jobs', async () => {
    expect(await ingestAttachment(deps(), input())).toBe('created');
    expect(await readFile(join(dir, 'originals', `${sha}.pdf`))).toEqual(
      fixture,
    );
    const [m] = await db.select().from(materials);
    expect(m.status).toBe('pending');
    expect(m.originalFilename).toBe('notes.pdf');
    expect(m.sha256).toBe(sha);
    expect(m.storagePath).toBe(`originals/${sha}.pdf`);
    const js = await db.select().from(jobs).where(eq(jobs.materialId, m.id));
    expect(js.map((j) => j.type)).toEqual(['extract_text']);
  });

  it('ingests when topic does not exist yet', async () => {
    expect(await ingestAttachment(deps(), input())).toBe('created');
    expect(await db.select().from(topics)).toHaveLength(1);
  });

  it('second ingest of same attachment returns exists and does not download', async () => {
    const fetchBody = vi.fn(streamOf(fixture));
    expect(await ingestAttachment(deps(fetchBody), input())).toBe('created');
    expect(await ingestAttachment(deps(fetchBody), input())).toBe('exists');
    expect(fetchBody).toHaveBeenCalledTimes(1);
  });

  it('same content new attachment returns duplicate', async () => {
    await ingestAttachment(deps(), input());
    const r = await ingestAttachment(
      deps(),
      input({ attachmentId: 'a2', messageId: 'm2' }),
    );
    expect(r).toBe('duplicate');
    expect(await db.select().from(materials)).toHaveLength(2);
    expect(await readdir(join(dir, 'originals'))).toHaveLength(1);
  });

  it('keeps polish / slash filename verbatim', async () => {
    const filename = 'Sprawozdanie ćw. 3/4.docx';
    expect(
      await ingestAttachment(
        deps(),
        input({
          filename,
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    ).toBe('created');
    const [m] = await db.select().from(materials);
    expect(m.originalFilename).toBe(filename);
    expect(m.storagePath).toBe(`originals/${sha}.docx`);
    const js = await db.select().from(jobs);
    expect(js.map((j) => j.type)).toEqual(['convert']);
  });

  it('failed download leaves nothing behind', async () => {
    const bad = () =>
      Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array([1, 2, 3]));
          },
          pull() {
            throw new Error('boom');
          },
        }),
      );
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await ingestAttachment(deps(bad), input())).toBe('failed');
    err.mockRestore();
    expect(await db.select().from(materials)).toHaveLength(0);
    expect(await readdir(join(dir, 'originals'))).toEqual([]);
    expect(await readdir(join(dir, 'tmp'))).toEqual([]);
  });

  it('unlinked forum returns ignored without downloading', async () => {
    const fetchBody = vi.fn(streamOf(fixture));
    const a = input();
    a.thread = { ...a.thread, forumChannelId: 'other' };
    expect(await ingestAttachment(deps(fetchBody), a)).toBe('ignored');
    expect(fetchBody).not.toHaveBeenCalled();
  });
});

describe('ingest limits (R3)', () => {
  const MiB = 1024 * 1024;
  it('defaults to 50 MiB per file and 500 MiB per user per hour', () => {
    expect(DEFAULT_INGEST_LIMITS.maxFileBytes).toBe(50 * MiB);
    expect(DEFAULT_INGEST_LIMITS.quota.maxBytes).toBe(500 * MiB);
    expect(DEFAULT_INGEST_LIMITS.quota.windowMs).toBe(60 * 60_000);
  });

  it('skips a file over the per-file limit without downloading it', async () => {
    const fetchBody = vi.fn(streamOf(fixture));
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await ingestAttachment(
      {
        ...deps(fetchBody),
        limits: { maxFileBytes: 100, quota: new UserByteQuota(1e9, 1000) },
      },
      input({ size: 101 }),
    );
    expect(r).toBe('skipped');
    expect(fetchBody).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    expect(await db.select().from(materials)).toHaveLength(0);
  });

  it('aborts a download that grows past the per-file limit', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await ingestAttachment(
      {
        ...deps(),
        limits: { maxFileBytes: 100, quota: new UserByteQuota(1e9, 1000) },
      },
      // Size claims 10 bytes, the body is the whole fixture.
      input({ size: 10 }),
    );
    err.mockRestore();
    expect(r).toBe('failed');
    expect(await db.select().from(materials)).toHaveLength(0);
    expect(await readdir(join(dir, 'tmp'))).toEqual([]);
    expect(await readdir(join(dir, 'originals'))).toEqual([]);
  });

  // Distinct bodies of `L` bytes, so no file is a sha duplicate of another.
  const L = fixture.length;
  let bodyN = 0;
  const uniqueBodies = () => () =>
    streamOf(new TextEncoder().encode(`body-${++bodyN}-`.padEnd(L, 'x')))();
  const base = Date.UTC(2026, 9, 1, 10);
  const files = (n: number, everyMin: number) =>
    Array.from({ length: n }, (_, k) =>
      input({
        attachmentId: `p${everyMin}-${k}`,
        messageId: `m${everyMin}-${k}`,
        filename: `f${k}.pdf`,
        postedAt: new Date(base + k * everyMin * 60_000),
      }),
    ).reverse(); // catch-up reads newest first

  it('charges files at their posted time: 12 files over 3 hours are all stored (catch-up)', async () => {
    // 5 files per hour allowed; one file every 15 min is 4 in any hour.
    const quota = new UserByteQuota(5 * L, 60 * 60_000);
    const d = {
      ...deps(uniqueBodies()),
      limits: { maxFileBytes: 1e9, quota },
    };
    const out = [];
    for (const a of files(12, 15)) out.push(await ingestAttachment(d, a));
    expect(out).toEqual(Array(12).fill('created'));
  });

  it('skips files past the quota when they were posted within one hour', async () => {
    const quota = new UserByteQuota(5 * L, 60 * 60_000);
    const d = {
      ...deps(uniqueBodies()),
      limits: { maxFileBytes: 1e9, quota },
    };
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = [];
    for (const a of files(12, 4)) out.push(await ingestAttachment(d, a));
    expect(out.filter((r) => r === 'created')).toHaveLength(5);
    expect(out.filter((r) => r === 'skipped')).toHaveLength(7);
    // Another user has their own quota.
    expect(
      await ingestAttachment(
        d,
        input({
          attachmentId: 'other-user',
          postedAt: new Date(base),
          uploader: { ...user, discordUserId: 'u2' },
        }),
      ),
    ).toBe('created');
    log.mockRestore();
  });

  it('charges only stored files, not failed downloads or sha duplicates', async () => {
    const quota = new UserByteQuota(2 * L, 60 * 60_000);
    const limits = { maxFileBytes: 1e9, quota };
    const at = new Date(base);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = () => Promise.reject(new Error('network'));
    expect(
      await ingestAttachment(
        { ...deps(failing), limits },
        input({ attachmentId: 'f1', postedAt: at }),
      ),
    ).toBe('failed');
    err.mockRestore();
    const same = new TextEncoder().encode('same-'.padEnd(L, 'y'));
    expect(
      await ingestAttachment(
        { ...deps(streamOf(same)), limits },
        input({ attachmentId: 'b1', postedAt: at }),
      ),
    ).toBe('created');
    expect(
      await ingestAttachment(
        { ...deps(streamOf(same)), limits },
        input({ attachmentId: 'b2', postedAt: at }),
      ),
    ).toBe('duplicate');
    // Only b1 counts so far: one more file still fits.
    expect(
      await ingestAttachment(
        { ...deps(uniqueBodies()), limits },
        input({ attachmentId: 'c1', postedAt: at }),
      ),
    ).toBe('created');
  });

  it('does not charge the quota for files the bot posts for web uploads', async () => {
    const quota = new UserByteQuota(1, 60_000);
    const d = { ...deps(), limits: { maxFileBytes: 1e9, quota } };
    // (the default quota would refuse this file: it is over 1 byte)
    const [t] = await db
      .insert(topics)
      .values({ discordThreadId: 'tw', title: 'W' })
      .$returningId();
    expect(await ingestAttachment(d, input({ topicId: t.id }))).toBe('created');
  });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
