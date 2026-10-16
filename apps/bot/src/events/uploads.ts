// Files uploaded on the website (`web_uploads`): the web writes them to
// STORAGE_DIR/uploads/<uuid> and queues one `event_upload` bot request per
// batch. Here they are sent to the event's Discord post (ingestion then picks
// them up as materials), the rows are marked done and the temp files removed.
// A failure stores a SAFE Polish message on the rows (never a path or a stack
// trace) and keeps the temp file for a retry until it is a day old.
import { readdir, stat, unlink } from 'node:fs/promises';
import {
  type Db,
  type EventDetails,
  getEvent,
  getUploadsByIds,
  resolveInStorage,
  users,
  webUploads,
} from '@studies/db';
import { escapeMarkdown } from 'discord.js';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';

/** Discord allows at most 10 attachments per message. */
export const MAX_FILES_PER_MESSAGE = 10;
export const UPLOAD_MAX_AGE_MS = 24 * 3_600_000;
export const CLEANUP_INTERVAL_MS = 10 * 60_000;

export const SEND_FAILED = 'Nie udało się wysłać pliku na Discorda.';
export const EVENT_DELETED = 'Wydarzenie zostało usunięte.';
export const FILE_MISSING = 'Plik nie istnieje na serwerze.';
export const INTERRUPTED = 'Przerwane: bot został zrestartowany.';

/** A failure whose message is safe to show on the event page. */
export class UploadError extends Error {}

export type UploadFile = { path: string; name: string };

/** The one Discord operation uploads need. */
export interface UploadSink {
  /** Sends `files` with `content` into the post; throws on any error. */
  sendFiles(
    threadId: string,
    content: string,
    files: UploadFile[],
  ): Promise<void>;
}

export type UploadDeps = {
  db: Db;
  storageDir: string;
  guild: UploadSink;
  /** The thread id of the event's post (created first when missing). */
  ensureThread(e: EventDetails): Promise<string>;
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
  const abs = (rel: string) => resolveInStorage(storageDir, rel);

  const e = await getEvent(db, eventId);
  if (!e || e.deletedAt) {
    await setRows(db, rowIds, 'failed', EVENT_DELETED);
    for (const r of rows) await remove(abs(r.storagePath));
    return EVENT_DELETED;
  }

  await setRows(db, rowIds, 'posting');
  let firstError: string | null = null;
  const fail = async (ids: number[], msg: string) => {
    await setRows(db, ids, 'failed', msg);
    firstError ??= msg;
  };

  // Files that exist, by uploader (the message names the uploader).
  const ready: { id: number; userId: number; path: string; name: string }[] =
    [];
  for (const r of rows) {
    let path: string;
    try {
      path = abs(r.storagePath);
      await stat(path);
    } catch {
      await fail([r.id], FILE_MISSING);
      continue;
    }
    ready.push({
      id: r.id,
      userId: r.userId,
      path,
      name: r.originalFilename,
    });
  }
  if (ready.length === 0) return firstError;

  let threadId: string;
  try {
    threadId = await deps.ensureThread(e);
  } catch (err) {
    console.error(`event ${eventId}: no post for uploads:`, err);
    await fail(
      ready.map((x) => x.id),
      err instanceof UploadError ? err.message : SEND_FAILED,
    );
    return firstError;
  }

  const byUser = new Map<number, typeof ready>();
  for (const f of ready) {
    byUser.set(f.userId, [...(byUser.get(f.userId) ?? []), f]);
  }
  for (const [userId, files] of byUser) {
    const [u] = await db
      .select({ n: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    const content = `Plik od ${escapeMarkdown(u?.n ?? 'użytkownika')} (przez stronę)`;
    for (let i = 0; i < files.length; i += MAX_FILES_PER_MESSAGE) {
      const chunk = files.slice(i, i + MAX_FILES_PER_MESSAGE);
      const chunkIds = chunk.map((x) => x.id);
      try {
        await guild.sendFiles(
          threadId,
          content,
          chunk.map((x) => ({ path: x.path, name: x.name })),
        );
      } catch (err) {
        console.error(`event ${eventId}: cannot send files:`, err);
        await fail(chunkIds, SEND_FAILED);
        continue;
      }
      await setRows(db, chunkIds, 'done');
      for (const x of chunk) await remove(x.path);
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
    try {
      await remove(resolveInStorage(storageDir, r.path));
    } catch {
      // a path outside storage: drop the row, never touch the file
    }
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
