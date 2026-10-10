import type { Message } from 'discord.js';
import { ChannelType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { handleMessageCreate, registerEvents } from '../src/discord/events.js';

const forumThread = {
  id: 't1',
  name: 'T',
  ownerId: 'o',
  appliedTags: [],
  parentId: 'f1',
  parent: { id: 'f1', type: ChannelType.GuildForum },
  isThread: () => true,
};
const mkMsg = (over: Record<string, unknown>) =>
  ({
    id: 'm1',
    createdAt: new Date(0),
    author: {
      id: 'u',
      bot: false,
      username: 'x',
      globalName: null,
      displayAvatarURL: () => 'a',
    },
    member: null,
    attachments: new Map([
      ['1', { id: '1', url: 'u', name: 'a.pdf', contentType: null, size: 1 }],
    ]),
    channel: forumThread,
    react: vi.fn().mockResolvedValue(undefined),
    ...over,
  }) as unknown as Message;

const mkDeps = () => ({
  db: {} as never,
  storageDir: '/x',
  fetchBody: vi.fn(),
  ingest: vi.fn().mockResolvedValue('created'),
});

describe('handleMessageCreate', () => {
  it('ignores bot authors', async () => {
    const deps = mkDeps();
    await handleMessageCreate(deps, mkMsg({ author: { id: 'b', bot: true } }));
    expect(deps.ingest).not.toHaveBeenCalled();
  });
  it('ignores non-thread channels', async () => {
    const deps = mkDeps();
    await handleMessageCreate(
      deps,
      mkMsg({ channel: { isThread: () => false } }),
    );
    expect(deps.ingest).not.toHaveBeenCalled();
  });
  it('ignores messages without attachments', async () => {
    const deps = mkDeps();
    await handleMessageCreate(deps, mkMsg({ attachments: new Map() }));
    expect(deps.ingest).not.toHaveBeenCalled();
  });
  it('ingests each attachment and reacts', async () => {
    const deps = mkDeps();
    const msg = mkMsg({});
    await handleMessageCreate(deps, msg);
    expect(deps.ingest).toHaveBeenCalledTimes(1);
    expect(msg.react as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('✅');
  });
  it('never throws', async () => {
    const deps = mkDeps();
    deps.ingest.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handleMessageCreate(deps, mkMsg({}))).resolves.toBeUndefined();
  });
});

describe('registerEvents', () => {
  it('registers the cached and raw events', () => {
    const on = vi.fn();
    registerEvents({ on } as never, {
      db: {} as never,
      storageDir: '',
      fetchBody: vi.fn(),
    });
    expect(on.mock.calls.map((c) => c[0]).sort()).toEqual([
      'channelUpdate',
      'messageCreate',
      'raw',
      'threadCreate',
      'threadUpdate',
    ]);
  });
});
