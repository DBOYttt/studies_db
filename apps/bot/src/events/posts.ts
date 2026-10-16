// Forum posts of events: what they say (pure renderers) and the narrow
// `EventPostGuild` interface the poller talks to (discord.js implementation
// below). Times are wall-clock Warsaw time held in UTC fields, never converted.
import { EVENT_KINDS, type EventDetails } from '@studies/db';
import {
  type AnyThreadChannel,
  ChannelType,
  type Client,
  DiscordAPIError,
  type ForumChannel,
  RESTJSONErrorCodes,
} from 'discord.js';

export const DELETED_TEXT = 'Wydarzenie usunięte';
const MAX_THREAD_NAME = 100;
const MAX_MESSAGE = 2000;

const pad = (n: number) => String(n).padStart(2, '0');
const dm = (d: Date) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`;
const dmy = (d: Date) => `${dm(d)}.${d.getUTCFullYear()}`;
const hm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/** `<symbol> <Tytuł> — DD.MM`, at most 100 characters (the title is cut). */
export function eventPostTitle(e: EventDetails): string {
  const tail = ` — ${dm(e.startsAt)}`;
  const head = `${EVENT_KINDS[e.kind].symbol} `;
  const room = MAX_THREAD_NAME - head.length - tail.length;
  const title =
    e.title.length > room ? `${e.title.slice(0, room - 1)}…` : e.title;
  return `${head}${title}${tail}`;
}

/** "Kiedy" as text: a day, a day and hours, or a day and a time range. */
export function eventWhenText(e: EventDetails): string {
  if (e.allDay) return `${dmy(e.startsAt)} (cały dzień)`;
  const same = e.endsAt && dmy(e.endsAt) === dmy(e.startsAt);
  if (!e.endsAt) return `${dmy(e.startsAt)} ${hm(e.startsAt)}`;
  if (same) return `${dmy(e.startsAt)} ${hm(e.startsAt)}–${hm(e.endsAt)}`;
  return `${dmy(e.startsAt)} ${hm(e.startsAt)} – ${dmy(e.endsAt)} ${hm(e.endsAt)}`;
}

/** The first message: details plus the link to the event page. */
export function eventPostContent(e: EventDetails, webBaseUrl: string): string {
  const lines = [
    `**${EVENT_KINDS[e.kind].label}**${e.subjectCode ? ` · ${e.subjectCode}${e.subjectName ? ` — ${e.subjectName}` : ''}` : ''}`,
    `Kiedy: ${eventWhenText(e)}`,
    ...(e.place ? [`Miejsce: ${e.place}`] : []),
    ...(e.note ? [`Notatka: ${e.note}`] : []),
    ...(e.createdByName ? [`Dodane przez ${e.createdByName}`] : []),
    ...(e.updatedByName && e.updatedByName !== e.createdByName
      ? [`Ostatnio edytowane przez ${e.updatedByName}`]
      : []),
    `Szczegóły i pliki: ${webBaseUrl}/s/wydarzenia/${e.id}`,
  ];
  return lines.join('\n').slice(0, MAX_MESSAGE);
}

export type EventPostFields = {
  title: string;
  content: string;
  /** Forum tag name for the event kind (matched case-insensitively). */
  tagName: string;
};

/** The Discord operations the poller needs; `discordEventPostGuild` is the real one. */
export interface EventPostGuild {
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

const KIND_LABELS = new Set(
  Object.values(EVENT_KINDS).map((k) => k.label.toLowerCase()),
);

/** Applied tags with the kind tags replaced by `tagName`'s tag (if the forum has it). */
function tagsFor(
  forum: ForumChannel,
  current: readonly string[],
  tagName: string,
): string[] {
  const isKind = (id: string) => {
    const t = forum.availableTags.find((x) => x.id === id);
    return !!t && KIND_LABELS.has(t.name.toLowerCase());
  };
  const wanted = forum.availableTags.find(
    (t) => t.name.toLowerCase() === tagName.toLowerCase(),
  );
  return [
    ...current.filter((id) => !isKind(id)),
    ...(wanted ? [wanted.id] : []),
  ];
}

export function discordEventPostGuild(client: Client): EventPostGuild {
  const forumOf = async (id: string): Promise<ForumChannel> => {
    const c = await client.channels.fetch(id);
    if (c?.type !== ChannelType.GuildForum) {
      throw new Error(`channel ${id} is not a forum`);
    }
    return c;
  };
  const threadOf = async (id: string): Promise<AnyThreadChannel> => {
    const c = await client.channels.fetch(id);
    if (!c?.isThread()) throw new Error(`channel ${id} is not a thread`);
    return c;
  };
  const editStarter = async (t: AnyThreadChannel, content: string) => {
    const starter = await t.fetchStarterMessage();
    if (!starter) throw new Error(`thread ${t.id} has no starter message`);
    await starter.edit({ content, allowedMentions: { parse: [] } });
  };
  return {
    async createPost(forumId, post) {
      const forum = await forumOf(forumId);
      const t = await forum.threads.create({
        name: post.title,
        appliedTags: tagsFor(forum, [], post.tagName),
        message: { content: post.content, allowedMentions: { parse: [] } },
        reason: 'wydarzenie',
      });
      return t.id;
    },
    async editFirstMessage(threadId, post) {
      const t = await threadOf(threadId);
      // Archived or locked threads reject edits; reopen first.
      if (t.archived) await t.setArchived(false, 'wydarzenie');
      if (t.locked) await t.setLocked(false, 'wydarzenie');
      const parent = t.parent;
      const tags =
        parent?.type === ChannelType.GuildForum
          ? tagsFor(parent, t.appliedTags, post.tagName)
          : undefined;
      if (t.name !== post.title) await t.setName(post.title, 'wydarzenie');
      if (tags && tags.join() !== t.appliedTags.join()) {
        await t.setAppliedTags(tags, 'wydarzenie');
      }
      await editStarter(t, post.content);
    },
    async archivePost(threadId, content) {
      const t = await threadOf(threadId);
      if (t.archived) await t.setArchived(false, 'wydarzenie');
      await editStarter(t, content);
      await t.setLocked(true, 'wydarzenie');
      await t.setArchived(true, 'wydarzenie');
    },
    async postExists(threadId) {
      try {
        return (await client.channels.fetch(threadId))?.isThread() ?? false;
      } catch (err) {
        if (isGone(err)) return false;
        throw err;
      }
    },
  };
}
