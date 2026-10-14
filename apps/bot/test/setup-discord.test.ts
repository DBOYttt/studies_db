import {
  ChannelType,
  DiscordAPIError,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { discordSetupGuild } from '../src/setup/discord.js';
import type { View } from '../src/ui/views/parts.js';

function fakeThread(archived: boolean) {
  const calls: string[] = [];
  const t = {
    archived,
    isThread: () => true,
    async setArchived(v: boolean) {
      calls.push(`setArchived:${v}`);
      t.archived = v;
    },
    async pin() {
      calls.push(`pin:${t.archived}`);
    },
    messages: {
      fetch: async () => ({
        edit: async () => {
          calls.push(`edit:${t.archived}`);
        },
      }),
    },
  };
  const guild = { channels: { fetch: async () => t } } as never;
  return { calls, guild };
}

describe('discordSetupGuild: archived threads', () => {
  it('unarchives before editing or pinning', async () => {
    const a = fakeThread(true);
    await discordSetupGuild(a.guild).editMessage('t', 'm', 'x');
    expect(a.calls).toEqual(['setArchived:false', 'edit:false']);
    const b = fakeThread(true);
    await discordSetupGuild(b.guild).pinThread('t');
    expect(b.calls).toEqual(['setArchived:false', 'pin:false']);
  });

  it('leaves active threads alone', async () => {
    const a = fakeThread(false);
    await discordSetupGuild(a.guild).editMessage('t', 'm', 'x');
    await discordSetupGuild(a.guild).pinThread('t');
    expect(a.calls).toEqual(['edit:false', 'pin:false']);
  });
});

const apiError = (code: number) =>
  new DiscordAPIError({ code, message: 'x' }, code, 404, 'GET', '/x', {});

describe('discordSetupGuild: panels', () => {
  const view: View = { components: [], flags: MessageFlags.IsComponentsV2 };

  function fakePanelGuild(fetchMessage: () => Promise<unknown>) {
    const created: unknown[] = [];
    const channel = {
      type: ChannelType.GuildText,
      messages: { fetch: fetchMessage },
    };
    const guild = {
      roles: { everyone: { id: 'everyone' } },
      client: { user: { id: 'bot' } },
      channels: {
        fetch: async () => channel,
        create: async (o: unknown) => {
          created.push(o);
          return { id: 'new' };
        },
      },
    } as never;
    return { guild, created };
  }

  it('reports a deleted message as gone and rethrows other errors', async () => {
    const gone = fakePanelGuild(async () => {
      throw apiError(RESTJSONErrorCodes.UnknownMessage);
    });
    expect(await discordSetupGuild(gone.guild).editPanel('c', 'm', view)).toBe(
      false,
    );
    const denied = fakePanelGuild(async () => {
      throw apiError(RESTJSONErrorCodes.MissingPermissions);
    });
    await expect(
      discordSetupGuild(denied.guild).editPanel('c', 'm', view),
    ).rejects.toThrow();
  });

  it('edits in place and pins only an unpinned message', async () => {
    const calls: string[] = [];
    const msg = (pinned: boolean, pinFails = false) => ({
      channelId: 'c',
      pinned,
      edit: async (o: unknown) => {
        calls.push(`edit:${JSON.stringify(o)}`);
      },
      pin: async () => {
        calls.push('pin');
        if (pinFails) throw apiError(RESTJSONErrorCodes.MissingPermissions);
      },
    });
    const pinnedMsg = fakePanelGuild(async () => msg(true));
    expect(
      await discordSetupGuild(pinnedMsg.guild).editPanel('c', 'm', view),
    ).toEqual({ pinned: true });
    expect(calls).toEqual([
      `edit:${JSON.stringify({ components: [], flags: MessageFlags.IsComponentsV2 })}`,
    ]);
    calls.length = 0;
    const unpinned = fakePanelGuild(async () => msg(false));
    expect(
      await discordSetupGuild(unpinned.guild).editPanel('c', 'm', view),
    ).toEqual({ pinned: true });
    expect(calls.at(-1)).toBe('pin');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = fakePanelGuild(async () => msg(false, true));
    expect(
      await discordSetupGuild(refused.guild).editPanel('c', 'm', view),
    ).toEqual({ pinned: false });
  });

  it('posts, pins, and reports a refused pin without throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const post = (pinFails: boolean) => {
      const g = fakePanelGuild(async () => null);
      const channel = {
        type: ChannelType.GuildText,
        send: async () => ({
          id: 'p1',
          channelId: 'c',
          pin: async () => {
            if (pinFails) throw new Error('Missing Permissions');
          },
        }),
      };
      (g.guild as { channels: { fetch: unknown } }).channels.fetch = async () =>
        channel;
      return discordSetupGuild(g.guild).postPanel('c', view);
    };
    expect(await post(false)).toEqual({ id: 'p1', pinned: true });
    expect(await post(true)).toEqual({ id: 'p1', pinned: false });
  });

  it('locks #panel to the bot and hides #admin-panel from everyone but the role', async () => {
    const g = fakePanelGuild(async () => null);
    const sg = discordSetupGuild(g.guild);
    await sg.createTextChannel({
      name: 'panel',
      parentId: 'cat',
      private: false,
      adminRoleId: null,
    });
    await sg.createTextChannel({
      name: 'admin-panel',
      parentId: null,
      private: true,
      adminRoleId: 'r-admin',
    });
    const {
      AddReactions,
      CreatePrivateThreads,
      CreatePublicThreads,
      PinMessages,
      ReadMessageHistory,
      SendMessages,
      SendMessagesInThreads,
      ViewChannel,
    } = PermissionFlagsBits;
    const bot = {
      id: 'bot',
      type: OverwriteType.Member,
      allow: [ViewChannel, SendMessages, PinMessages],
    };
    expect(g.created).toMatchObject([
      {
        name: 'panel',
        type: ChannelType.GuildText,
        parent: 'cat',
        permissionOverwrites: [
          {
            id: 'everyone',
            allow: [ViewChannel, ReadMessageHistory],
            deny: [
              SendMessages,
              AddReactions,
              CreatePublicThreads,
              CreatePrivateThreads,
              SendMessagesInThreads,
            ],
          },
          bot,
        ],
      },
      {
        name: 'admin-panel',
        parent: null,
        permissionOverwrites: [
          { id: 'everyone', deny: [ViewChannel] },
          {
            id: 'r-admin',
            allow: [ViewChannel, ReadMessageHistory],
            deny: [SendMessages],
          },
          bot,
        ],
      },
    ]);
    // Exactly these overwrites, nothing more (ManageMessages is not needed).
    const overwrites = (g.created as { permissionOverwrites: unknown }[]).map(
      (c) => c.permissionOverwrites,
    );
    expect(overwrites).toEqual([
      [
        {
          id: 'everyone',
          type: OverwriteType.Role,
          allow: [ViewChannel, ReadMessageHistory],
          deny: [
            SendMessages,
            AddReactions,
            CreatePublicThreads,
            CreatePrivateThreads,
            SendMessagesInThreads,
          ],
        },
        bot,
      ],
      [
        { id: 'everyone', type: OverwriteType.Role, deny: [ViewChannel] },
        {
          id: 'r-admin',
          type: OverwriteType.Role,
          allow: [ViewChannel, ReadMessageHistory],
          deny: [SendMessages],
        },
        bot,
      ],
    ]);
  });
});
