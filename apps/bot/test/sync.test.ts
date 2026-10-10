import {
  type Db,
  insertMaterial,
  materials,
  subjects,
  tags,
  topics,
  topicTags,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  softDeleteMessage,
  softDeleteMissingAttachments,
  softDeleteTopic,
  syncForumTags,
  upsertTopic,
} from '../src/sync.js';

let db: Db;
let subjectId: number;
const owner = { discordUserId: 'u1', displayName: 'Ann', avatarUrl: null };

beforeAll(async () => {
  db = await resetTestDb();
  const [r] = await db.insert(subjects).values({
    name: 'Algebra',
    code: 'ALG',
    semester: 1,
    ects: 5,
    discordChannelId: 'forum1',
  });
  subjectId = r.insertId;
  await syncForumTags(db, subjectId, [
    { id: 'tagA', name: 'A' },
    { id: 'tagB', name: 'B' },
    { id: 'tagC', name: 'C' },
  ]);
});
afterAll(async () => {
  await closeTestDb(db);
});

const thread = (over = {}) => ({
  threadId: 't1',
  forumChannelId: 'forum1',
  title: 'First',
  ownerDiscordId: 'u1',
  tagIds: ['tagA', 'tagB'],
  ...over,
});

async function tagNames(topicId: number) {
  const rows = await db
    .select({ n: tags.name })
    .from(topicTags)
    .innerJoin(tags, eq(tags.id, topicTags.tagId))
    .where(eq(topicTags.topicId, topicId));
  return rows.map((r) => r.n).sort();
}

describe('sync', () => {
  it('returns null for unlinked forum', async () => {
    expect(
      await upsertTopic(db, thread({ forumChannelId: 'nope' }), owner),
    ).toBeNull();
  });

  it('creates then updates topic and replaces tags', async () => {
    const id = await upsertTopic(db, thread(), owner);
    expect(id).not.toBeNull();
    expect(await tagNames(id as number)).toEqual(['A', 'B']);
    const id2 = await upsertTopic(
      db,
      thread({ title: 'Second', tagIds: ['tagC', 'missing'] }),
      null,
    );
    expect(id2).toBe(id);
    const [t] = await db
      .select()
      .from(topics)
      .where(eq(topics.id, id as number));
    expect(t?.title).toBe('Second');
    expect(t?.createdBy).not.toBeNull();
    expect(await tagNames(id as number)).toEqual(['C']);
  });

  it('syncForumTags removes deleted tags and their links', async () => {
    const id = (await upsertTopic(
      db,
      thread({ tagIds: ['tagA', 'tagC'] }),
      owner,
    )) as number;
    await syncForumTags(db, subjectId, [
      { id: 'tagA', name: 'A2' },
      { id: 'tagB', name: 'B' },
    ]);
    expect(await tagNames(id)).toEqual(['A2']);
    const all = await db
      .select()
      .from(tags)
      .where(eq(tags.subjectId, subjectId));
    expect(all.map((x) => x.name).sort()).toEqual(['A2', 'B']);
  });

  it('soft deletes topic and materials, and attachments selectively', async () => {
    const id = (await upsertTopic(
      db,
      thread({ threadId: 't2' }),
      owner,
    )) as number;
    const uid = await upsertUser(db, owner);
    const mk = (att: string, msg: string) =>
      insertMaterial(
        db,
        {
          topicId: id,
          uploaderId: uid,
          discordMessageId: msg,
          discordAttachmentId: att,
          originalFilename: `${att}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1,
          sha256: 'a'.repeat(64),
          storagePath: `p/${att}`,
          previewKind: 'none',
        },
        [],
      );
    await mk('a1', 'm1');
    await mk('a2', 'm1');
    await mk('a3', 'm2');
    await softDeleteMissingAttachments(db, 'm1', ['a1']);
    const del = async () =>
      (await db.select().from(materials))
        .filter((m) => m.deletedAt)
        .map((m) => m.discordAttachmentId)
        .sort();
    expect(await del()).toEqual(['a2']);
    await softDeleteMessage(db, 'm2');
    expect(await del()).toEqual(['a2', 'a3']);
    await softDeleteTopic(db, 't2');
    expect(await del()).toEqual(['a1', 'a2', 'a3']);
    const [t] = await db.select().from(topics).where(eq(topics.id, id));
    expect(t?.deletedAt).not.toBeNull();
  });
});

describe('upsertTopic concurrency', () => {
  it('concurrent upserts of the same new thread do not throw', async () => {
    for (let i = 0; i < 15; i++) {
      const t = thread({ threadId: `race${i}` });
      const [a, b] = await Promise.all([
        upsertTopic(db, t, owner),
        upsertTopic(db, t, null),
      ]);
      expect(a).toBe(b);
      expect(await tagNames(a as number)).toHaveLength(2);
    }
  });
});
