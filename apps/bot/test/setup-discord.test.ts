import {
  ChannelType,
  DiscordAPIError,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
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

  it('edits an existing message in place', async () => {
    const edits: unknown[] = [];
    const g = fakePanelGuild(async () => ({
      edit: async (o: unknown) => {
        edits.push(o);
      },
    }));
    expect(await discordSetupGuild(g.guild).editPanel('c', 'm', view)).toBe(
      true,
    );
    expect(edits).toEqual([
      { components: [], flags: MessageFlags.IsComponentsV2 },
    ]);
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
    const { ViewChannel, ReadMessageHistory, SendMessages, ManageMessages } =
      PermissionFlagsBits;
    const bot = {
      id: 'bot',
      type: OverwriteType.Member,
      allow: [ViewChannel, SendMessages, ManageMessages],
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
            deny: [SendMessages],
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
  });
});
