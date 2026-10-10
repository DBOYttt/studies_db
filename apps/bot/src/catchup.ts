import { botState, subjects } from '@studies/db';
import { ChannelType, type Client, type Message } from 'discord.js';
import { eq } from 'drizzle-orm';
import { toAttachmentInputs, toThreadInfo } from './discord/map.js';
import {
  type AttachmentInput,
  type IngestDeps,
  ingestAttachment,
} from './ingest.js';
import { syncForumTags, upsertTopic } from './sync.js';
import type { ForumTag, ThreadInfo } from './types.js';

export type ForumSource = {
  listThreads(forumChannelId: string): Promise<ThreadInfo[]>;
  listMessages(
    threadId: string,
    after: Date | null,
  ): AsyncIterable<{ messageId: string; attachments: AttachmentInput[] }>;
  listTags(forumChannelId: string): Promise<ForumTag[]>;
};

export type CatchUpResult = { topics: number; created: number; failed: number };

const MARGIN_MS = 5 * 60_000;

export async function catchUp(
  deps: IngestDeps,
  source: ForumSource,
  opts: { ignoreWatermark: boolean; now?: Date },
): Promise<CatchUpResult> {
  const now = opts.now ?? new Date();
  const { db } = deps;
  const result: CatchUpResult = { topics: 0, created: 0, failed: 0 };
  const rows = await db.select().from(subjects);
  for (const subject of rows) {
    if (!subject.discordChannelId) continue;
    let subjectFailed = 0;
    try {
      const [state] = await db
        .select()
        .from(botState)
        .where(eq(botState.subjectId, subject.id));
      const after = opts.ignoreWatermark ? null : (state?.lastSyncedAt ?? null);
      await syncForumTags(
        db,
        subject.id,
        await source.listTags(subject.discordChannelId),
      );
      const threads = await source.listThreads(subject.discordChannelId);
      for (const t of threads) {
        await upsertTopic(db, t, null);
        result.topics++;
        for await (const msg of source.listMessages(t.threadId, after)) {
          for (const a of msg.attachments) {
            const r = await ingestAttachment(deps, a);
            if (r === 'created' || r === 'duplicate') result.created++;
            else if (r === 'failed') subjectFailed++;
          }
        }
      }
    } catch (err) {
      console.error(`catch-up failed for subject ${subject.id}`, err);
      subjectFailed++;
    }
    result.failed += subjectFailed;
    if (subjectFailed === 0) {
      const lastSyncedAt = new Date(now.getTime() - MARGIN_MS);
      await db
        .insert(botState)
        .values({ subjectId: subject.id, lastSyncedAt })
        .onDuplicateKeyUpdate({ set: { lastSyncedAt } });
    }
  }
  return result;
}

export function discordForumSource(client: Client): ForumSource {
  const forumOf = async (id: string) => {
    const ch = await client.channels.fetch(id);
    if (!ch || ch.type !== ChannelType.GuildForum) {
      throw new Error(`channel ${id} is not an accessible forum`);
    }
    return ch;
  };
  return {
    async listTags(forumChannelId) {
      const forum = await forumOf(forumChannelId);
      return forum.availableTags.map((t) => ({ id: t.id, name: t.name }));
    },
    async listThreads(forumChannelId) {
      const forum = await forumOf(forumChannelId);
      const active = await forum.threads.fetchActive();
      const archived = await forum.threads.fetchArchived({ fetchAll: true });
      const byId = new Map<string, ThreadInfo>();
      for (const th of [
        ...active.threads.values(),
        ...archived.threads.values(),
      ]) {
        if (th.parentId !== forumChannelId) continue;
        const info = toThreadInfo(th);
        if (info) byId.set(info.threadId, info);
      }
      return [...byId.values()];
    },
    async *listMessages(threadId, after) {
      const ch = await client.channels.fetch(threadId);
      if (!ch?.isThread()) return;
      let before: string | undefined;
      for (;;) {
        const page = await ch.messages.fetch({ limit: 100, before });
        if (page.size === 0) return;
        let reachedOld = false;
        for (const m of page.values() as IterableIterator<Message>) {
          if (after && m.createdAt <= after) {
            reachedOld = true;
            continue;
          }
          if (m.author.bot) continue;
          const attachments = toAttachmentInputs(m);
          if (attachments.length > 0) yield { messageId: m.id, attachments };
        }
        if (reachedOld || page.size < 100) return;
        before = page.lastKey();
      }
    },
  };
}
