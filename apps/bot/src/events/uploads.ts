// Files uploaded on the website (`web_uploads`): the web writes them to
// STORAGE_DIR/uploads/<uuid> and queues one `event_upload` bot request per
// batch. Here they are sent to the event's Discord post (ingestion then picks
// them up as materials), the rows are marked done and the temp files removed.
// A failure stores a SAFE Polish message on the rows (never a path or a stack
// trace) and keeps the temp file for a retry until it is a day old.
import { createReadStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  type Db,
  type EventDetails,
  getEvent,
  getUploadsByIds,
  resolveInStorage,
  users,
  webUploads,
} from '@studies/db';
import { DiscordAPIError, escapeMarkdown } from 'discord.js';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { type IngestResult, ingestAttachment } from '../ingest.js';

/** Discord allows at most 10 attachments per message. */
export const MAX_FILES_PER_MESSAGE = 10;
export const UPLOAD_MAX_AGE_MS = 24 * 3_600_000;
export const CLEANUP_INTERVAL_MS = 10 * 60_000;

/** Total bytes per message: Discord's 10 MiB with room for the overhead. */
export const MESSAGE_BYTES = 10 * 1024 * 1024 - 64 * 1024;

export const TOO_BIG = 'Pliki są za duże dla serwera Discord.';
export const NOT_INGESTED =
  'Plik jest na Discordzie, ale nie trafił do materiałów.';
export const SEND_FAILED = 'Nie udało się wysłać pliku na Discorda.';
export const EVENT_DELETED = 'Wydarzenie zostało usunięte.';
export const FILE_MISSING = 'Plik nie istnieje na serwerze.';
export const INTERRUPTED = 'Przerwane: bot został zrestartowany.';

/** A failure whose message is safe to show on the event page. */
export class UploadError extends Error {}

export type UploadFile = { path: string; name: string };

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
  path: string;
  rel: string;
  name: string;
  size: number;
};

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
      const path = uploadAbs(storageDir, r.storagePath);
      const st = await stat(path);
      if (!st.isFile()) throw new UploadError(FILE_MISSING);
      ready.push({
        id: r.id,
        userId: r.userId,
        path,
        rel: r.storagePath,
        name: r.originalFilename,
        size: st.size,
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
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    const content = `Plik od ${escapeMarkdown(u?.displayName ?? 'użytkownika')} (przez stronę)`;
    for (const chunk of packFiles(files)) {
      const chunkIds = chunk.map((x) => x.id);
      let sent: SentFile[];
      try {
        sent = await guild.sendFiles(
          post.threadId,
          content,
          chunk.map((x) => ({ path: x.path, name: x.name })),
        );
      } catch (err) {
        console.error(`event ${eventId}: cannot send files:`, err);
        await fail(chunkIds, isTooBig(err) ? TOO_BIG : SEND_FAILED);
        continue;
      }
      // The bot's own messages are not ingested by the gateway handlers, so
      // the sent attachments become materials here.
      for (const [i, x] of chunk.entries()) {
        const a = sent[i];
        const res: IngestResult = a
          ? await ingestAttachment(
              {
                db,
                storageDir,
                fetchBody: async () =>
                  Readable.toWeb(
                    createReadStream(x.path),
                  ) as ReadableStream<Uint8Array>,
              },
              {
                attachmentId: a.id,
                messageId: a.messageId,
                url: a.url,
                filename: x.name,
                contentType: a.contentType,
                size: a.size,
                postedAt: a.postedAt,
                uploader: {
                  discordUserId: u?.discordUserId ?? '',
                  displayName: u?.displayName ?? '',
                  avatarUrl: u?.avatarUrl ?? null,
                },
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
            )
          : 'failed';
        if (res === 'failed' || res === 'ignored') {
          await fail([x.id], NOT_INGESTED);
        } else {
          await setRows(db, [x.id], 'done');
          await removeRow(storageDir, x.rel);
        }
      }
    }
  }
  return firstError;
}

/** At boot: rows left `posting` by a crash will not finish; fail them. */
export async function failInterruptedUploads(db: Db): Promise<void> {
  await setRows(
    db,
    (
      await db
        .select({ id: webUploads.id })
        .from(webUploads)
        .where(eq(webUploads.status, 'posting'))
    ).map((r) => r.id),
    'failed',
    INTERRUPTED,
  );
}

/**
 * Removes queued/failed uploads (rows and files) older than 24 h, and files
 * in STORAGE_DIR/uploads/ with no row and an mtime older than 24 h (crash
 * leftovers). Nothing outside uploads/ is touched.
 */
export async function cleanupUploads(
  db: Db,
  storageDir: string,
  now: Date = new Date(),
): Promise<{ rows: number; orphans: number }> {
  const cutoff = new Date(now.getTime() - UPLOAD_MAX_AGE_MS);
  const old = await db
    .select({ id: webUploads.id, path: webUploads.storagePath })
    .from(webUploads)
    .where(
      and(
        inArray(webUploads.status, ['queued', 'failed']),
        lt(webUploads.createdAt, cutoff),
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
