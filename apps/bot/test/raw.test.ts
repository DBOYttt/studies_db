import {
  type Db,
  insertMaterial,
  materials,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { ChannelType } from 'discord.js';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRawPacket, handleThreadCreate } from '../src/discord/events.js';
import { upsertTopic } from '../src/sync.js';

let db: Db;
const deps = () => ({ db, storageDir: '', fetchBody: vi.fn() });
const user = { discordUserId: 'u1', displayName: 'Ann', avatarUrl: null };

beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  await db.insert(subjects).values({
    name: 'Algebra',
    code: 'ALG',
    semester: 1,
    ects: 5,
    discordChannelId: 'forum1',
  });
  const topicId = (await upsertTopic(
    db,
    {
      threadId: 't1',
      forumChannelId: 'forum1',
      title: 'T',
      ownerDiscordId: 'u1',
      tagIds: [],
    },
    user,
  )) as number;
  const uploaderId = await upsertUser(db, user);
  for (const [msg, att] of [
    ['m1', 'a1'],
    ['m1', 'a2'],
    ['m2', 'a3'],
  ] as const) {
    await insertMaterial(
      db,
      {
        topicId,
        uploaderId,
        discordMessageId: msg,
        discordAttachmentId: att,
        originalFilename: `${att}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: att.padEnd(64, '0'),
        storagePath: att,
        previewKind: 'none',
      },
      [],
    );
  }
});
afterAll(async () => {
  await closeTestDb(db);
});

const deleted = async () =>
  (
    await db
      .select()
      .from(materials)
      .orderBy(asc(materials.discordAttachmentId))
  )
    .filter((m) => m.deletedAt)
    .map((m) => m.discordAttachmentId);

describe('handleRawPacket', () => {
  it('THREAD_DELETE soft-deletes topic and materials', async () => {
    await handleRawPacket(deps(), { t: 'THREAD_DELETE', d: { id: 't1' } });
    const [t] = await db
      .select()
      .from(topics)
      .where(eq(topics.discordThreadId, 't1'));
    expect(t?.deletedAt).not.toBeNull();
    expect(await deleted()).toEqual(['a1', 'a2', 'a3']);
  });
  it('MESSAGE_DELETE soft-deletes that message only', async () => {
    await handleRawPacket(deps(), { t: 'MESSAGE_DELETE', d: { id: 'm1' } });
    expect(await deleted()).toEqual(['a1', 'a2']);
  });
  it('MESSAGE_DELETE_BULK soft-deletes each id', async () => {
    await handleRawPacket(deps(), {
      t: 'MESSAGE_DELETE_BULK',
      d: { ids: ['m1', 'm2'] },
    });
    expect(await deleted()).toEqual(['a1', 'a2', 'a3']);
  });
  it('MESSAGE_UPDATE soft-deletes only removed attachments', async () => {
    await handleRawPacket(deps(), {
      t: 'MESSAGE_UPDATE',
      d: { id: 'm1', attachments: [{ id: 'a1' }] },
    });
    expect(await deleted()).toEqual(['a2']);
  });
  it('MESSAGE_UPDATE without attachments field is ignored', async () => {
    await handleRawPacket(deps(), { t: 'MESSAGE_UPDATE', d: { id: 'm1' } });
    expect(await deleted()).toEqual([]);
  });
  it('ignores unknown packets and never throws', async () => {
    await handleRawPacket(deps(), { t: 'TYPING_START', d: { id: 'm1' } });
    expect(await deleted()).toEqual([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = {
      db: {
        select: () => {
          throw new Error('db');
        },
      } as never,
      storageDir: '',
      fetchBody: vi.fn(),
    };
    await expect(
      handleRawPacket(bad, { t: 'THREAD_DELETE', d: { id: 't1' } }),
    ).resolves.toBeUndefined();
  });
});

describe('handleThreadCreate owner resolution', () => {
  const mkThread = (over: Record<string, unknown>) =>
    ({
      id: 't9',
      name: 'N',
      ownerId: 'u9',
      appliedTags: [],
      parentId: 'forum1',
      parent: { id: 'forum1', type: ChannelType.GuildForum, availableTags: [] },
      fetchOwner: vi.fn().mockResolvedValue(null),
      client: { users: { fetch: vi.fn() } },
      ...over,
    }) as never;
  const u9 = {
    id: 'u9',
    username: 'nine',
    globalName: null,
    displayAvatarURL: () => 'a',
  };
  const createdBy = async () =>
    (await db.select().from(topics).where(eq(topics.discordThreadId, 't9')))[0]
      ?.createdBy;

  it('uses guildMember.user from fetchOwner({withMember:true})', async () => {
    const fetchOwner = vi.fn().mockResolvedValue({
      user: null,
      guildMember: { user: u9, nickname: null },
    });
    await handleThreadCreate(deps(), mkThread({ fetchOwner }));
    expect(fetchOwner).toHaveBeenCalledWith({ withMember: true });
    expect(await createdBy()).not.toBeNull();
  });
  it('falls back to client.users.fetch(ownerId)', async () => {
    const fetch = vi.fn().mockResolvedValue(u9);
    await handleThreadCreate(
      deps(),
      mkThread({ client: { users: { fetch } } }),
    );
    expect(fetch).toHaveBeenCalledWith('u9');
    expect(await createdBy()).not.toBeNull();
  });
  it('still creates the topic when every lookup fails', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('x'));
    await handleThreadCreate(
      deps(),
      mkThread({
        fetchOwner: vi.fn().mockRejectedValue(new Error('x')),
        client: { users: { fetch } },
      }),
    );
    expect(await createdBy()).toBeNull();
  });
});
