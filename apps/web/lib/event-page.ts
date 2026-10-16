import {
  getEvent,
  lastBotRequest,
  listEventUploads,
  retryableUploadIds,
  toWall,
} from '@studies/db';
import { notFound } from 'next/navigation';
import type { EventPageData } from '@/components/events/EventDetails';
import { getDb } from './db';
import { eventFileRows, eventHistory, listTopicsByIds } from './event-queries';
import type { SessionUser } from './session';
import { uploadFileExists } from './storage';

/** Parses the `[id]` segment; 404 for anything but a positive integer. */
export function parseEventId(raw: string): number {
  if (!/^[1-9]\d{0,9}$/.test(raw)) notFound();
  return Number(raw);
}

/**
 * Everything the event page shows. A deleted event exists only for admins
 * (404 for others), so students never see removed content.
 */
export async function loadEventPage(
  id: number,
  user: SessionUser,
): Promise<EventPageData> {
  const db = getDb();
  const ev = await getEvent(db, id);
  if (!ev || (ev.deletedAt !== null && !user.isAdmin)) notFound();
  const postTopicId = ev.series ? ev.series.topicId : ev.topicId;
  const reqTarget = ev.series ? `series:${ev.series.id}` : `event:${id}`;
  const [files, linked, history, req, uploads, retryable] = await Promise.all([
    eventFileRows(db, id),
    listTopicsByIds(db, ev.linkedTopicIds),
    eventHistory(db, id, ev.seriesId),
    postTopicId === null
      ? lastBotRequest(db, 'event_post_upsert', reqTarget)
      : Promise.resolve(null),
    listEventUploads(db, id),
    retryableUploadIds(db, id, uploadFileExists),
  ]);
  const pending = req?.status === 'queued' || req?.status === 'running';
  const postLine =
    postTopicId !== null
      ? 'Post na Discordzie: utworzony'
      : req?.status === 'failed'
        ? `Post na Discordzie: błąd${req.error ? ` (${req.error})` : ''}`
        : pending
          ? 'Post na Discordzie: w przygotowaniu'
          : 'Post na Discordzie: brak';
  // Failed, or no request is on its way: the post can be asked for again.
  const canRetryPost =
    ev.deletedAt === null && postTopicId === null && !pending;
  return {
    id,
    kind: ev.kind,
    title: ev.title,
    startsAt: toWall(ev.startsAt),
    endsAt: ev.endsAt ? toWall(ev.endsAt) : null,
    allDay: ev.allDay,
    place: ev.place,
    note: ev.note,
    subjectId: ev.subjectId,
    subjectCode: ev.subjectCode,
    subjectName: ev.subjectName,
    createdByName: ev.createdByName,
    updatedByName: ev.updatedByName,
    series: ev.series ? { rule: ev.series.rule, until: ev.series.until } : null,
    deleted: ev.deletedAt !== null,
    postLine,
    canRetryPost,
    files,
    linked,
    history,
    uploads,
    canRetryUploads: retryable.length > 0,
  };
}
