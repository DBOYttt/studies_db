// discord.js side of /setup: a snapshot of the guild and the SetupGuild
// operations. Kept thin; the logic lives in plan.ts / apply.ts.
import {
  type AnyThreadChannel,
  ChannelFlags,
  ChannelType,
  DiscordAPIError,
  type ForumChannel,
  type Guild,
  type Message,
  OverwriteType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type TextChannel,
} from 'discord.js';
import type { SetupGuild } from './apply.js';
import { EVENTS_INFO_TITLE, INFO_TITLE, LEGACY_INFO_TITLES } from './info.js';
import type {
  ForumSnapshot,
  GuildSnapshot,
  InfoPostSnapshot,
} from './types.js';

/** The live guild; the stored panel ids come from bot_settings (load.ts). */
export async function snapshotGuild(
  guild: Guild,
  callerId: string,
): Promise<Omit<GuildSnapshot, 'panelChannels' | 'panelMessages'>> {
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
    textChannels: channels
      .filter((c) => c.type === ChannelType.GuildText)
      .map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        everyoneCanView:
          c.permissionsFor(guild.roles.everyone)?.has(ViewChannel) ?? false,
        viewRoleIds: [...c.permissionOverwrites.cache.values()]
          .filter(
            (o) => o.type === OverwriteType.Role && o.allow.has(ViewChannel),
          )
          .map((o) => o.id),
      })),
  };
}

async function forumSnapshot(
  c: ForumChannel,
  botId: string,
): Promise<ForumSnapshot> {
  const threads = await forumThreads(c);
  const botThreadMessageIds: Record<string, string[]> = {};
  for (const t of threads) {
    if (t.ownerId === botId) botThreadMessageIds[t.id] = await messageIds(t);
  }
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
    botThreadMessageIds,
  };
}

/** Every message id in a thread, paging back 100 at a time. */
async function messageIds(t: AnyThreadChannel): Promise<string[]> {
  const ids: string[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await t.messages.fetch({ limit: 100, before, cache: false });
    const keys = [...page.keys()];
    ids.push(...keys);
    if (keys.length < 100) return ids;
    before = keys.reduce((a, b) => (BigInt(a) < BigInt(b) ? a : b));
  }
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
  const t = threads.find(
    (x) =>
      x.ownerId === botId &&
      (x.name === INFO_TITLE ||
        x.name === EVENTS_INFO_TITLE ||
        LEGACY_INFO_TITLES.includes(x.name)),
  );
  if (!t) return null;
  const starter = await t.fetchStarterMessage().catch(() => null);
  if (!starter) return null;
  return {
    threadId: t.id,
    name: t.name,
    messageId: starter.id,
    content: starter.content,
  };
}

async function forum(guild: Guild, id: string): Promise<ForumChannel> {
  const c = await guild.channels.fetch(id);
  if (c?.type !== ChannelType.GuildForum)
    throw new Error(`${id} is not a forum`);
  return c;
}

async function thread(guild: Guild, id: string): Promise<AnyThreadChannel> {
  const c = await guild.channels.fetch(id);
  if (!c?.isThread()) throw new Error(`${id} is not a thread`);
  return c;
}

/** Archived threads reject edits and pins; reopen them first. */
async function openThread(guild: Guild, id: string): Promise<AnyThreadChannel> {
  const t = await thread(guild, id);
  if (t.archived) await t.setArchived(false, '/setup');
  return t;
}

async function textChannel(guild: Guild, id: string): Promise<TextChannel> {
  const c = await guild.channels.fetch(id);
  if (c?.type !== ChannelType.GuildText)
    throw new Error(`${id} is not a text channel`);
  return c;
}

/** Pins a panel message; false (logged) when Discord refuses. */
async function pin(msg: Message): Promise<boolean> {
  try {
    await msg.pin('/setup');
    return true;
  } catch (err) {
    console.error(`/setup: cannot pin the panel in ${msg.channelId}`, err);
    return false;
  }
}

/** The panel message or its channel was deleted. */
const isGone = (err: unknown) =>
  err instanceof DiscordAPIError &&
  (err.code === RESTJSONErrorCodes.UnknownMessage ||
    err.code === RESTJSONErrorCodes.UnknownChannel);

const {
  AddReactions,
  CreatePrivateThreads,
  CreatePublicThreads,
  PinMessages,
  ReadMessageHistory,
  SendMessages,
  SendMessagesInThreads,
  ViewChannel,
} = PermissionFlagsBits;

/**
 * #panel: everyone reads, only the bot posts (no reactions or threads either).
 * #admin-panel: only the admin role and the bot see it, and the role cannot
 * post. The bot pins the panel (Pin Messages; Manage Messages no longer
 * covers pinning).
 */
function panelOverwrites(
  everyoneId: string,
  botId: string,
  o: { private: boolean; adminRoleId: string | null },
) {
  const bot = {
    id: botId,
    type: OverwriteType.Member,
    allow: [ViewChannel, SendMessages, PinMessages],
  };
  if (!o.private) {
    return [
      {
        id: everyoneId,
        type: OverwriteType.Role,
        allow: [ViewChannel, ReadMessageHistory],
        deny: [
          SendMessages,
          AddReactions,
          CreatePublicThreads,
          CreatePrivateThreads,
          SendMessagesInThreads,
        ],
      },
      bot,
    ];
  }
  if (o.adminRoleId === null) throw new Error('no admin role');
  return [
    { id: everyoneId, type: OverwriteType.Role, deny: [ViewChannel] },
    adminOverwrite(o.adminRoleId),
    bot,
  ];
}

/** #admin-panel: the admin role reads the panel but cannot post. */
const adminOverwrite = (roleId: string) => ({
  id: roleId,
  type: OverwriteType.Role,
  allow: [ViewChannel, ReadMessageHistory],
  deny: [SendMessages],
});

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
      // The thread exists now: never throw from here on. A forum post's
      // starter message has the thread's id; attachment ids are best effort
      // (apply.ts leaves the files unlinked if they don't match).
      const starter = await thread.fetchStarterMessage().catch(() => null);
      return {
        threadId: thread.id,
        messageId: thread.id,
        attachmentIds: starter ? [...starter.attachments.keys()] : [],
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
    async renameThread(threadId, name) {
      await (await openThread(guild, threadId)).setName(name, '/setup');
    },
    async editMessage(threadId, messageId, content) {
      const t = await openThread(guild, threadId);
      await (await t.messages.fetch(messageId)).edit({ content });
    },
    async pinThread(threadId) {
      await (await openThread(guild, threadId)).pin('/setup');
    },
    async createTextChannel({ name, parentId, ...o }) {
      const c = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: parentId,
        permissionOverwrites: panelOverwrites(
          guild.roles.everyone.id,
          guild.client.user.id,
          o,
        ),
        reason: '/setup',
      });
      return c.id;
    },
    async syncAdminPanelPerms(channelId, roleId) {
      // Touch only the overwrites that change: re-sending the rest could hit
      // permissions the bot cannot grant.
      const c = await textChannel(guild, channelId);
      const roles = await guild.roles.fetch();
      for (const o of [...c.permissionOverwrites.cache.values()]) {
        if (o.type === OverwriteType.Role && !roles.has(o.id)) {
          await c.permissionOverwrites.delete(o.id, '/setup');
        }
      }
      await c.permissionOverwrites.edit(
        roleId,
        { ViewChannel: true, ReadMessageHistory: true, SendMessages: false },
        { type: OverwriteType.Role, reason: '/setup' },
      );
    },
    async postPanel(channelId, view) {
      const msg = await (await textChannel(guild, channelId)).send({
        components: view.components,
        flags: view.flags,
        allowedMentions: { parse: [] },
      });
      // The message exists now: never throw, or a re-run would post it again.
      return { id: msg.id, pinned: await pin(msg) };
    },
    async editPanel(channelId, messageId, view) {
      let msg: Message;
      try {
        const c = await textChannel(guild, channelId);
        msg = await c.messages.fetch(messageId);
        await msg.edit({ components: view.components, flags: view.flags });
      } catch (err) {
        if (isGone(err)) return false;
        throw err;
      }
      return { pinned: msg.pinned || (await pin(msg)) };
    },
  };
}
