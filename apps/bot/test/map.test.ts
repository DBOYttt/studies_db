import type { AnyThreadChannel, Message } from 'discord.js';
import { ChannelType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  toAttachmentInputs,
  toDiscordUser,
  toThreadInfo,
} from '../src/discord/map.js';
import { reactForResult } from '../src/discord/react.js';
import type { IngestResult } from '../src/ingest.js';

const thread = (parentType: ChannelType) =>
  ({
    id: 't1',
    name: 'Topic',
    ownerId: 'o1',
    appliedTags: ['a', 'b'],
    parentId: 'f1',
    parent: { id: 'f1', type: parentType },
  }) as unknown as AnyThreadChannel;

describe('toThreadInfo', () => {
  it('returns null for non-forum parent', () => {
    expect(toThreadInfo(thread(ChannelType.GuildText))).toBeNull();
  });
  it('maps forum thread', () => {
    expect(toThreadInfo(thread(ChannelType.GuildForum))).toEqual({
      threadId: 't1',
      forumChannelId: 'f1',
      title: 'Topic',
      ownerDiscordId: 'o1',
      tagIds: ['a', 'b'],
    });
  });
});

describe('toDiscordUser', () => {
  const user = (g: string | null) =>
    ({
      id: 'u',
      username: 'uname',
      globalName: g,
      displayAvatarURL: () => 'http://a/x.png',
    }) as never;
  it('prefers nickname, then globalName, then username', () => {
    expect(
      toDiscordUser(user('G'), { nickname: 'N' } as never).displayName,
    ).toBe('N');
    expect(
      toDiscordUser(user('G'), { nickname: null } as never).displayName,
    ).toBe('G');
    expect(toDiscordUser(user(null)).displayName).toBe('uname');
    expect(toDiscordUser(user(null)).avatarUrl).toBe('http://a/x.png');
  });
});

describe('toAttachmentInputs', () => {
  it('maps every attachment, contentType null-safe', () => {
    const att = new Map([
      [
        '1',
        {
          id: '1',
          url: 'u1',
          name: 'a.pdf',
          contentType: 'application/pdf',
          size: 5,
        },
      ],
      ['2', { id: '2', url: 'u2', name: 'b.bin', contentType: null, size: 7 }],
    ]);
    const msg = {
      id: 'm1',
      createdAt: new Date(0),
      attachments: att,
      author: {
        id: 'u',
        username: 'x',
        globalName: null,
        displayAvatarURL: () => 'av',
      },
      member: null,
      channel: { ...thread(ChannelType.GuildForum), isThread: () => true },
    } as unknown as Message;
    const out = toAttachmentInputs(msg);
    expect(
      out.map((o) => [o.attachmentId, o.contentType, o.messageId]),
    ).toEqual([
      ['1', 'application/pdf', 'm1'],
      ['2', null, 'm1'],
    ]);
    expect(out[0]?.thread.threadId).toBe('t1');
    expect(out[0]?.threadOwner).toBeNull();
  });
});

describe('reactForResult', () => {
  const cases: [IngestResult[], string | null][] = [
    [['failed', 'created'], '❌'],
    [['duplicate', 'duplicate'], '♻️'],
    [['created', 'duplicate'], '✅'],
    [['created'], '✅'],
    [['ignored', 'exists'], null],
    [[], null],
  ];
  it.each(cases)('%j -> %s', async (results, emoji) => {
    const react = vi.fn().mockResolvedValue(undefined);
    await reactForResult({ react } as unknown as Message, results);
    if (emoji) expect(react).toHaveBeenCalledWith(emoji);
    else expect(react).not.toHaveBeenCalled();
  });
  it('swallows reaction errors', async () => {
    const react = vi.fn().mockRejectedValue(new Error('perm'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      reactForResult({ react } as unknown as Message, ['created']),
    ).resolves.toBeUndefined();
  });
});
