// discord.js side of /setup: a snapshot of the guild and the SetupGuild
// operations. Kept thin; the logic lives in plan.ts / apply.ts.
import {
  type AnyThreadChannel,
  ChannelFlags,
  ChannelType,
  type ForumChannel,
  type Guild,
  PermissionFlagsBits,
} from 'discord.js';
import type { SetupGuild } from './apply.js';
import { INFO_TITLE } from './info.js';
import type {
  ForumSnapshot,
  GuildSnapshot,
  InfoPostSnapshot,
} from './types.js';

export async function snapshotGuild(
  guild: Guild,
  callerId: string,
): Promise<GuildSnapshot> {
  const channels = [...(await guild.channels.fetch()).values()].filter(
    (c) => c !== null,
  );
  const roles = await guild.roles.fetch();
  const member = await guild.members.fetch(callerId);
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const botId = guild.client.user.id;
  const forums: ForumSnapshot[] = [];
  const unreadableForums: GuildSnapshot['unreadableForums'] = [];
  for (const c of channels) {
    if (c.type !== ChannelType.GuildForum) continue;
    const readable = c
      .permissionsFor(me)
      ?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ]);
    try {
      if (!readable) throw new Error('missing permissions');
      forums.push(await forumSnapshot(c, botId));
    } catch (err) {
      if (readable) console.error(`/setup: cannot read forum ${c.id}`, err);
      unreadableForums.push({ id: c.id, name: c.name });
    }
  }
  return {
    categories: channels
      .filter((c) => c.type === ChannelType.GuildCategory)
      .map((c) => ({ id: c.id, name: c.name })),
    forums,
    roles: [...roles.values()].map((r) => ({ id: r.id, name: r.name })),
    callerId,
    callerRoleIds: [...member.roles.cache.keys()],
    unreadableForums,
  };
}

async function forumSnapshot(
  c: ForumChannel,
  botId: string,
): Promise<ForumSnapshot> {
  const threads = await forumThreads(c);
  return {
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    tags: c.availableTags.map((t) => ({ id: t.id, name: t.name })),
    topic: c.topic,
    threadIds: threads.map((t) => t.id),
    infoPost: await infoPostOf(threads, botId),
    pinnedThreadId:
      threads.find((t) => t.flags.has(ChannelFlags.Pinned))?.id ?? null,
  };
}

/** All threads of a forum: active plus every archived page. */
async function forumThreads(f: ForumChannel): Promise<AnyThreadChannel[]> {
  const active = await f.threads.fetchActive();
  const archived: AnyThreadChannel[] = [];
  let before: number | undefined;
  for (;;) {
    const page = await f.threads.fetchArchived({
      type: 'public',
      limit: 100,
      before,
    });
    archived.push(...page.threads.values());
    const stamps = [...page.threads.values()]
      .map((t) => t.archiveTimestamp)
      .filter((x): x is number => x !== null);
    if (!page.hasMore || stamps.length === 0) break;
    const next = Math.min(...stamps);
    if (before !== undefined && next >= before) break;
    before = next;
  }
  const byId = new Map<string, AnyThreadChannel>();
  for (const t of [...active.threads.values(), ...archived]) {
    if (t.parentId === f.id) byId.set(t.id, t);
  }
  return [...byId.values()];
}

async function infoPostOf(
  threads: AnyThreadChannel[],
  botId: string,
): Promise<InfoPostSnapshot | null> {
  const t = threads.find((x) => x.ownerId === botId && x.name === INFO_TITLE);
  if (!t) return null;
  const starter = await t.fetchStarterMessage().catch(() => null);
  if (!starter) return null;
  return {
    threadId: t.id,
    messageId: starter.id,
    content: starter.content,
  };
}

async function forum(guild: Guild, id: string): Promise<ForumChannel> {
  const c = await guild.channels.fetch(id);
  if (c?.type !== ChannelType.GuildForum)
    throw new Error(`${id} nie jest forum`);
  return c;
}

async function thread(guild: Guild, id: string): Promise<AnyThreadChannel> {
  const c = await guild.channels.fetch(id);
  if (!c?.isThread()) throw new Error(`${id} nie jest wątkiem`);
  return c;
}

const tagList = (c: ForumChannel) =>
  c.availableTags.map((t) => ({ id: t.id, name: t.name }));

export function discordSetupGuild(guild: Guild): SetupGuild {
  return {
    async createRole(name) {
      return (await guild.roles.create({ name, reason: '/setup' })).id;
    },
    async addRoleToMember(userId, roleId) {
      await guild.members.addRole({
        user: userId,
        role: roleId,
        reason: '/setup',
      });
    },
    async createCategory(name) {
      return (
        await guild.channels.create({
          name,
          type: ChannelType.GuildCategory,
          reason: '/setup',
        })
      ).id;
    },
    async createForum({ name, parentId, tags, topic }) {
      const c = await guild.channels.create({
        name,
        type: ChannelType.GuildForum,
        parent: parentId,
        topic,
        availableTags: tags.map((t) => ({ name: t })),
        reason: '/setup',
      });
      return { id: c.id, tags: tagList(c) };
    },
    async addForumTags(channelId, names) {
      const c = await forum(guild, channelId);
      const updated = await c.setAvailableTags(
        [...c.availableTags, ...names.map((name) => ({ name }))],
        '/setup',
      );
      return tagList(updated);
    },
    async setForumTopic(channelId, topic) {
      await (await forum(guild, channelId)).setTopic(topic, '/setup');
    },
    async createThread(forumId, { name, tagIds, content, files }) {
      const thread = await (await forum(guild, forumId)).threads.create({
        name,
        appliedTags: tagIds,
        message: {
          content,
          files: files.map((f) => ({ attachment: f.path, name: f.name })),
          allowedMentions: { parse: [] },
        },
        reason: '/setup',
      });
      const starter = await thread.fetchStarterMessage();
      if (!starter) throw new Error(`brak wiadomości startowej w ${thread.id}`);
      return {
        threadId: thread.id,
        messageId: starter.id,
        attachmentIds: [...starter.attachments.keys()],
      };
    },
    async sendMessage(threadId, { content, files }) {
      const msg = await (await thread(guild, threadId)).send({
        content,
        files: files.map((f) => ({ attachment: f.path, name: f.name })),
        allowedMentions: { parse: [] },
      });
      return { messageId: msg.id, attachmentIds: [...msg.attachments.keys()] };
    },
    async editMessage(threadId, messageId, content) {
      const t = await thread(guild, threadId);
      await (await t.messages.fetch(messageId)).edit({ content });
    },
    async pinThread(threadId) {
      await (await thread(guild, threadId)).pin('/setup');
    },
  };
}
