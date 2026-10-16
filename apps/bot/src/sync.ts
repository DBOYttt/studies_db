import {
  assignTopicHierarchy,
  type DbExecutor,
  getSetting,
  materials,
  subjects,
  tags,
  topics,
  topicTags,
  upsertUser,
} from '@studies/db';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { EVENTS_FORUM_SETTING } from './config.js';
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

/**
 * What a forum channel is for: a subject's forum, or the shared #wydarzenia
 * forum (subjectId null: topics there belong to no subject). Null: not ours.
 */
export async function resolveForum(
  db: DbExecutor,
  forumChannelId: string,
): Promise<{ subjectId: number | null } | null> {
  const subject = await findSubjectByChannel(db, forumChannelId);
  if (subject) return { subjectId: subject.id };
  if ((await getSetting(db, EVENTS_FORUM_SETTING)) === forumChannelId) {
    return { subjectId: null };
  }
  return null;
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
  const forum = await resolveForum(db, t.forumChannelId);
  if (!forum) return null;
  const subjectId = forum.subjectId;
  if (t.ownerIsBot) {
    // /setup links its own threads; a bot thread alone never makes a topic.
    const [linked] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.discordThreadId, t.threadId))
      .limit(1);
    if (!linked) return null;
  }
  const createdBy = owner && !t.ownerIsBot ? await upsertUser(db, owner) : null;
  await db
    .insert(topics)
    .values({
      subjectId,
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
  // Topics without a subject have no tags rows (tags belong to subjects).
  if (subjectId === null) return row.id;
  const wanted =
    t.tagIds.length > 0
      ? await db
          .select({
            id: tags.id,
            name: tags.name,
            discordId: tags.discordTagId,
          })
          .from(tags)
          .where(
            and(
              eq(tags.subjectId, subjectId),
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
  const nameByDiscordId = new Map(wanted.map((w) => [w.discordId, w.name]));
  const orderedNames = t.tagIds.flatMap((id) => {
    const n = nameByDiscordId.get(id);
    return n === undefined ? [] : [n];
  });
  await assignTopicHierarchy(db, row.id, subjectId, orderedNames);
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
