import type { Db } from '@studies/db';
import {
  type AnyThreadChannel,
  ChannelType,
  type Client,
  type DMChannel,
  Events,
  type ForumChannel,
  type Message,
  type NonThreadGuildBasedChannel,
} from 'discord.js';
import {
  type AttachmentInput,
  type IngestDeps,
  type IngestResult,
  ingestAttachment,
} from '../ingest.js';
import {
  findSubjectByChannel,
  resolveForum,
  softDeleteMessage,
  softDeleteMissingAttachments,
  softDeleteTopic,
  syncForumTags,
  upsertTopic,
} from '../sync.js';
import type { DiscordUser } from '../types.js';
import { toAttachmentInputs, toDiscordUser, toThreadInfo } from './map.js';
import { reactForResult } from './react.js';

export type HandlerDeps = IngestDeps & {
  ingest?: (d: IngestDeps, a: AttachmentInput) => Promise<IngestResult>;
};

async function guarded(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} handler failed:`, err);
  }
}

async function syncParentTags(db: Db, thread: AnyThreadChannel) {
  const parent = thread.parent;
  if (!parent || parent.type !== ChannelType.GuildForum) return;
  const subject = await findSubjectByChannel(db, parent.id);
  if (!subject) return;
  await syncForumTags(
    db,
    subject.id,
    (parent as ForumChannel).availableTags.map((t) => ({
      id: t.id,
      name: t.name,
    })),
  );
}

export function handleThreadCreate(
  deps: HandlerDeps,
  thread: AnyThreadChannel,
): Promise<void> {
  return guarded('threadCreate', async () => {
    const info = toThreadInfo(thread);
    if (!info) return;
    if (!(await resolveForum(deps.db, info.forumChannelId))) return;
    await syncParentTags(deps.db, thread);
    let owner: DiscordUser | null = null;
    try {
      const member = await thread.fetchOwner({ withMember: true });
      const user = member?.guildMember?.user ?? member?.user;
      if (user) owner = toDiscordUser(user, member?.guildMember);
    } catch {
      owner = null;
    }
    if (!owner && thread.ownerId) {
      try {
        owner = toDiscordUser(await thread.client.users.fetch(thread.ownerId));
      } catch {
        owner = null;
      }
    }
    await upsertTopic(deps.db, info, owner);
  });
}

export function handleThreadUpdate(
  deps: HandlerDeps,
  _old: AnyThreadChannel,
  thread: AnyThreadChannel,
): Promise<void> {
  return guarded('threadUpdate', async () => {
    const info = toThreadInfo(thread);
    if (!info) return;
    if (!(await resolveForum(deps.db, info.forumChannelId))) return;
    await syncParentTags(deps.db, thread);
    await upsertTopic(deps.db, info, null);
  });
}

export function handleMessageCreate(
  deps: HandlerDeps,
  message: Message,
): Promise<void> {
  return guarded('messageCreate', async () => {
    if (message.author?.bot) return;
    if (!message.channel.isThread()) return;
    if (message.attachments.size === 0) return;
    const inputs = toAttachmentInputs(message);
    const ingest = deps.ingest ?? ingestAttachment;
    const results: IngestResult[] = [];
    for (const input of inputs) results.push(await ingest(deps, input));
    await reactForResult(message, results);
  });
}

type RawPacket = { t?: string | null; d?: unknown };
type RawData = {
  id?: string;
  ids?: string[];
  attachments?: { id: string }[];
};

/**
 * Deletes/edits are handled from raw gateway packets: discord.js only emits
 * the cached events for entities still in its caches, which misses archived
 * (swept) threads and uncached messages.
 */
export function handleRawPacket(
  deps: HandlerDeps,
  packet: RawPacket,
): Promise<void> {
  return guarded(`raw ${packet.t ?? '?'}`, async () => {
    const d = (packet.d ?? {}) as RawData;
    switch (packet.t) {
      case 'THREAD_DELETE':
        if (d.id) await softDeleteTopic(deps.db, d.id);
        return;
      case 'MESSAGE_DELETE':
        if (d.id) await softDeleteMessage(deps.db, d.id);
        return;
      case 'MESSAGE_DELETE_BULK':
        for (const id of d.ids ?? []) await softDeleteMessage(deps.db, id);
        return;
      case 'MESSAGE_UPDATE':
        if (d.id && Array.isArray(d.attachments)) {
          await softDeleteMissingAttachments(
            deps.db,
            d.id,
            d.attachments.map((a) => a.id),
          );
        }
        return;
    }
  });
}

export function handleChannelUpdate(
  deps: HandlerDeps,
  _old: DMChannel | NonThreadGuildBasedChannel,
  channel: DMChannel | NonThreadGuildBasedChannel,
): Promise<void> {
  return guarded('channelUpdate', async () => {
    if (channel.type !== ChannelType.GuildForum) return;
    const subject = await findSubjectByChannel(deps.db, channel.id);
    if (!subject) return;
    await syncForumTags(
      deps.db,
      subject.id,
      channel.availableTags.map((t) => ({ id: t.id, name: t.name })),
    );
  });
}

export function registerEvents(client: Client, deps: HandlerDeps): void {
  client.on('threadCreate', (t) => void handleThreadCreate(deps, t));
  client.on('threadUpdate', (o, n) => void handleThreadUpdate(deps, o, n));
  client.on('messageCreate', (m) => void handleMessageCreate(deps, m));
  client.on(Events.Raw, (p) => void handleRawPacket(deps, p));
  client.on('channelUpdate', (o, n) => void handleChannelUpdate(deps, o, n));
}
