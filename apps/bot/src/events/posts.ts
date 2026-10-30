// Forum posts of events: what they say (pure renderers) and the narrow
// `EventPostGuild` interface the poller talks to (discord.js implementation
// below). Times are wall-clock Warsaw time held in UTC fields, never converted.
import {
  type Db,
  EVENT_KINDS,
  type EventDetails,
  getSetting,
  subjects,
} from '@studies/db';
import { plural } from '@studies/db/text';
import {
  type AnyThreadChannel,
  ChannelType,
  type Client,
  DiscordAPIError,
  type ForumChannel,
  RESTJSONErrorCodes,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { EVENTS_FORUM_SETTING } from '../config.js';
import { dayMonth, wallDate } from '../dates.js';
import { escapeUserText } from '../markdown.js';
import type { UploadSink } from './uploads.js';

export const DELETED_TEXT = 'Event deleted';
/** Discord audit-log reason of the bot's post edits. */
const AUDIT_REASON = 'event';
const MAX_THREAD_NAME = 100;
const MAX_MESSAGE = 2000;

const pad = (n: number) => String(n).padStart(2, '0');
const dm = dayMonth;
const dmy = wallDate;
const hm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/**
 * Cuts `title` to `room` UTF-16 units (the unit Discord counts), ending in
 * "…", and never splits a surrogate pair.
 */
export function clipTitle(title: string, room: number): string {
  if (title.length <= room) return title;
  let end = Math.max(0, room - 1);
  const last = title.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end--;
  return `${title.slice(0, end)}…`;
}

/** `<symbol> <Title> — 20 Oct`, at most 100 characters (the title is cut). */
export function eventPostTitle(e: EventDetails): string {
  const tail = ` — ${dm(e.startsAt)}`;
  const head = `${EVENT_KINDS[e.kind].symbol} `;
  const room = MAX_THREAD_NAME - head.length - tail.length;
  return `${head}${clipTitle(e.title, room)}${tail}`;
}

export const RULE_LABELS = {
  weekly: 'every week',
  biweekly: 'every 2 weeks',
} as const;

/** `🔁 <Title> — every week`, at most 100 characters (the title is cut, never inside a surrogate pair). */
export function seriesPostTitle(
  title: string,
  rule: keyof typeof RULE_LABELS,
): string {
  const tail = ` — ${RULE_LABELS[rule]}`;
  const head = '🔁 ';
  const room = MAX_THREAD_NAME - head.length - tail.length;
  const cut = clipTitle(title, room);
  return `${head}${cut}${tail}`;
}

/** Upcoming dates listed in a series post. */
const MAX_LISTED_DATES = 8;

/**
 * First message of a series post: the shared details (`base`), the rule, the
 * span and the next dates, and the link to the nearest occurrence's page.
 */
export function seriesPostContent(
  base: EventDetails,
  next: EventDetails,
  rule: keyof typeof RULE_LABELS,
  dates: Date[],
  webBaseUrl: string,
): string {
  const upcoming = dates
    .filter((d) => d >= next.startsAt)
    .slice(0, MAX_LISTED_DATES);
  const later = dates.filter((d) => d >= next.startsAt).length;
  const time = base.allDay
    ? 'all day'
    : base.endsAt
      ? `${hm(base.startsAt)}–${hm(base.endsAt)}`
      : hm(base.startsAt);
  const lines = [
    `**${EVENT_KINDS[base.kind].label}**${base.subjectCode ? ` · ${base.subjectCode}${base.subjectName ? ` — ${base.subjectName}` : ''}` : ''}`,
    `Repeats: ${RULE_LABELS[rule]}, ${time}, ${plural(dates.length, 'occurrence', 'occurrences')} (${dm(dates[0])} – ${dmy(dates[dates.length - 1])})`,
    `Next: ${upcoming.map(dm).join(', ')}${later > upcoming.length ? ', …' : ''}`,
    ...(base.place ? [`Place: ${escapeUserText(base.place)}`] : []),
    ...(base.note ? [`Note: ${escapeUserText(base.note)}`] : []),
    ...(base.createdByName
      ? [`Added by ${escapeUserText(base.createdByName)}`]
      : []),
    `Details and files: ${webBaseUrl}/s/wydarzenia/${next.id}`,
  ];
  const full = lines.join('\n');
  if (full.length <= MAX_MESSAGE) return full;
  // Too long: trim the note, never the link.
  const noteAt = lines.findIndex((l) => l.startsWith('Note: '));
  if (noteAt >= 0) {
    const room = MAX_MESSAGE - (full.length - lines[noteAt].length) - 1;
    lines[noteAt] =
      `${[...lines[noteAt]].slice(0, Math.max(10, room - 1)).join('')}…`;
  }
  return lines.join('\n').slice(0, MAX_MESSAGE);
}

/** "When" as text: a day, a day and hours, or a day and a time range. */
export function eventWhenText(e: EventDetails): string {
  if (e.allDay) return `${dmy(e.startsAt)}, all day`;
  const same = e.endsAt && dmy(e.endsAt) === dmy(e.startsAt);
  if (!e.endsAt) return `${dmy(e.startsAt)}, ${hm(e.startsAt)}`;
  if (same) return `${dmy(e.startsAt)}, ${hm(e.startsAt)}–${hm(e.endsAt)}`;
  return `${dmy(e.startsAt)}, ${hm(e.startsAt)} – ${dmy(e.endsAt)}, ${hm(e.endsAt)}`;
}

/** The first message: details plus the link to the event page. */
export function eventPostContent(e: EventDetails, webBaseUrl: string): string {
  const link = `Details and files: ${webBaseUrl}/s/wydarzenia/${e.id}`;
  // User text is escaped so it can't format the post; the link stays raw.
  const md = (t: string | null) => (t ? escapeUserText(t) : t);
  const tail = [
    ...(e.createdByName ? [`Added by ${md(e.createdByName)}`] : []),
    ...(e.updatedByName && e.updatedByName !== e.createdByName
      ? [`Last edited by ${md(e.updatedByName)}`]
      : []),
    link,
  ];
  const head = [
    `**${EVENT_KINDS[e.kind].label}**${e.subjectCode ? ` · ${e.subjectCode}${e.subjectName ? ` — ${e.subjectName}` : ''}` : ''}`,
    `When: ${eventWhenText(e)}`,
    ...(e.place ? [`Place: ${md(e.place)}`] : []),
  ];
  const join = (note: string | null) =>
    [...head, ...(note ? [`Note: ${note}`] : []), ...tail].join('\n');
  const escNote = md(e.note);
  const full = join(escNote);
  if (full.length <= MAX_MESSAGE || !escNote) return full.slice(0, MAX_MESSAGE);
  // Too long: trim the note, never the link.
  const room = MAX_MESSAGE - join('').length - 'Note: …\n'.length;
  const note = [...escNote].slice(0, Math.max(0, room - 1)).join('');
  return join(`${note}…`).slice(0, MAX_MESSAGE);
}

/** The post or its starter message no longer exists on Discord. */
export class PostGoneError extends Error {}

export type EventPostFields = {
  title: string;
  content: string;
  /** Forum tag name for the event kind (matched case-insensitively). */
  tagName: string;
};

/** The Discord operations the poller needs; `discordEventPostGuild` is the real one. */
export interface EventPostGuild extends UploadSink {
  /** New post in the forum; returns the thread id. */
  createPost(forumId: string, post: EventPostFields): Promise<string>;
  /** Edits title, first message and kind tag; reopens an archived post. */
  editFirstMessage(threadId: string, post: EventPostFields): Promise<void>;
  /** Edits the first message to `content`, then archives and locks the post. */
  archivePost(threadId: string, content: string): Promise<void>;
  /** False when the post is gone (deleted thread); other errors throw. */
  postExists(threadId: string): Promise<boolean>;
}

const isGone = (err: unknown) =>
  err instanceof DiscordAPIError &&
  (err.code === RESTJSONErrorCodes.UnknownChannel ||
    err.code === RESTJSONErrorCodes.UnknownMessage);

const KIND_TAGS = new Set(
  Object.values(EVENT_KINDS).map((k) => k.tag.toLowerCase()),
);

/** Applied tags with the kind tags replaced by `tagName`'s tag (if the forum has it). */
function tagsFor(
  forum: ForumChannel,
  current: readonly string[],
  tagName: string,
): string[] {
  const isKind = (id: string) => {
    const t = forum.availableTags.find((x) => x.id === id);
    return !!t && KIND_TAGS.has(t.name.toLowerCase());
  };
  const wanted = forum.availableTags.find(
    (t) => t.name.toLowerCase() === tagName.toLowerCase(),
  );
  return [
    ...current.filter((id) => !isKind(id)),
    ...(wanted ? [wanted.id] : []),
  ];
}

/** True when `forumId` is #wydarzenia or a subject forum the DB knows. */
export type EventForumCheck = (forumId: string) => Promise<boolean>;

export function eventForumCheck(db: Db): EventForumCheck {
  return async (forumId) => {
    if ((await getSetting(db, EVENTS_FORUM_SETTING)) === forumId) return true;
    const [s] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.discordChannelId, forumId))
      .limit(1);
    return !!s;
  };
}

/**
 * Discord allows about 2 renames of a channel per 10 minutes and the REST
 * client waits out the limit instead of failing, which would stall the
 * poller: a post renamed less than this long ago keeps its old title until the
 * window ends, when `retryRename` queues a new upsert of that post.
 */
export const RENAME_WINDOW_MS = 10 * 60_000;

/**
 * `isEventForum` guards every thread the bot acts on: the thread ids come from
 * the DB, which the admin SQL console can write, so only the bot's own posts
 * in an event forum of the configured guild count. Anything else is treated
 * as gone (a fresh post is made and re-linked).
 */
export function discordEventPostGuild(
  client: Client,
  isEventForum: EventForumCheck,
  opts: {
    guildId: string;
    now?: () => number;
    /** Queues an upsert of the post in `threadId` (a postponed rename is due). */
    retryRename?: (threadId: string) => unknown;
  },
): EventPostGuild & { dispose(): void } {
  const now = opts.now ?? Date.now;
  /** Thread id → when this process last renamed it (kept in memory). */
  const renamedAt = new Map<string, number>();
  /** Thread id → the pending retry of a postponed rename (one per thread). */
  const retries = new Map<string, NodeJS.Timeout>();
  const scheduleRetry = (threadId: string, last: number) => {
    if (retries.has(threadId) || !opts.retryRename) return;
    const retry = opts.retryRename;
    const timer = setTimeout(
      () => {
        retries.delete(threadId);
        Promise.resolve()
          .then(() => retry(threadId))
          .catch((err) =>
            console.error(`cannot queue the rename of ${threadId}:`, err),
          );
      },
      Math.max(0, last + RENAME_WINDOW_MS - now()),
    );
    timer.unref?.();
    retries.set(threadId, timer);
  };
  const forumOf = async (id: string): Promise<ForumChannel> => {
    const c = await client.channels.fetch(id);
    if (c?.type !== ChannelType.GuildForum || c.guildId !== opts.guildId) {
      throw new Error(`channel ${id} is not a forum of the server`);
    }
    return c;
  };
  /** Runs `fn`, turning "Unknown Channel/Message" into PostGoneError. */
  const orGone = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (isGone(err)) throw new PostGoneError(String(err));
      throw err;
    }
  };
  const threadOf = (id: string): Promise<AnyThreadChannel> =>
    orGone(async () => {
      const c = await client.channels.fetch(id);
      if (!c?.isThread())
        throw new PostGoneError(`channel ${id} is not a thread`);
      if (
        c.guildId !== opts.guildId ||
        c.ownerId !== client.user?.id ||
        !c.parentId ||
        !(await isEventForum(c.parentId))
      ) {
        throw new PostGoneError(`thread ${id} is not an event post of the bot`);
      }
      return c;
    });
  const editStarter = (t: AnyThreadChannel, content: string) =>
    orGone(async () => {
      const starter = await t.fetchStarterMessage();
      if (!starter)
        throw new PostGoneError(`thread ${t.id} has no starter message`);
      await starter.edit({ content, allowedMentions: { parse: [] } });
    });
  return {
    async createPost(forumId, post) {
      const forum = await forumOf(forumId);
      const t = await forum.threads.create({
        name: post.title,
        appliedTags: tagsFor(forum, [], post.tagName),
        message: { content: post.content, allowedMentions: { parse: [] } },
        reason: AUDIT_REASON,
      });
      return t.id;
    },
    async editFirstMessage(threadId, post) {
      const t = await threadOf(threadId);
      // Archived or locked threads reject edits; reopen first.
      if (t.archived) await t.setArchived(false, AUDIT_REASON);
      if (t.locked) await t.setLocked(false, AUDIT_REASON);
      const parent = t.parent;
      const tags =
        parent?.type === ChannelType.GuildForum
          ? tagsFor(parent, t.appliedTags, post.tagName)
          : undefined;
      await orGone(async () => {
        // Renames are rate limited (about 2 per 10 minutes): only when the
        // title changed and the last rename is old enough (RENAME_WINDOW_MS),
        // and a refusal doesn't stop the rest of the edit.
        const last = renamedAt.get(t.id);
        const recent = last !== undefined && now() - last < RENAME_WINDOW_MS;
        if (t.name !== post.title && recent) {
          console.log(`rename of event post ${t.id} postponed (rate limit)`);
          scheduleRetry(t.id, last);
        } else if (t.name !== post.title) {
          for (const [id, at] of renamedAt)
            if (now() - at >= RENAME_WINDOW_MS) renamedAt.delete(id);
          renamedAt.set(t.id, now());
          await t.setName(post.title, AUDIT_REASON).catch((err) => {
            if (isGone(err)) throw err;
            console.error(`cannot rename event post ${t.id}:`, err);
          });
        }
        if (tags && tags.join() !== t.appliedTags.join()) {
          await t.setAppliedTags(tags, AUDIT_REASON);
        }
      });
      await editStarter(t, post.content);
    },
    async archivePost(threadId, content) {
      const t = await threadOf(threadId);
      if (t.archived) await t.setArchived(false, AUDIT_REASON);
      await editStarter(t, content);
      await t.setLocked(true, AUDIT_REASON);
      await t.setArchived(true, AUDIT_REASON);
    },
    async sendFiles(threadId, content, files) {
      const t = await threadOf(threadId);
      if (t.archived) await t.setArchived(false, AUDIT_REASON);
      const msg = await t.send({
        content,
        files: files.map((f) => ({ attachment: f.data, name: f.name })),
        allowedMentions: { parse: [] },
      });
      return [...msg.attachments.values()].map((a) => ({
        id: a.id,
        messageId: msg.id,
        url: a.url,
        name: a.name,
        contentType: a.contentType ?? null,
        size: a.size,
        postedAt: msg.createdAt,
      }));
    },
    async postExists(threadId) {
      try {
        await threadOf(threadId);
        return true;
      } catch (err) {
        if (err instanceof PostGoneError) return false;
        throw err;
      }
    },
    dispose() {
      for (const timer of retries.values()) clearTimeout(timer);
      retries.clear();
    },
  };
}
