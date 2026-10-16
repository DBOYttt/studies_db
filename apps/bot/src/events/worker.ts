// Polls the bot_requests queue for event posts and keeps each event's forum
// post in sync: `event_post_upsert` creates or edits it, `event_post_archive`
// archives it after a delete. One request at a time; a tick never overlaps
// the previous one. A failure marks the request `failed` with a short Polish
// message (shown on the event page) and logs the details.
import {
  claimNextBotRequest,
  type Db,
  EVENT_KINDS,
  type EventDetails,
  events,
  eventTopics,
  failStaleBotRequests,
  finishBotRequest,
  getEvent,
  getSetting,
  subjects,
  topics,
} from '@studies/db';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import { EVENTS_FORUM_SETTING } from '../config.js';
import {
  DELETED_TEXT,
  type EventPostFields,
  type EventPostGuild,
  eventPostContent,
  eventPostTitle,
  PostGoneError,
} from './posts.js';

export const EVENT_REQUEST_KINDS = [
  'event_post_upsert',
  'event_post_archive',
] as const;
export const POLL_INTERVAL_MS = 5_000;

export type EventPostDeps = {
  db: Db;
  guild: EventPostGuild;
  webBaseUrl: string;
};

/** A failure whose message is meant for the event page. */
export class EventPostError extends Error {}

const GENERIC_FAILURE = 'Nie udało się zaktualizować posta na Discordzie.';

/** The short Polish text stored on the request. */
export function failureMessage(err: unknown): string {
  if (err instanceof EventPostError) return err.message;
  if (err instanceof DiscordAPIError) {
    if (
      err.code === RESTJSONErrorCodes.MissingPermissions ||
      err.code === RESTJSONErrorCodes.MissingAccess
    ) {
      return 'Bot nie ma uprawnień do tego forum — sprawdź uprawnienia kanału.';
    }
    if (err.code === RESTJSONErrorCodes.UnknownChannel) {
      return 'Forum nie istnieje na Discordzie — uruchom /setup.';
    }
  }
  return GENERIC_FAILURE;
}

const eventIdOf = (target: string): number => {
  const m = /^event:(\d+)$/.exec(target);
  if (!m) throw new EventPostError('Nieprawidłowe zlecenie.');
  return Number(m[1]);
};

async function targetForum(db: Db, e: EventDetails): Promise<string> {
  if (e.subjectId === null) {
    const id = await getSetting(db, EVENTS_FORUM_SETTING);
    if (!id) {
      throw new EventPostError('Brak forum #wydarzenia — uruchom /setup.');
    }
    return id;
  }
  const [s] = await db
    .select({ channel: subjects.discordChannelId })
    .from(subjects)
    .where(eq(subjects.id, e.subjectId));
  if (!s?.channel) {
    throw new EventPostError(
      'Brak forum przedmiotu na Discordzie — uruchom /setup.',
    );
  }
  return s.channel;
}

async function topicOf(db: Db, id: number | null) {
  if (id === null) return undefined;
  const [t] = await db.select().from(topics).where(eq(topics.id, id));
  return t;
}

export async function upsertEventPost(
  deps: EventPostDeps,
  eventId: number,
): Promise<void> {
  const { db, guild } = deps;
  const e = await getEvent(db, eventId);
  // Gone, or deleted since the request was queued (e.g. unlink on a deleted
  // event): nothing to show.
  if (!e || e.deletedAt) return;
  const forumId = await targetForum(db, e);
  const post: EventPostFields = {
    title: eventPostTitle(e),
    content: eventPostContent(e, deps.webBaseUrl),
    tagName: EVENT_KINDS[e.kind].label,
  };
  const topic = await topicOf(db, e.topicId);
  let alive =
    !!topic &&
    !topic.deletedAt &&
    (await guild.postExists(topic.discordThreadId));
  if (topic && alive && topic.subjectId === e.subjectId) {
    try {
      await guild.editFirstMessage(topic.discordThreadId, post);
      await db
        .update(topics)
        .set({ title: post.title })
        .where(eq(topics.id, topic.id));
      return;
    } catch (err) {
      // The post or its first message vanished: make a new post below.
      if (!(err instanceof PostGoneError)) throw err;
      alive = false;
    }
  }
  // No post, the post is gone, or the subject changed: a new post.
  const threadId = await guild.createPost(forumId, post);
  let topicId: number;
  try {
    [{ id: topicId }] = await db
      .insert(topics)
      .values({
        subjectId: e.subjectId,
        title: post.title,
        discordThreadId: threadId,
        createdBy: e.createdBy,
      })
      .$returningId();
    await db.update(events).set({ topicId }).where(eq(events.id, e.id));
  } catch (err) {
    // Don't leave an unknown post behind: the retry would create a second one.
    await guild.archivePost(threadId, DELETED_TEXT).catch(() => {});
    throw err;
  }
  if (topic && alive) {
    // Subject move: the old post keeps its files as a linked post.
    await db
      .insert(eventTopics)
      .values({ eventId: e.id, topicId: topic.id })
      .onDuplicateKeyUpdate({ set: { eventId: sql`event_id` } });
  }
}

export async function archiveEventPost(
  deps: EventPostDeps,
  eventId: number,
): Promise<void> {
  const { db, guild } = deps;
  const e = await getEvent(db, eventId);
  // A live event (restored since) keeps its post; the restore queued an upsert.
  if (!e?.deletedAt) return;
  const topic = await topicOf(db, e.topicId);
  if (!topic || topic.deletedAt) return;
  if (!(await guild.postExists(topic.discordThreadId))) return;
  try {
    await guild.archivePost(topic.discordThreadId, DELETED_TEXT);
  } catch (err) {
    // Gone while archiving: nothing left to archive.
    if (!(err instanceof PostGoneError)) throw err;
  }
}

/**
 * At boot: fails every `running` event request. This process is their only
 * consumer, so whatever is still `running` was interrupted by a crash or
 * deploy. Awaited before the poller starts. Returns how many were failed.
 */
export function recoverInterruptedRequests(db: Db): Promise<number> {
  return failStaleBotRequests(db, new Date(), 0, [...EVENT_REQUEST_KINDS]);
}

/** Processes queued requests one by one until none are left. */
export async function drainEventRequests(
  deps: EventPostDeps,
  log: (msg: string, err?: unknown) => void = console.error,
): Promise<number> {
  const { db } = deps;
  let n = 0;
  for (;;) {
    const req = await claimNextBotRequest(db, [...EVENT_REQUEST_KINDS]);
    if (!req) return n;
    n++;
    try {
      const id = eventIdOf(req.target);
      if (req.kind === 'event_post_upsert') await upsertEventPost(deps, id);
      else await archiveEventPost(deps, id);
      await finishBotRequest(db, req.id, 'done');
    } catch (err) {
      log(`bot request ${req.id} (${req.kind} ${req.target}) failed:`, err);
      await finishBotRequest(db, req.id, 'failed', failureMessage(err)).catch(
        (e) => log(`bot request ${req.id}: cannot store the failure:`, e),
      );
    }
  }
}

/** Polls every `intervalMs`; the next tick is scheduled after the last ends. */
export function startEventPoller(
  deps: EventPostDeps,
  intervalMs = POLL_INTERVAL_MS,
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const tick = () => {
    running = drainEventRequests(deps)
      .catch((err) => console.error('event poller:', err))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
  };
  timer = setTimeout(tick, 0);
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
