import { describe, expect, it } from 'vitest';
import { discordSetupGuild } from '../src/setup/discord.js';

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
