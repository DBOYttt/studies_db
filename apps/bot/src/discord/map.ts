import {
  type AnyThreadChannel,
  type APIGuildMember,
  type APIInteractionGuildMember,
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
    ownerIsBot:
      thread.ownerId != null && thread.ownerId === thread.client?.user?.id,
    tagIds: [...(thread.appliedTags ?? [])],
  };
}

/** Server nickname of a cached member (`nickname`) or a raw API one (`nick`). */
type AnyMember = GuildMember | APIInteractionGuildMember | APIGuildMember;

const nickOf = (m: AnyMember | null | undefined) =>
  !m ? null : 'nickname' in m ? m.nickname : (m.nick ?? null);

export function toDiscordUser(
  user: User,
  member?: AnyMember | null,
): DiscordUser {
  return {
    discordUserId: user.id,
    displayName: nickOf(member) ?? user.globalName ?? user.username,
    avatarUrl: user.displayAvatarURL(),
  };
}

export function toAttachmentInputs(message: Message): AttachmentInput[] {
  const channel = message.channel;
  if (!channel.isThread()) return [];
  const thread = toThreadInfo(channel);
  if (!thread) return [];
  const uploader = toDiscordUser(message.author, message.member);
  // In a forum post the starter message shares the thread's id, and its
  // author is the thread owner.
  const threadOwner = message.id === channel.id ? uploader : null;
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
    threadOwner,
  }));
}

export async function fetchAttachmentBody(
  url: string,
): Promise<ReadableStream<Uint8Array>> {
  const controller = new AbortController();
  const headerTimer = setTimeout(
    () => controller.abort(),
    ATTACHMENT_IDLE_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(headerTimer);
  }
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  return withIdleTimeout(res.body, ATTACHMENT_IDLE_TIMEOUT_MS, () =>
    controller.abort(),
  );
}

export const ATTACHMENT_IDLE_TIMEOUT_MS = 60_000;

/**
 * Wraps a stream so it errors (and `onTimeout` runs) if no chunk arrives
 * within `ms`. A slow-but-progressing body is never aborted.
 */
export function withIdleTimeout(
  source: ReadableStream<Uint8Array>,
  ms: number,
  onTimeout?: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`download stalled: no data for ${ms} ms`));
        }, ms);
      });
      try {
        const r = await Promise.race([reader.read(), timeout]);
        if (r.done) controller.close();
        else controller.enqueue(r.value);
      } catch (err) {
        reader.cancel().catch(() => {});
        controller.error(err);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
