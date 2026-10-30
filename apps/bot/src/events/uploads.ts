// Files uploaded on the website (`web_uploads`): the web writes them to
// STORAGE_DIR/uploads/<uuid> and queues one `event_upload` bot request per
// batch. Here they are sent to the event's Discord post (ingestion then picks
// them up as materials), the rows are marked done and the temp files removed.
// A failure stores a SAFE Polish message on the rows (never a path or a stack
// trace) and keeps the temp file for a retry until it is a day old.
import { readdir, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  type Db,
  type EventDetails,
  getEvent,
  getUploadsByIds,
  openInStorage,
  resolveInStorage,
  topics,
  users,
  webUploads,
} from '@studies/db';
import { DiscordAPIError } from 'discord.js';
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { type IngestResult, ingestAttachment } from '../ingest.js';
import { escapeUserText } from '../markdown.js';

/** Discord allows at most 10 attachments per message. */
export const MAX_FILES_PER_MESSAGE = 10;
export const UPLOAD_MAX_AGE_MS = 24 * 3_600_000;
export const CLEANUP_INTERVAL_MS = 10 * 60_000;

/** Total bytes per message: Discord's 10 MiB with room for the overhead. */
export const MESSAGE_BYTES = 10 * 1024 * 1024 - 64 * 1024;

export const TOO_BIG = 'The files are too big for the Discord server.';
export const NOT_INGESTED =
  'The file was posted on Discord but could not be added to the materials.';
export const SEND_FAILED = 'Could not send the file to Discord.';
export const EVENT_DELETED = 'The event was deleted.';
export const FILE_MISSING = 'The file does not exist on the server.';
export const INTERRUPTED = 'Interrupted: the bot was restarted.';

/** A failure whose message is safe to show on the event page. */
export class UploadError extends Error {}

/**
 * A file to send: its content streams from a handle opened by openInStorage
 * (never re-opened by path, so a symlink swapped in later is not followed).
 */
export type UploadFile = { name: string; data: Readable };

/** An attachment of the message the bot sent (same order as the files). */
export type SentFile = {
  id: string;
  messageId: string;
  url: string;
  name: string;
  contentType: string | null;
  size: number;
  postedAt: Date;
};

/** The one Discord operation uploads need. */
export interface UploadSink {
  /** Sends `files` with `content` into the post; throws on any error. */
  sendFiles(
    threadId: string,
    content: string,
    files: UploadFile[],
  ): Promise<SentFile[]>;
}

/**
 * `uploads/<name>` inside the storage root, nothing else: the rows are not
 * trusted (the admin SQL console can write them). Throws otherwise.
 */
export function uploadAbs(storageDir: string, rel: string): string {
  if (!/^uploads\/[^/\\]+$/.test(rel) || rel.endsWith('..')) {
    throw new UploadError(FILE_MISSING);
  }
  return resolveInStorage(storageDir, rel);
}

/**
 * Opens the temp file of an upload row for reading: `uploads/<name>` only,
 * a regular file really inside storage (no symlink, also not through a
 * symlinked uploads/). Throws UploadError(FILE_MISSING) otherwise.
 */
export async function openUpload(storageDir: string, rel: string) {
  uploadAbs(storageDir, rel);
  try {
    return await openInStorage(storageDir, rel);
  } catch {
    throw new UploadError(FILE_MISSING);
  }
}

/** Size of the temp file of an upload row (opened safely, then closed). */
async function uploadSize(storageDir: string, rel: string): Promise<number> {
  const { handle, size } = await openUpload(storageDir, rel);
  await handle.close();
  return size;
}

/** Greedy packing: at most `maxFiles` files and `maxBytes` bytes per group. */
export function packFiles<T extends { size: number }>(
  files: T[],
  maxBytes = MESSAGE_BYTES,
  maxFiles = MAX_FILES_PER_MESSAGE,
): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const f of files) {
    if (
      cur.length > 0 &&
      (cur.length >= maxFiles || bytes + f.size > maxBytes)
    ) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(f);
    bytes += f.size;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

const isTooBig = (err: unknown) =>
  err instanceof DiscordAPIError && (err.status === 413 || err.code === 40005);

export type UploadDeps = {
  db: Db;
  storageDir: string;
  guild: UploadSink;
  /** The event's post (created first when missing) and its topic. */
  ensureThread(e: EventDetails): Promise<{ threadId: string; topicId: number }>;
};

const remove = (path: string) => unlink(path).catch(() => {});

async function setRows(
  db: Db,
  ids: number[],
  status: 'posting' | 'done' | 'failed',
  error: string | null = null,
) {
  if (ids.length === 0) return;
  await db
    .update(webUploads)
    .set({
      status,
      error,
      finishedAt: status === 'posting' ? null : sql`NOW()`,
    })
    .where(inArray(webUploads.id, ids));
}

/** Removes the temp file of an upload row; a bad path is ignored. */
const removeRow = (storageDir: string, rel: string) => {
  try {
    return remove(uploadAbs(storageDir, rel));
  } catch {
    return Promise.resolve();
  }
};

type Ready = {
  id: number;
  userId: number;
  rel: string;
  name: string;
  size: number;
  /** Set when an earlier attempt already sent the file to Discord. */
  sent?: SentFile;
};

type Uploader = {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
};

async function uploaderOf(db: Db, userId: number) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const uploader: Uploader = {
    discordUserId: u?.discordUserId ?? '',
    displayName: u?.displayName ?? '',
    avatarUrl: u?.avatarUrl ?? null,
  };
  const content = `File from ${escapeUserText(u?.displayName ?? 'a user')} (via the website)`;
  return { uploader, content };
}

/**
 * Runs ingest from the local file with the Discord ids of the sent file (the
 * bot's own messages are not ingested by the gateway handlers). True when the
 * file is a material now (or already was).
 */
async function ingestSent(
  db: Db,
  storageDir: string,
  rel: string,
  name: string,
  a: SentFile,
  post: { threadId: string; topicId: number },
  uploader: Uploader,
): Promise<boolean> {
  const res: IngestResult = await ingestAttachment(
    {
      db,
      storageDir,
      fetchBody: async () => {
        const { handle } = await openUpload(storageDir, rel);
        return Readable.toWeb(
          handle.createReadStream(),
        ) as ReadableStream<Uint8Array>;
      },
    },
    {
      attachmentId: a.id,
      messageId: a.messageId,
      url: a.url,
      filename: name,
      contentType: a.contentType,
      size: a.size,
      postedAt: a.postedAt,
      uploader,
      thread: {
        threadId: post.threadId,
        forumChannelId: '',
        title: '',
        ownerDiscordId: null,
        tagIds: [],
      },
      threadOwner: null,
      topicId: post.topicId,
    },
  );
  return res !== 'failed' && res !== 'ignored' && res !== 'skipped';
}

/**
 * Posts the queued rows `ids`. Returns the first failure message (the rows
 * carry their own), or null when everything was sent.
 */
export async function postEventUploads(
  deps: UploadDeps,
  eventId: number,
  ids: number[],
): Promise<string | null> {
  const { db, storageDir, guild } = deps;
  const rows = (await getUploadsByIds(db, ids)).filter(
    (r) => r.eventId === eventId && r.status === 'queued',
  );
  if (rows.length === 0) return null;
  const rowIds = rows.map((r) => r.id);

  const e = await getEvent(db, eventId);
  if (!e || e.deletedAt) {
    await setRows(db, rowIds, 'failed', EVENT_DELETED);
    for (const r of rows) await removeRow(storageDir, r.storagePath);
    return EVENT_DELETED;
  }

  await setRows(db, rowIds, 'posting');
  let firstError: string | null = null;
  const fail = async (ids: number[], msg: string) => {
    await setRows(db, ids, 'failed', msg);
    firstError ??= msg;
  };

  const ready: Ready[] = [];
  for (const r of rows) {
    try {
      // A symlink, a symlinked uploads/ or a non-regular file is refused.
      const size = await uploadSize(storageDir, r.storagePath);
      ready.push({
        id: r.id,
        userId: r.userId,
        rel: r.storagePath,
        name: r.originalFilename,
        size,
        sent: r.sentAttachmentId
          ? {
              id: r.sentAttachmentId,
              messageId: r.sentMessageId ?? '',
              url: r.sentUrl ?? '',
              name: r.originalFilename,
              contentType: r.sentContentType,
              size,
              postedAt: r.sentAt ?? new Date(),
            }
          : undefined,
      });
    } catch {
      await fail([r.id], FILE_MISSING);
    }
  }
  if (ready.length === 0) return firstError;

  let post: { threadId: string; topicId: number };
  try {
    post = await deps.ensureThread(e);
  } catch (err) {
    console.error(`event ${eventId}: no post for uploads:`, err);
    await fail(
      ready.map((x) => x.id),
      err instanceof UploadError ? err.message : SEND_FAILED,
    );
    return firstError;
  }

  const byUser = new Map<number, Ready[]>();
  for (const f of ready) {
    byUser.set(f.userId, [...(byUser.get(f.userId) ?? []), f]);
  }
  for (const [userId, files] of byUser) {
    const { uploader, content } = await uploaderOf(db, userId);
    const ingestOne = async (x: Ready, a: SentFile) => {
      if (await ingestSent(db, storageDir, x.rel, x.name, a, post, uploader)) {
        await setRows(db, [x.id], 'done');
        await removeRow(storageDir, x.rel);
      } else {
        await fail([x.id], NOT_INGESTED);
      }
    };
    // Already on Discord (an earlier attempt failed in ingest): never resend.
    for (const x of files.filter((f) => f.sent)) {
      await ingestOne(x, x.sent as SentFile);
    }
    for (const packed of packFiles(files.filter((f) => !f.sent))) {
      // Opened again right before the send (the file may have changed since
      // the check above); the content goes to Discord from these handles.
      const chunk: Ready[] = [];
      const streams: Readable[] = [];
      for (const x of packed) {
        try {
          const { handle } = await openUpload(storageDir, x.rel);
          streams.push(handle.createReadStream());
          chunk.push(x);
        } catch {
          await fail([x.id], FILE_MISSING);
        }
      }
      if (chunk.length === 0) continue;
      const chunkIds = chunk.map((x) => x.id);
      let sent: SentFile[];
      try {
        sent = await guild.sendFiles(
          post.threadId,
          content,
          chunk.map((x, i) => ({ name: x.name, data: streams[i] })),
        );
      } catch (err) {
        console.error(`event ${eventId}: cannot send files:`, err);
        await fail(chunkIds, isTooBig(err) ? TOO_BIG : SEND_FAILED);
        continue;
      } finally {
        // Closes every handle, also of a stream the send never read.
        for (const st of streams) st.destroy();
      }
      // Remember the Discord ids first: a crash or an ingest failure must not
      // make a retry post the file again.
      for (const [i, x] of chunk.entries()) {
        const a = sent[i];
        if (!a) {
          await fail([x.id], NOT_INGESTED);
          continue;
        }
        x.sent = a;
        await db
          .update(webUploads)
          .set({
            sentMessageId: a.messageId,
            sentAttachmentId: a.id,
            sentUrl: a.url.slice(0, 1000),
            sentContentType: a.contentType,
            sentAt: a.postedAt,
          })
          .where(eq(webUploads.id, x.id));
      }
      // The bot's own messages are not ingested by the gateway handlers, so
      // the sent attachments become materials here.
      for (const x of chunk) if (x.sent) await ingestOne(x, x.sent);
    }
  }
  return firstError;
}

/**
 * After an unexpected error in a request: its rows still `queued` or
 * `posting` will not finish; fail them (a safe message) so a retry can take
 * them. A row with Discord ids was sent, so its retry only re-runs ingest.
 */
export async function failUnfinishedUploads(
  db: Db,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  const open = await db
    .select({ id: webUploads.id, sent: webUploads.sentAttachmentId })
    .from(webUploads)
    .where(
      and(
        inArray(webUploads.id, ids),
        inArray(webUploads.status, ['queued', 'posting']),
      ),
    );
  await setRows(
    db,
    open.filter((r) => r.sent).map((r) => r.id),
    'failed',
    NOT_INGESTED,
  );
  await setRows(
    db,
    open.filter((r) => !r.sent).map((r) => r.id),
    'failed',
    SEND_FAILED,
  );
}

/**
 * At boot: rows left `posting` by a crash will not finish; fail them. A row
 * that already has its Discord ids was sent, so a retry only re-runs ingest.
 */
export async function failInterruptedUploads(db: Db): Promise<void> {
  const posting = await db
    .select({ id: webUploads.id, sent: webUploads.sentAttachmentId })
    .from(webUploads)
    .where(eq(webUploads.status, 'posting'));
  await setRows(
    db,
    posting.filter((r) => r.sent).map((r) => r.id),
    'failed',
    NOT_INGESTED,
  );
  await setRows(
    db,
    posting.filter((r) => !r.sent).map((r) => r.id),
    'failed',
    INTERRUPTED,
  );
}

/**
 * Failed rows that are already on Discord (sent, but ingest failed): runs
 * ingest again from the local file with the stored ids, into the post of the
 * event (or its series). The file is removed only after a success; until then
 * the row and the file stay, however old.
 */
async function reingestSent(db: Db, storageDir: string): Promise<void> {
  const sent = await db
    .select()
    .from(webUploads)
    .where(
      and(
        eq(webUploads.status, 'failed'),
        isNotNull(webUploads.sentAttachmentId),
      ),
    )
    .orderBy(webUploads.id);
  for (const r of sent) {
    try {
      let size: number;
      try {
        size = await uploadSize(storageDir, r.storagePath);
      } catch {
        continue;
      }
      const e = await getEvent(db, r.eventId);
      const topicId = e ? (e.series ? e.series.topicId : e.topicId) : null;
      if (topicId === null) continue;
      const [t] = await db.select().from(topics).where(eq(topics.id, topicId));
      if (!t) continue;
      const { uploader } = await uploaderOf(db, r.userId);
      const ok = await ingestSent(
        db,
        storageDir,
        r.storagePath,
        r.originalFilename,
        {
          id: r.sentAttachmentId as string,
          messageId: r.sentMessageId ?? '',
          url: r.sentUrl ?? '',
          name: r.originalFilename,
          contentType: r.sentContentType,
          size,
          postedAt: r.sentAt ?? new Date(),
        },
        { threadId: t.discordThreadId, topicId: t.id },
        uploader,
      );
      if (!ok) continue;
      await setRows(db, [r.id], 'done');
      await removeRow(storageDir, r.storagePath);
    } catch (err) {
      console.error(`upload ${r.id}: re-ingest failed:`, err);
    }
  }
}

/**
 * Removes queued/failed uploads (rows and files) older than 24 h, except rows
 * already sent to Discord, and files
 * in STORAGE_DIR/uploads/ with no row and an mtime older than 24 h (crash
 * leftovers). Nothing outside uploads/ is touched.
 */
export async function cleanupUploads(
  db: Db,
  storageDir: string,
  now: Date = new Date(),
): Promise<{ rows: number; orphans: number }> {
  const cutoff = new Date(now.getTime() - UPLOAD_MAX_AGE_MS);
  await reingestSent(db, storageDir);
  // Rows already sent to Discord are never purged (see reingestSent).
  const old = await db
    .select({ id: webUploads.id, path: webUploads.storagePath })
    .from(webUploads)
    .where(
      and(
        inArray(webUploads.status, ['queued', 'failed']),
        lt(webUploads.createdAt, cutoff),
        isNull(webUploads.sentAttachmentId),
      ),
    );
  for (const r of old) {
    // A path outside uploads/: drop the row, never touch the file.
    await removeRow(storageDir, r.path);
  }
  if (old.length > 0) {
    await db.delete(webUploads).where(
      inArray(
        webUploads.id,
        old.map((r) => r.id),
      ),
    );
  }

  let orphans = 0;
  const dir = resolveInStorage(storageDir, 'uploads');
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return { rows: old.length, orphans };
  }
  if (names.length > 0) {
    const known = new Set(
      (await db.select({ p: webUploads.storagePath }).from(webUploads)).map(
        (r) => r.p,
      ),
    );
    for (const name of names) {
      if (known.has(`uploads/${name}`)) continue;
      try {
        const path = resolveInStorage(dir, name);
        const s = await stat(path);
        if (!s.isFile() || s.mtime >= cutoff) continue;
        await unlink(path);
        orphans++;
      } catch {
        // vanished or unreadable: the next run tries again
      }
    }
  }
  return { rows: old.length, orphans };
}
