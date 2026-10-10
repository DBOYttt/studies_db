import {
  type DbExecutor,
  materials,
  subjects,
  tags,
  topics,
  topicTags,
  upsertUser,
} from '@studies/db';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { DiscordUser, ForumTag, ThreadInfo } from './types.js';

export async function findSubjectByChannel(
  db: DbExecutor,
  forumChannelId: string,
): Promise<{ id: number } | null> {
  const [row] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.discordChannelId, forumChannelId))
    .limit(1);
  return row ?? null;
}

export async function syncForumTags(
  db: DbExecutor,
  subjectId: number,
  forumTags: ForumTag[],
): Promise<void> {
  for (const t of forumTags) {
    await db
      .insert(tags)
      .values({ subjectId, name: t.name, discordTagId: t.id })
      .onDuplicateKeyUpdate({ set: { name: t.name } });
  }
  const keep = forumTags.map((t) => t.id);
  // topic_tags rows cascade on tag delete.
  await db
    .delete(tags)
    .where(
      keep.length > 0
        ? and(
            eq(tags.subjectId, subjectId),
            notInArray(tags.discordTagId, keep),
          )
        : eq(tags.subjectId, subjectId),
    );
}

export async function upsertTopic(
  db: DbExecutor,
  t: ThreadInfo,
  owner: DiscordUser | null,
): Promise<number | null> {
  const subject = await findSubjectByChannel(db, t.forumChannelId);
  if (!subject) return null;
  const createdBy = owner ? await upsertUser(db, owner) : null;
  await db
    .insert(topics)
    .values({
      subjectId: subject.id,
      title: t.title,
      discordThreadId: t.threadId,
      createdBy,
    })
    .onDuplicateKeyUpdate({
      set: {
        title: t.title,
        deletedAt: null,
        ...(createdBy !== null ? { createdBy } : {}),
      },
    });
  const [row] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.discordThreadId, t.threadId))
    .limit(1);
  if (!row) throw new Error(`topic ${t.threadId} missing after upsert`);
  const wanted =
    t.tagIds.length > 0
      ? await db
          .select({ id: tags.id })
          .from(tags)
          .where(
            and(
              eq(tags.subjectId, subject.id),
              inArray(tags.discordTagId, t.tagIds),
            ),
          )
      : [];
  const wantedIds = wanted.map((w) => w.id);
  // Idempotent replacement (safe under concurrent upserts): remove only tags
  // not wanted, then insert wanted ones ignoring existing rows.
  await db
    .delete(topicTags)
    .where(
      wantedIds.length > 0
        ? and(
            eq(topicTags.topicId, row.id),
            notInArray(topicTags.tagId, wantedIds),
          )
        : eq(topicTags.topicId, row.id),
    );
  if (wantedIds.length > 0) {
    await db
      .insert(topicTags)
      .values(wantedIds.map((tagId) => ({ topicId: row.id, tagId })))
      .onDuplicateKeyUpdate({ set: { topicId: sql`topic_id` } });
  }
  return row.id;
}

export async function softDeleteTopic(
  db: DbExecutor,
  threadId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(eq(topics.discordThreadId, threadId))
    .limit(1);
  if (!row) return;
  await db
    .update(topics)
    .set({ deletedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(topics.id, row.id), isNull(topics.deletedAt)));
  await db
    .update(materials)
    .set({ deletedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(materials.topicId, row.id), isNull(materials.deletedAt)));
}

export async function softDeleteMessage(
  db: DbExecutor,
  messageId: string,
): Promise<void> {
  await db
    .update(materials)
    .set({ deletedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(materials.discordMessageId, messageId),
        isNull(materials.deletedAt),
      ),
    );
}

export async function softDeleteMissingAttachments(
  db: DbExecutor,
  messageId: string,
  keepAttachmentIds: string[],
): Promise<void> {
  const conds = [
    eq(materials.discordMessageId, messageId),
    isNull(materials.deletedAt),
  ];
  if (keepAttachmentIds.length > 0)
    conds.push(notInArray(materials.discordAttachmentId, keepAttachmentIds));
  await db
    .update(materials)
    .set({ deletedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(...conds));
}
