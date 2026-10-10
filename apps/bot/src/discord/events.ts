import type { Db } from '@studies/db';
import {
  type AnyThreadChannel,
  ChannelType,
  type Client,
  type DMChannel,
  type ForumChannel,
  type Message,
  type NonThreadGuildBasedChannel,
  type PartialMessage,
} from 'discord.js';
import {
  type AttachmentInput,
  type IngestDeps,
  type IngestResult,
  ingestAttachment,
} from '../ingest.js';
import {
  findSubjectByChannel,
  softDeleteMessage,
  softDeleteMissingAttachments,
  softDeleteTopic,
  syncForumTags,
  upsertTopic,
} from '../sync.js';
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
    if (!(await findSubjectByChannel(deps.db, info.forumChannelId))) return;
    await syncParentTags(deps.db, thread);
    let owner = null;
    try {
      const member = await thread.fetchOwner();
      if (member?.user) owner = toDiscordUser(member.user, member.guildMember);
    } catch {
      owner = null;
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
    if (!(await findSubjectByChannel(deps.db, info.forumChannelId))) return;
    await syncParentTags(deps.db, thread);
    await upsertTopic(deps.db, info, null);
  });
}

export function handleThreadDelete(
  deps: HandlerDeps,
  thread: { id: string },
): Promise<void> {
  // No-op when the thread was never stored (unlinked forum).
  return guarded('threadDelete', () => softDeleteTopic(deps.db, thread.id));
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

export function handleMessageUpdate(
  deps: HandlerDeps,
  _old: Message | PartialMessage,
  next: Message | PartialMessage,
): Promise<void> {
  return guarded('messageUpdate', async () => {
    let msg = next;
    if (msg.partial) {
      try {
        msg = await msg.fetch();
      } catch {
        return;
      }
    }
    if (!msg.channel.isThread()) return;
    await softDeleteMissingAttachments(deps.db, msg.id, [
      ...msg.attachments.keys(),
    ]);
  });
}

export function handleMessageDelete(
  deps: HandlerDeps,
  message: { id: string },
): Promise<void> {
  return guarded('messageDelete', () => softDeleteMessage(deps.db, message.id));
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
  client.on('threadDelete', (t) => void handleThreadDelete(deps, t));
  client.on('messageCreate', (m) => void handleMessageCreate(deps, m));
  client.on('messageUpdate', (o, n) => void handleMessageUpdate(deps, o, n));
  client.on('messageDelete', (m) => void handleMessageDelete(deps, m));
  client.on('channelUpdate', (o, n) => void handleChannelUpdate(deps, o, n));
}
