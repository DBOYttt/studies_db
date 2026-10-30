import { mkdtempSync } from 'node:fs';
import {
  mkdir,
  readdir,
  rename,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addEvent,
  adminAudit,
  botRequests,
  botSettings,
  type Db,
  deleteEvent,
  enqueueBotRequest,
  eventMaterials,
  eventSeries,
  events,
  eventTopics,
  materials,
  subjects,
  topics,
  users,
  webUploads,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { DiscordAPIError } from 'discord.js';
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
import type { EventPostFields } from '../src/events/posts.js';
import { cleanupUploads, type UploadFile } from '../src/events/uploads.js';
import {
  drainEventRequests,
  recoverInterruptedRequests,
} from '../src/events/worker.js';
import * as ingestMod from '../src/ingest.js';

function fakeGuild() {
  const g = {
    posts: new Map<string, EventPostFields>(),
    sent: [] as { threadId: string; content: string; names: string[] }[],
    failSend: null as Error | null,
    aid: 0,
    n: 0,
    async createPost(_f: string, post: EventPostFields) {
      const id = `th-${++g.n}`;
      g.posts.set(id, post);
      return id;
    },
    async editFirstMessage() {},
    async archivePost() {},
    async postExists(id: string) {
      return g.posts.has(id);
    },
    async sendFiles(threadId: string, content: string, files: UploadFile[]) {
      if (g.failSend) throw g.failSend;
      g.sent.push({ threadId, content, names: files.map((f) => f.name) });
      const mid = `m-${g.sent.length}`;
      return files.map((f) => ({
        id: `a-${++g.aid}`,
        messageId: mid,
        url: `https://cdn/${f.name}`,
        name: f.name,
        contentType: null,
        size: 4,
        postedAt: new Date(),
      }));
    },
  };
  return g;
}

let db: Db;
let userId: number;
let bdId: number;
let dir: string;
let guild: ReturnType<typeof fakeGuild>;
const log = vi.fn();
const drain = () =>
  drainEventRequests(
    { db, guild, webBaseUrl: 'https://x.pl', storageDir: dir },
    log,
  );

beforeAll(async () => {
  db = await resetTestDb();
  [{ id: userId }] = await db
    .insert(users)
    .values({ discordUserId: 'u1', displayName: 'Ala *x*' })
    .$returningId();
  [{ id: bdId }] = await db
    .insert(subjects)
    .values({
      code: 'BD',
      name: 'Bazy',
      semester: 1,
      ects: 5,
      discordChannelId: 'f-bd',
    })
    .$returningId();
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  guild = fakeGuild();
  log.mockClear();
  dir = mkdtempSync(join(tmpdir(), 'uploads-'));
  await mkdir(join(dir, 'uploads'));
  await db.delete(adminAudit);
  await db.delete(materials);
  await db.delete(webUploads);
  await db.delete(botRequests);
  await db.delete(eventTopics);
  await db.delete(events);
  await db.delete(eventSeries);
  await db.delete(topics);
  await db.delete(botSettings);
});

const mkEvent = async () => {
  const d = new Date(Date.now() + 10 * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const r = await addEvent(
    db,
    userId,
    {
      kind: 'kolokwium',
      title: 'Kol',
      subjectId: bdId,
      when: `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} 10:00-11:30`,
    },
    'web',
  );
  expect(r.ok).toBe(true);
  const all = await db.select().from(events);
  await db.delete(botRequests); // drop the post request: tests queue their own
  return all[all.length - 1].id;
};

async function queueUploads(eventId: number, names: string[]) {
  const ids: number[] = [];
  for (const [i, name] of names.entries()) {
    const rel = `uploads/f-${eventId}-${i}-${Math.random().toString(36).slice(2)}`;
    await writeFile(join(dir, rel), 'data');
    const [{ id }] = await db
      .insert(webUploads)
      .values({
        eventId,
        userId,
        storagePath: rel,
        originalFilename: name,
        sizeBytes: 4,
      })
      .$returningId();
    ids.push(id);
  }
  await enqueueBotRequest(db, 'event_upload', `upload:${ids[0]}`, {
    eventId,
    uploadIds: ids,
  });
  return ids;
}
const rows = () => db.select().from(webUploads).orderBy(webUploads.id);

describe('event uploads', () => {
  it('posts queued files with the display name, marks them done, removes the temp files', async () => {
    const id = await mkEvent();
    await drain(); // creates the post
    const ids = await queueUploads(id, ['a.pdf', 'b.png']);
    await drain();
    expect(guild.sent).toHaveLength(1);
    expect(guild.sent[0].content).toBe(
      'File from Ala \\*x\\* (via the website)',
    );
    expect(guild.sent[0].names).toEqual(['a.pdf', 'b.png']);
    const r = await rows();
    expect(r.map((x) => x.status)).toEqual(['done', 'done']);
    expect(r.every((x) => x.finishedAt)).toBe(true);
    expect(await readdir(join(dir, 'uploads'))).toEqual([]);
    const [req] = await db.select().from(botRequests);
    expect(req.status).toBe('done');
    expect(ids).toHaveLength(2);
  });

  it('ingests the sent attachments as materials of the event post, by the uploader', async () => {
    const id = await mkEvent();
    await drain();
    await queueUploads(id, ['a.pdf', 'b.png']);
    await drain();
    const [e] = await db.select().from(events).where(eq(events.id, id));
    const mats = await db.select().from(materials).orderBy(materials.id);
    expect(mats.map((m) => m.originalFilename)).toEqual(['a.pdf', 'b.png']);
    expect(mats.every((m) => m.topicId === e.topicId)).toBe(true);
    expect(mats.every((m) => m.uploaderId === userId)).toBe(true);
    expect(mats.map((m) => m.discordAttachmentId)).toEqual(['a-1', 'a-2']);
    expect(
      (await eventMaterials(db, id)).map((m) => m.filename).sort(),
    ).toEqual(['a.pdf', 'b.png']);
  });

  it('a row pointing outside uploads/ is neither sent nor deleted', async () => {
    const id = await mkEvent();
    await drain();
    await mkdir(join(dir, 'materials'));
    await writeFile(join(dir, 'materials/x.pdf'), 'keep');
    const [{ id: rowId }] = await db
      .insert(webUploads)
      .values({
        eventId: id,
        userId,
        storagePath: 'materials/x.pdf',
        originalFilename: 'x.pdf',
        sizeBytes: 4,
      })
      .$returningId();
    await enqueueBotRequest(db, 'event_upload', `upload:${rowId}`, {
      eventId: id,
      uploadIds: [rowId],
    });
    await drain();
    const [r] = await rows();
    expect(r).toMatchObject({
      status: 'failed',
      error: 'The file does not exist on the server.',
    });
    expect(guild.sent).toEqual([]);
    expect(await readdir(join(dir, 'materials'))).toEqual(['x.pdf']);
    await cleanupUploads(db, dir, new Date(Date.now() + 48 * 3_600_000));
    expect(await readdir(join(dir, 'materials'))).toEqual(['x.pdf']);
  });

  it('packs files by bytes: 5 x 8 MB make 5 messages', async () => {
    const id = await mkEvent();
    await drain();
    const ids = await queueUploads(id, ['1', '2', '3', '4', '5']);
    for (const r of await rows()) {
      await writeFile(join(dir, r.storagePath), Buffer.alloc(8 * 1024 * 1024));
    }
    await drain();
    expect(guild.sent.map((s) => s.names.length)).toEqual([1, 1, 1, 1, 1]);
    expect((await rows()).every((r) => r.status === 'done')).toBe(true);
    expect(ids).toHaveLength(5);
  });

  it('maps a Discord 413 to a clear message', async () => {
    const id = await mkEvent();
    await drain();
    guild.failSend = new DiscordAPIError(
      { code: 40005, message: 'Request entity too large' },
      40005,
      413,
      'POST',
      'x',
      {},
    );
    await queueUploads(id, ['a.pdf']);
    await drain();
    const [r] = await rows();
    expect(r.error).toBe('The files are too big for the Discord server.');
  });

  it('a retried failed row is picked up again', async () => {
    const id = await mkEvent();
    await drain();
    guild.failSend = new Error('boom');
    const [rowId] = await queueUploads(id, ['a.pdf']);
    await drain();
    expect((await rows())[0].status).toBe('failed');
    guild.failSend = null;
    await db
      .update(webUploads)
      .set({ status: 'queued', error: null, finishedAt: null })
      .where(eq(webUploads.id, rowId));
    await enqueueBotRequest(db, 'event_upload', `upload:${rowId}`, {
      eventId: id,
      uploadIds: [rowId],
    });
    await drain();
    expect((await rows())[0].status).toBe('done');
    expect(guild.sent).toHaveLength(1);
  });

  it('ingest fails once, retry: one Discord send and one material', async () => {
    const id = await mkEvent();
    await drain();
    const [rowId] = await queueUploads(id, ['a.pdf']);
    const spy = vi
      .spyOn(ingestMod, 'ingestAttachment')
      .mockResolvedValueOnce('failed');
    await drain();
    spy.mockRestore();
    const [failed] = await rows();
    expect(failed).toMatchObject({
      status: 'failed',
      error:
        'The file was posted on Discord but could not be added to the materials.',
      sentAttachmentId: 'a-1',
    });
    expect(await db.select().from(materials)).toHaveLength(0);
    await db
      .update(webUploads)
      .set({ status: 'queued', error: null })
      .where(eq(webUploads.id, rowId));
    await enqueueBotRequest(db, 'event_upload', `upload:${rowId}`, {
      eventId: id,
      uploadIds: [rowId],
    });
    await drain();
    expect(guild.sent).toHaveLength(1);
    const mats = await db.select().from(materials);
    expect(mats).toHaveLength(1);
    expect(mats[0].discordAttachmentId).toBe('a-1');
    expect((await rows())[0].status).toBe('done');
  });

  it('crash after the send: recovery + retry does not send again', async () => {
    const id = await mkEvent();
    await drain();
    const [rowId] = await queueUploads(id, ['a.pdf']);
    await db
      .update(webUploads)
      .set({
        status: 'posting',
        sentMessageId: 'm-9',
        sentAttachmentId: 'a-9',
        sentUrl: 'https://cdn/a.pdf',
      })
      .where(eq(webUploads.id, rowId));
    await db.delete(botRequests);
    await recoverInterruptedRequests(db);
    expect((await rows())[0].status).toBe('failed');
    await db
      .update(webUploads)
      .set({ status: 'queued', error: null })
      .where(eq(webUploads.id, rowId));
    await enqueueBotRequest(db, 'event_upload', `upload:${rowId}`, {
      eventId: id,
      uploadIds: [rowId],
    });
    await drain();
    expect(guild.sent).toEqual([]);
    const mats = await db.select().from(materials);
    expect(mats.map((m) => m.discordAttachmentId)).toEqual(['a-9']);
    expect((await rows())[0].status).toBe('done');
  });

  it('an unexpected error leaves no row queued or posting: all retryable', async () => {
    const id = await mkEvent();
    await drain();
    await queueUploads(
      id,
      Array.from({ length: 12 }, (_, i) => `f${i}.txt`),
    );
    const spy = vi
      .spyOn(ingestMod, 'ingestAttachment')
      .mockRejectedValueOnce(new Error('db down'));
    await drain();
    spy.mockRestore();
    const all = await rows();
    expect(all.filter((r) => r.status === 'failed')).toHaveLength(12);
    expect(all.filter((r) => r.sentAttachmentId).map((r) => r.error)).toEqual(
      Array(10).fill(
        'The file was posted on Discord but could not be added to the materials.',
      ),
    );
    expect(all.filter((r) => !r.sentAttachmentId).map((r) => r.error)).toEqual(
      Array(2).fill('Could not send the file to Discord.'),
    );
  });

  it('splits more than 10 files into several messages', async () => {
    const id = await mkEvent();
    await drain();
    await queueUploads(
      id,
      Array.from({ length: 12 }, (_, i) => `f${i}.txt`),
    );
    await drain();
    expect(guild.sent.map((s) => s.names.length)).toEqual([10, 2]);
  });

  it('creates the post first when the event has none', async () => {
    const id = await mkEvent();
    await queueUploads(id, ['a.pdf']);
    await drain();
    expect(guild.posts.size).toBe(1);
    const [e] = await db.select().from(events).where(eq(events.id, id));
    expect(e.topicId).not.toBeNull();
    expect(guild.sent[0].threadId).toBe('th-1');
    expect((await rows())[0].status).toBe('done');
  });

  it('a Discord error fails the rows with a safe message and keeps the file', async () => {
    const id = await mkEvent();
    await drain();
    guild.failSend = new Error('boom /secret/path/stack');
    await queueUploads(id, ['a.pdf']);
    await drain();
    const [r] = await rows();
    expect(r.status).toBe('failed');
    expect(r.error).toBe('Could not send the file to Discord.');
    expect(r.error).not.toContain('secret');
    expect(await readdir(join(dir, 'uploads'))).toHaveLength(1);
    const [req] = await db.select().from(botRequests);
    expect(req.status).toBe('failed');
  });

  it('a deleted event fails the rows and removes the files', async () => {
    const id = await mkEvent();
    await drain();
    await queueUploads(id, ['a.pdf']);
    const d = await deleteEvent(db, userId, id, 'web');
    expect(d.ok).toBe(true);
    await db
      .delete(botRequests)
      .where(eq(botRequests.kind, 'event_post_archive'));
    await drain();
    const [r] = await rows();
    expect(r.status).toBe('failed');
    expect(r.error).toBe('The event was deleted.');
    expect(await readdir(join(dir, 'uploads'))).toEqual([]);
    expect(guild.sent).toEqual([]);
  });

  it('a symlink in uploads/ is never sent', async () => {
    const id = await mkEvent();
    await drain();
    const [rowId] = await queueUploads(id, ['a.pdf']);
    const [r] = await rows();
    await writeFile(join(dir, 'secret'), 'secret');
    await unlink(join(dir, r.storagePath));
    await symlink(join(dir, 'secret'), join(dir, r.storagePath));
    await drain();
    const [after] = await rows();
    expect(after).toMatchObject({
      id: rowId,
      status: 'failed',
      error: 'The file does not exist on the server.',
    });
    expect(guild.sent).toEqual([]);
  });

  it('an uploads/ directory that is a symlink is never read or sent', async () => {
    const id = await mkEvent();
    await drain();
    const [rowId] = await queueUploads(id, ['a.pdf']);
    // The temp file now lives outside storage, reached via uploads -> outside.
    const outside = mkdtempSync(join(tmpdir(), 'uploads-outside-'));
    await rename(join(dir, 'uploads'), join(outside, 'real'));
    await symlink(join(outside, 'real'), join(dir, 'uploads'));
    const ingest = vi.spyOn(ingestMod, 'ingestAttachment');
    try {
      await drain();
      const [after] = await rows();
      expect(after).toMatchObject({
        id: rowId,
        status: 'failed',
        error: 'The file does not exist on the server.',
      });
      expect(guild.sent).toEqual([]);
      expect(ingest).not.toHaveBeenCalled();
    } finally {
      ingest.mockRestore();
    }
  });

  it('sends the file content from the opened file, not by path', async () => {
    const id = await mkEvent();
    await drain();
    await queueUploads(id, ['a.pdf']);
    const bodies: string[] = [];
    guild.sendFiles = async (_t, _c, files) => {
      for (const f of files) {
        const chunks: Buffer[] = [];
        for await (const c of f.data) chunks.push(Buffer.from(c));
        bodies.push(Buffer.concat(chunks).toString());
      }
      return files.map((f, i) => ({
        id: `a-x${i}`,
        messageId: 'm-x',
        url: `https://cdn/${f.name}`,
        name: f.name,
        contentType: null,
        size: 4,
        postedAt: new Date(),
      }));
    };
    await drain();
    expect(bodies).toEqual(['data']);
    const [after] = await rows();
    expect(after.status).toBe('done');
  });

  it('a missing temp file fails only that row', async () => {
    const id = await mkEvent();
    await drain();
    const ids = await queueUploads(id, ['a.pdf', 'b.pdf']);
    const [first] = await rows();
    await (await import('node:fs/promises')).unlink(
      join(dir, first.storagePath),
    );
    await drain();
    const r = await rows();
    expect(r.map((x) => x.status)).toEqual(['failed', 'done']);
    expect(r[0].error).toBe('The file does not exist on the server.');
    expect(ids).toHaveLength(2);
  });
});

describe('cleanupUploads', () => {
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000);
  it('removes queued/failed rows and files older than 24 h, and old orphans, only', async () => {
    const id = await mkEvent();
    const mk = async (
      name: string,
      status: 'queued' | 'failed' | 'done',
      h: number,
    ) => {
      const rel = `uploads/${name}`;
      await writeFile(join(dir, rel), 'x');
      await utimes(join(dir, rel), ago(h), ago(h));
      await db.insert(webUploads).values({
        eventId: id,
        userId,
        storagePath: rel,
        originalFilename: name,
        sizeBytes: 1,
        status,
      });
      await db
        .update(webUploads)
        .set({ createdAt: ago(h) })
        .where(eq(webUploads.storagePath, rel));
    };
    await mk('old-queued', 'queued', 30);
    await mk('old-failed', 'failed', 25);
    await mk('new-failed', 'failed', 2);
    await mk('old-done', 'done', 30);
    await writeFile(join(dir, 'uploads/orphan-old'), 'x');
    await utimes(join(dir, 'uploads/orphan-old'), ago(30), ago(30));
    await writeFile(join(dir, 'uploads/orphan-new'), 'x');
    await writeFile(join(dir, 'outside'), 'x');
    await utimes(join(dir, 'outside'), ago(30), ago(30));

    const res = await cleanupUploads(db, dir);
    expect(res).toEqual({ rows: 2, orphans: 1 });
    expect((await readdir(join(dir, 'uploads'))).sort()).toEqual([
      'new-failed',
      'old-done',
      'orphan-new',
    ]);
    expect(await readdir(dir)).toContain('outside');
    const left = await db
      .select({ p: webUploads.storagePath })
      .from(webUploads);
    expect(left.map((x) => x.p).sort()).toEqual([
      'uploads/new-failed',
      'uploads/old-done',
    ]);
  });

  it('never purges a sent row: re-runs ingest, removes the file only after success', async () => {
    const id = await mkEvent();
    await drain();
    const [rowId] = await queueUploads(id, ['a.pdf']);
    const spy = vi
      .spyOn(ingestMod, 'ingestAttachment')
      .mockResolvedValue('failed');
    await drain();
    await db
      .update(webUploads)
      .set({ createdAt: ago(30) })
      .where(eq(webUploads.id, rowId));
    const [before] = await rows();
    expect(before).toMatchObject({ status: 'failed', sentAttachmentId: 'a-1' });

    // Ingest still failing: the row and its file stay.
    await cleanupUploads(db, dir);
    spy.mockRestore();
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0].status).toBe('failed');
    expect(await readdir(join(dir, 'uploads'))).toHaveLength(1);

    await cleanupUploads(db, dir);
    expect(guild.sent).toHaveLength(1);
    const mats = await db.select().from(materials);
    expect(mats.map((m) => m.discordAttachmentId)).toEqual(['a-1']);
    expect((await rows())[0].status).toBe('done');
    expect(await readdir(join(dir, 'uploads'))).toEqual([]);
  });
});
