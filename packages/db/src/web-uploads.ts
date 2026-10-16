/**
 * Files uploaded on the website for an event (`web_uploads`). The upload route
 * writes the rows and enqueues an `event_upload` bot request; the bot posts
 * the files to the event's Discord thread and marks the rows done or failed.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
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
