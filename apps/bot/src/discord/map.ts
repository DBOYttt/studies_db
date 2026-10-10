import {
  type AnyThreadChannel,
  ChannelType,
  type GuildMember,
  type Message,
  type User,
} from 'discord.js';
import type { AttachmentInput } from '../ingest.js';
import type { DiscordUser, ThreadInfo } from '../types.js';

export function toThreadInfo(thread: AnyThreadChannel): ThreadInfo | null {
  const parent = thread.parent;
  if (!parent || parent.type !== ChannelType.GuildForum) return null;
  return {
    threadId: thread.id,
    forumChannelId: parent.id,
    title: thread.name,
    ownerDiscordId: thread.ownerId ?? null,
    tagIds: [...(thread.appliedTags ?? [])],
  };
}

export function toDiscordUser(
  user: User,
  member?: GuildMember | null,
): DiscordUser {
  return {
    discordUserId: user.id,
    displayName: member?.nickname ?? user.globalName ?? user.username,
    avatarUrl: user.displayAvatarURL(),
  };
}

export function toAttachmentInputs(message: Message): AttachmentInput[] {
  const channel = message.channel;
  if (!channel.isThread()) return [];
  const thread = toThreadInfo(channel);
  if (!thread) return [];
  const uploader = toDiscordUser(message.author, message.member);
  return [...message.attachments.values()].map((a) => ({
    attachmentId: a.id,
    messageId: message.id,
    url: a.url,
    filename: a.name,
    contentType: a.contentType ?? null,
    size: a.size,
    postedAt: message.createdAt,
    uploader,
    thread,
    threadOwner: null,
  }));
}

export async function fetchAttachmentBody(
  url: string,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  return res.body;
}
