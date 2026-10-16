/**
 * Files uploaded on the website for an event (`web_uploads`). The upload route
 * writes the rows and enqueues an `event_upload` bot request; the bot posts
 * the files to the event's Discord thread and marks the rows done or failed.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { ActionResult } from './admin-actions.js';
import { writeAudit } from './audit.js';
import { enqueueBotRequest } from './bot-requests.js';
import type { Db, DbExecutor } from './client.js';
import { checkUser, getEvent, isRefusal, refused } from './events.js';
import { webUploads } from './schema.js';

export type WebUploadStatus = 'queued' | 'posting' | 'done' | 'failed';

export type WebUploadRow = {
  id: number;
  name: string;
  status: WebUploadStatus;
  error: string | null;
};

/**
 * Files `userId` uploaded in the last hour, summed from the `event.upload`
 * audit rows (`details.count`), so the limit survives restarts.
 */
export async function uploadedFilesLastHour(
  db: DbExecutor,
  userId: number,
): Promise<number> {
  const [r] = (await db.execute(sql`
    SELECT COALESCE(SUM(CAST(JSON_EXTRACT(details, '$.count') AS UNSIGNED)), 0) AS n
      FROM admin_audit
     WHERE user_id = ${userId} AND action = 'event.upload'
       AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`)) as unknown as [
    { n: number | string }[],
  ];
  return Number(r[0].n);
}

/** Uploads of the last 24 h for an event, newest first (at most `limit`). */
export async function listEventUploads(
  db: DbExecutor,
  eventId: number,
  limit = 20,
): Promise<WebUploadRow[]> {
  return db
    .select({
      id: webUploads.id,
      name: webUploads.originalFilename,
      status: webUploads.status,
      error: webUploads.error,
    })
    .from(webUploads)
    .where(
      and(
        eq(webUploads.eventId, eventId),
        gt(webUploads.createdAt, sql`DATE_SUB(NOW(), INTERVAL 24 HOUR)`),
      ),
    )
    .orderBy(desc(webUploads.id))
    .limit(limit);
}

export async function getUploadsByIds(db: DbExecutor, ids: number[]) {
  if (ids.length === 0) return [];
  return db.select().from(webUploads).where(inArray(webUploads.id, ids));
}

/**
 * Failed uploads of the last 24 h for `eventId` whose temp file still exists
 * (`fileExists` gets the storage-relative path): the ones a retry can resend.
 */
export async function retryableUploadIds(
  db: DbExecutor,
  eventId: number,
  fileExists: (rel: string) => Promise<boolean>,
): Promise<number[]> {
  const rows = await db
    .select({ id: webUploads.id, path: webUploads.storagePath })
    .from(webUploads)
    .where(
      and(
        eq(webUploads.eventId, eventId),
        eq(webUploads.status, 'failed'),
        gt(webUploads.createdAt, sql`DATE_SUB(NOW(), INTERVAL 24 HOUR)`),
      ),
    )
    .orderBy(webUploads.id);
  const out: number[] = [];
  for (const r of rows) if (await fileExists(r.path)) out.push(r.id);
  return out;
}

/**
 * Puts the event's retryable failed uploads back to `queued` and queues a new
 * `event_upload` request (target `upload:<first retried id>`).
 */
export async function retryFailedUploads(
  db: Db,
  userId: number,
  eventId: number,
  fileExists: (rel: string) => Promise<boolean>,
): Promise<ActionResult> {
  const who = await checkUser(db, userId);
  if (isRefusal(who)) return who;
  const e = await getEvent(db, eventId);
  if (!e || e.deletedAt) return refused('Nie znaleziono wydarzenia.');
  const ids = await retryableUploadIds(db, eventId, fileExists);
  if (ids.length === 0) return refused('Brak plików do ponowienia.');
  await db.transaction(async (tx) => {
    await tx
      .update(webUploads)
      .set({ status: 'queued', error: null, finishedAt: null })
      .where(and(inArray(webUploads.id, ids), eq(webUploads.status, 'failed')));
    await enqueueBotRequest(tx, 'event_upload', `upload:${ids[0]}`, {
      eventId,
      uploadIds: ids,
    });
    await writeAudit(tx, {
      userId,
      action: 'event.upload_retry',
      target: String(eventId),
      details: { source: 'web', count: ids.length, uploadIds: ids },
    });
  });
  return { ok: true, message: 'Ponawiam wysyłanie.' };
}
