import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Db, jobs, materials, subjects, topics } from '@studies/db';
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
import { type AttachmentInput, ingestAttachment } from '../src/ingest.js';

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

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
