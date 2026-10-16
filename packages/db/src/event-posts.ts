/**
 * Getting a missing Discord post made after all: a failed or interrupted
 * `event_post_upsert` is never retried by the bot itself, so the bot re-queues
 * the missing ones at boot and after /setup, and anyone may ask for a retry
 * from the event page.
 */
import { and, isNull, sql } from 'drizzle-orm';
import type { ActionResult } from './admin-actions.js';
import { writeAudit } from './audit.js';
import { enqueueBotRequest } from './bot-requests.js';
import type { Db } from './client.js';
import {
  checkUser,
  type EventSource,
  getEvent,
  isRefusal,
  NOT_FOUND,
  refused,
} from './events.js';
import { eventSeries, events } from './schema.js';

/**
 * Queues `event_post_upsert` for every live event outside a series and every
 * live series (with live occurrences) that has no post yet. A request that is
 * already queued is not duplicated. Returns how many were queued.
 */
export async function enqueueMissingEventPosts(db: Db): Promise<number> {
  const lone = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        isNull(events.deletedAt),
        isNull(events.seriesId),
        isNull(events.topicId),
      ),
    )
    .orderBy(events.id);
  const series = await db
    .select({ id: eventSeries.id })
    .from(eventSeries)
    .where(
      and(
        isNull(eventSeries.deletedAt),
        isNull(eventSeries.topicId),
        sql`EXISTS (SELECT 1 FROM events e WHERE e.series_id = ${eventSeries.id} AND e.deleted_at IS NULL)`,
      ),
    )
    .orderBy(eventSeries.id);
  let n = 0;
  const targets = [
    ...lone.map((e) => `event:${e.id}`),
    ...series.map((s) => `series:${s.id}`),
  ];
  for (const t of targets) {
    if ((await enqueueBotRequest(db, 'event_post_upsert', t)).created) n++;
  }
  return n;
}

/**
 * "Spróbuj ponownie" for the post: queues the upsert of the event's post (the
 * series' shared post for an occurrence). Any logged-in user who isn't banned.
 */
export async function retryEventPost(
  db: Db,
  userId: number,
  eventId: number,
  source: EventSource,
): Promise<ActionResult> {
  const who = await checkUser(db, userId);
  if (isRefusal(who)) return who;
  const e = await getEvent(db, eventId);
  if (!e || e.deletedAt) return refused(NOT_FOUND);
  const target = e.series ? `series:${e.series.id}` : `event:${eventId}`;
  await db.transaction(async (tx) => {
    await enqueueBotRequest(tx, 'event_post_upsert', target);
    await writeAudit(tx, {
      userId,
      action: 'event.post_retry',
      target: e.series ? target : String(eventId),
      details: { source },
    });
  });
  return { ok: true, message: 'Ponawiam tworzenie posta.' };
}
