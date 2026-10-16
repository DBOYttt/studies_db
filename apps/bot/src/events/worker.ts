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
  eventSeries,
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
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { EVENTS_FORUM_SETTING } from '../config.js';
import {
  DELETED_TEXT,
  type EventPostFields,
  type EventPostGuild,
  eventPostContent,
  eventPostTitle,
  PostGoneError,
  seriesPostContent,
  seriesPostTitle,
} from './posts.js';
import {
  CLEANUP_INTERVAL_MS,
  cleanupUploads,
  failInterruptedUploads,
  postEventUploads,
  UploadError,
} from './uploads.js';

export const EVENT_REQUEST_KINDS = [
  'event_post_upsert',
  'event_post_archive',
  'event_upload',
] as const;
export const POLL_INTERVAL_MS = 5_000;

export type EventPostDeps = {
  db: Db;
  guild: EventPostGuild;
  webBaseUrl: string;
  /** Root of the file volume (uploads/ lives under it). */
  storageDir: string;
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

/** `event:<id>` or `series:<id>` (a recurring event's single post). */
export const targetOf = (
  target: string,
): { type: 'event' | 'series'; id: number } => {
  const m = /^(event|series):(\d+)$/.exec(target);
  if (!m) throw new EventPostError('Nieprawidłowe zlecenie.');
  return { type: m[1] as 'event' | 'series', id: Number(m[2]) };
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

type Publish = {
  subjectId: number | null;
  forumId: string;
  topic: typeof topics.$inferSelect | undefined;
  post: EventPostFields;
  createdBy: number | null;
  /** Points the owner (event or series) at the new topic. */
  attach(topicId: number): Promise<void>;
  /** Keeps the old post (subject move) as a linked post of the owner. */
  keepOld(topicId: number): Promise<void>;
};

/** Edits the owner's post, or creates it (also when it vanished or moved). */
async function publishPost(deps: EventPostDeps, o: Publish): Promise<void> {
  const { db, guild } = deps;
  const { topic, post } = o;
  let alive =
    !!topic &&
    !topic.deletedAt &&
    (await guild.postExists(topic.discordThreadId));
  if (topic && alive && topic.subjectId === o.subjectId) {
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
  const threadId = await guild.createPost(o.forumId, post);
  let topicId: number;
  try {
    [{ id: topicId }] = await db
      .insert(topics)
      .values({
        subjectId: o.subjectId,
        title: post.title,
        discordThreadId: threadId,
        createdBy: o.createdBy,
      })
      .$returningId();
    await o.attach(topicId);
  } catch (err) {
    // Don't leave an unknown post behind: the retry would create a second one.
    await guild.archivePost(threadId, DELETED_TEXT).catch(() => {});
    throw err;
  }
  if (topic && alive) await o.keepOld(topic.id);
}

export async function upsertEventPost(
  deps: EventPostDeps,
  eventId: number,
): Promise<void> {
  const { db } = deps;
  const e = await getEvent(db, eventId);
  // Gone, or deleted since the request was queued (e.g. unlink on a deleted
  // event): nothing to show.
  if (!e || e.deletedAt) return;
  const forumId = await targetForum(db, e);
  await publishPost(deps, {
    subjectId: e.subjectId,
    forumId,
    topic: await topicOf(db, e.topicId),
    post: {
      title: eventPostTitle(e),
      content: eventPostContent(e, deps.webBaseUrl),
      tagName: EVENT_KINDS[e.kind].label,
    },
    createdBy: e.createdBy,
    attach: async (topicId) => {
      await db.update(events).set({ topicId }).where(eq(events.id, e.id));
    },
    keepOld: async (topicId) => {
      // Subject move: the old post keeps its files as a linked post.
      await db
        .insert(eventTopics)
        .values({ eventId: e.id, topicId })
        .onDuplicateKeyUpdate({ set: { eventId: sql`event_id` } });
    },
  });
}

/**
 * Every series of `s`'s split lineage (same root) or sharing its post, deleted
 * ones included: they all share one forum post, even before `topic_id` is set.
 */
async function familyOf(db: Db, s: typeof eventSeries.$inferSelect) {
  const rootId = s.parentId ?? s.id;
  const conds = [eq(eventSeries.id, rootId), eq(eventSeries.parentId, rootId)];
  if (s.topicId !== null) conds.push(eq(eventSeries.topicId, s.topicId));
  return db
    .select()
    .from(eventSeries)
    .where(or(...conds))
    .orderBy(asc(eventSeries.id));
}

/**
 * The post of a series. After a "following" split two series share one post
 * (`topic_id`): the title and first message describe the one that owns the
 * latest occurrences, and the dates of every sharing series are listed. A
 * second post is never created while another series holds the topic.
 */
export async function upsertSeriesPost(
  deps: EventPostDeps,
  seriesId: number,
): Promise<void> {
  const { db } = deps;
  const [me] = await db
    .select()
    .from(eventSeries)
    .where(eq(eventSeries.id, seriesId));
  if (!me || me.deletedAt) return;
  const family = await familyOf(db, me);
  const group = await seriesWithOccurrences(
    db,
    family.filter((x) => !x.deletedAt),
  );
  // The post of the lineage: mine, else a sibling's (reused, not recreated).
  const topicId =
    me.topicId ?? family.find((x) => x.topicId !== null)?.topicId ?? null;
  const mine = group.find((g) => g.series.id === me.id);
  if (!mine) return; // no live occurrences (an archive follows)
  const owner = group.reduce((a, b) =>
    b.occ[b.occ.length - 1].startsAt > a.occ[a.occ.length - 1].startsAt ? b : a,
  );
  const all = group
    .flatMap((g) => g.occ)
    .sort((a, b) => +a.startsAt - +b.startsAt || a.id - b.id);
  const now = new Date();
  const next = all.find((o) => o.startsAt >= now) ?? all[all.length - 1];
  const e = await getEvent(db, next.id);
  const first = await getEvent(db, owner.occ[0].id);
  if (!e || !first) return;
  const forumId = await targetForum(db, first);
  const dates = all.map((o) => o.startsAt);
  const topic = await topicOf(db, topicId);
  const ids = group.map((g) => g.series.id);
  const familyIds = family.map((x) => x.id);
  // A sibling already has the post: this series (and the rest) adopt it.
  if (me.topicId === null && topicId !== null) {
    await db
      .update(eventSeries)
      .set({ topicId })
      .where(
        and(inArray(eventSeries.id, familyIds), isNull(eventSeries.topicId)),
      );
  }
  await publishPost(deps, {
    subjectId: first.subjectId,
    forumId,
    topic,
    post: {
      title: seriesPostTitle(first.title, owner.series.rule),
      content: seriesPostContent(
        first,
        e,
        owner.series.rule,
        dates,
        deps.webBaseUrl,
      ),
      tagName: EVENT_KINDS[first.kind].label,
    },
    createdBy: me.createdBy,
    attach: async (created) => {
      // Every series of the lineage follows the new post.
      await db
        .update(eventSeries)
        .set({ topicId: created })
        .where(
          and(
            inArray(eventSeries.id, familyIds),
            topicId === null
              ? isNull(eventSeries.topicId)
              : or(
                  isNull(eventSeries.topicId),
                  eq(eventSeries.topicId, topicId),
                ),
          ),
        );
    },
    keepOld: async (topicId) => {
      await db
        .insert(eventTopics)
        .values(ids.map((sid) => ({ seriesId: sid, topicId })))
        .onDuplicateKeyUpdate({ set: { topicId: sql`topic_id` } });
    },
  });
}

async function seriesWithOccurrences(
  db: Db,
  list: (typeof eventSeries.$inferSelect)[],
) {
  const out = [];
  for (const series of list) {
    const occ = await db
      .select({ id: events.id, startsAt: events.startsAt })
      .from(events)
      .where(and(eq(events.seriesId, series.id), isNull(events.deletedAt)))
      .orderBy(asc(events.startsAt), asc(events.id));
    if (occ.length > 0) out.push({ series, occ });
  }
  return out;
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
 * Archives a deleted series' post, unless another series sharing the post
 * still has live occurrences (it keeps the post; its upsert refreshes it).
 */
export async function archiveSeriesPost(
  deps: EventPostDeps,
  seriesId: number,
): Promise<void> {
  const { db, guild } = deps;
  const [s] = await db
    .select()
    .from(eventSeries)
    .where(eq(eventSeries.id, seriesId));
  // A live series (restored since) keeps its post; the restore queued an upsert.
  if (!s?.deletedAt || s.topicId === null) return;
  const sharing = (await familyOf(db, s)).filter((x) => x.id !== s.id);
  const alive = await seriesWithOccurrences(
    db,
    sharing.filter((x) => !x.deletedAt),
  );
  if (alive.length > 0) {
    await upsertSeriesPost(deps, alive[0].series.id);
    return;
  }
  const topic = await topicOf(db, s.topicId);
  if (!topic || topic.deletedAt) return;
  if (!(await guild.postExists(topic.discordThreadId))) return;
  try {
    await guild.archivePost(topic.discordThreadId, DELETED_TEXT);
  } catch (err) {
    if (!(err instanceof PostGoneError)) throw err;
  }
}

/**
 * At boot: fails every `running` event request. This process is their only
 * consumer, so whatever is still `running` was interrupted by a crash or
 * deploy. Awaited before the poller starts. Returns how many were failed.
 */
export async function recoverInterruptedRequests(db: Db): Promise<number> {
  const n = await failStaleBotRequests(db, new Date(), 0, [
    ...EVENT_REQUEST_KINDS,
  ]);
  await failInterruptedUploads(db);
  return n;
}

/**
 * The thread of the event's post: a series occurrence uses the series' shared
 * post. A missing (or vanished) post is created through the upsert path first.
 */
async function ensureThread(
  deps: EventPostDeps,
  e: EventDetails,
): Promise<{ threadId: string; topicId: number }> {
  const { db, guild } = deps;
  const topicOfEvent = async (ev: EventDetails) =>
    topicOf(db, ev.series ? ev.series.topicId : ev.topicId);
  let t = await topicOfEvent(e);
  if (t && !t.deletedAt && (await guild.postExists(t.discordThreadId))) {
    return { threadId: t.discordThreadId, topicId: t.id };
  }
  try {
    if (e.seriesId !== null) await upsertSeriesPost(deps, e.seriesId);
    else await upsertEventPost(deps, e.id);
  } catch (err) {
    if (err instanceof EventPostError) throw new UploadError(err.message);
    throw err;
  }
  const fresh = await getEvent(db, e.id);
  t = fresh ? await topicOfEvent(fresh) : undefined;
  if (!t || t.deletedAt) throw new UploadError(failureMessage(null));
  return { threadId: t.discordThreadId, topicId: t.id };
}

const UPLOAD_TARGET = /^upload:\d+$/;

async function handleUpload(
  deps: EventPostDeps,
  req: { target: string; payload: unknown },
): Promise<void> {
  const p = req.payload as { eventId?: unknown; uploadIds?: unknown } | null;
  const ids = Array.isArray(p?.uploadIds)
    ? p.uploadIds.filter((x): x is number => Number.isInteger(x))
    : [];
  if (
    !UPLOAD_TARGET.test(req.target) ||
    !Number.isInteger(p?.eventId) ||
    ids.length === 0
  ) {
    throw new EventPostError('Nieprawidłowe zlecenie.');
  }
  const failed = await postEventUploads(
    {
      db: deps.db,
      storageDir: deps.storageDir,
      guild: deps.guild,
      ensureThread: (e) => ensureThread(deps, e),
    },
    p?.eventId as number,
    ids,
  );
  if (failed) throw new EventPostError(failed);
}

/**
 * Processes queued requests one by one until none are left, or until
 * `isStopped()` (checked between requests, so a shutdown waits for one only).
 */
export async function drainEventRequests(
  deps: EventPostDeps,
  log: (msg: string, err?: unknown) => void = console.error,
  isStopped: () => boolean = () => false,
): Promise<number> {
  const { db } = deps;
  let n = 0;
  for (;;) {
    if (isStopped()) return n;
    const req = await claimNextBotRequest(db, [...EVENT_REQUEST_KINDS]);
    if (!req) return n;
    n++;
    try {
      if (req.kind === 'event_upload') {
        await handleUpload(deps, req);
        await finishBotRequest(db, req.id, 'done');
        continue;
      }
      const { type, id } = targetOf(req.target);
      if (req.kind === 'event_post_upsert') {
        if (type === 'series') await upsertSeriesPost(deps, id);
        else await upsertEventPost(deps, id);
      } else if (type === 'series') await archiveSeriesPost(deps, id);
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
  let lastCleanup = 0;
  const cleanup = async () => {
    if (stopped || Date.now() - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = Date.now();
    try {
      await cleanupUploads(deps.db, deps.storageDir);
    } catch (err) {
      console.error('upload cleanup:', err);
    }
  };
  const tick = () => {
    running = drainEventRequests(deps, console.error, () => stopped)
      .catch((err) => console.error('event poller:', err))
      .then(cleanup)
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
