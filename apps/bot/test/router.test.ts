import { botSettings, setSetting, subjects, users } from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { ChannelType, Collection, MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRunSetup,
  createInteractionHandler,
  isAdmin,
} from '../src/commands/router.js';

let db: Awaited<ReturnType<typeof resetTestDb>>;
beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  await setSetting(db, 'admin_role_id', 'r');
});
afterAll(async () => {
  await closeTestDb(db);
});

const asI = (o: unknown) => o as never;

const guild = {
  roles: {
    cache: new Collection([['r', { id: 'r', name: 'Studies Admin' }]]),
  },
};

describe('isAdmin', () => {
  it('checks the stored role id for array roles, cache roles and missing member', () => {
    expect(isAdmin(asI({ guild, member: { roles: ['a', 'r'] } }), 'r')).toBe(
      true,
    );
    expect(isAdmin(asI({ guild, member: { roles: ['a'] } }), 'r')).toBe(false);
    const cache = new Map([['r', {}]]);
    expect(isAdmin(asI({ guild, member: { roles: { cache } } }), 'r')).toBe(
      true,
    );
    expect(isAdmin(asI({ guild, member: { roles: ['r'] } }), 'other')).toBe(
      false,
    );
    expect(isAdmin(asI({ guild, member: null }), 'r')).toBe(false);
  });
  it('lets nobody in by role when no role id is stored', () => {
    expect(isAdmin(asI({ guild, member: { roles: ['r'] } }), null)).toBe(false);
  });
});

describe('canRunSetup', () => {
  it('allows the admin role or Manage Server', () => {
    const manage = { has: () => true };
    const none = { has: () => false };
    expect(
      canRunSetup(
        asI({ guild, member: { roles: [] }, memberPermissions: manage }),
        null,
      ),
    ).toBe(true);
    expect(
      canRunSetup(
        asI({ guild, member: { roles: ['r'] }, memberPermissions: none }),
        'r',
      ),
    ).toBe(true);
    expect(
      canRunSetup(
        asI({ guild, member: { roles: [] }, memberPermissions: none }),
        'r',
      ),
    ).toBe(false);
  });
});

const config = {
  adminRoleName: 'Studies Admin',
  webBaseUrl: 'https://x.pl',
} as never;
const mkInteraction = (over: Record<string, unknown>) => ({
  isAutocomplete: () => false,
  isChatInputCommand: () => true,
  isRepliable: () => true,
  deferred: false,
  replied: false,
  guild,
  member: { roles: ['r'] },
  reply: vi.fn().mockResolvedValue(undefined),
  followUp: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  ...over,
});

describe('router', () => {
  it('non-admin /plan sync is refused', async () => {
    const i = mkInteraction({
      commandName: 'plan',
      member: { roles: [] },
      options: { getSubcommand: () => 'sync' },
    });
    const handler = createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {} as never,
      config,
    });
    await handler(asI(i));
    expect(i.reply.mock.calls[0]?.[0].content).toBe('Brak uprawnień.');
  });

  it('/ban upserts a never-seen user so the ban takes effect', async () => {
    const i = mkInteraction({
      commandName: 'ban',
      options: {
        getUser: () => ({
          id: 'ghost',
          username: 'g',
          globalName: null,
          displayAvatarURL: () => 'a',
        }),
      },
    });
    const handler = createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {} as never,
      config,
    });
    await handler(asI(i));
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'ghost'));
    expect(u?.isBanned).toBe(true);
    expect(i.reply.mock.calls[0]?.[0].content).toBe(
      'Zablokowano dostęp do strony.',
    );
  });

  it('/subject add warns when the forum is not visible', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const i = mkInteraction({
      commandName: 'subject',
      options: {
        getSubcommand: () => 'add',
        getChannel: () => ({ id: 'f1' }),
        getString: (n: string) =>
          ({ name: 'Algebra', code: 'alg', description: null })[n] ?? null,
        getInteger: (n: string) => (n === 'semester' ? 1 : 5),
      },
    });
    const handler = createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {
        channels: { fetch: vi.fn().mockRejectedValue(new Error('Missing')) },
      } as never,
      config,
    });
    await handler(asI(i));
    const [s] = await db.select().from(subjects);
    expect(s?.code).toBe('ALG');
    expect(i.followUp.mock.calls[0]?.[0].content).toContain(
      'bot nie widzi tego forum',
    );
  });

  it('/link DMs the URL in <> with embeds suppressed', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const i = mkInteraction({
      commandName: 'link',
      user: {
        id: 'stud',
        username: 'stud',
        globalName: null,
        displayAvatarURL: () => 'a',
        send,
      },
      member: null,
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    });
    const handler = createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {} as never,
      config,
    });
    await handler(asI(i));
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0]?.[0];
    expect(msg.content).toMatch(
      /^Twój link do Studies DB \(ważny 15 minut, jednorazowy\): <https:\/\/x\.pl\/auth\/callback\?token=[^>\s]+>$/,
    );
    expect(msg.flags).toBe(MessageFlags.SuppressEmbeds);
    expect(i.editReply.mock.calls[0]?.[0].content).toBe(
      'Wysłałem Ci link w wiadomości prywatnej.',
    );
  });
});

describe('/setup', () => {
  const handlerFor = () =>
    createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {} as never,
      config,
    });
  const setupGuild = {
    ...guild,
    client: { user: { id: 'bot' } },
    roles: { ...guild.roles, fetch: async () => guild.roles.cache },
    channels: { fetch: async () => new Collection() },
    members: {
      fetch: async () => ({ roles: { cache: new Collection() } }),
    },
  };
  const manage = { has: () => true };
  const none = { has: () => false };

  it('runs a dry run for a Manage Server member without the role', async () => {
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const i = mkInteraction({
      commandName: 'setup',
      guild: setupGuild,
      user: { id: 'u1' },
      member: { roles: [] },
      memberPermissions: manage,
      deferReply,
      options: { getBoolean: () => true },
    });
    await handlerFor()(asI(i));
    expect(i.reply).not.toHaveBeenCalled();
    expect(deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    const text = i.editReply.mock.calls[0]?.[0].content;
    expect(text).toContain('Plan (bez zmian):');
    expect(text).toContain('nadaj Ci rolę Studies Admin');
  });

  it('refuses members with neither the role nor Manage Server', async () => {
    const i = mkInteraction({
      commandName: 'setup',
      member: { roles: [] },
      memberPermissions: none,
      options: { getBoolean: () => true },
    });
    await handlerFor()(asI(i));
    expect(i.reply.mock.calls[0]?.[0].content).toBe('Brak uprawnień.');
  });

  it('refuses a same-name role when no role id is stored, but still allows /setup via Manage Server', async () => {
    await db.delete(botSettings);
    const spoofGuild = {
      ...setupGuild,
      roles: {
        cache: new Collection([
          ['fake', { id: 'fake', name: 'Studies Admin' }],
        ]),
        fetch: async () =>
          new Collection([['fake', { id: 'fake', name: 'Studies Admin' }]]),
      },
    };
    const sub = mkInteraction({
      commandName: 'subject',
      guild: spoofGuild,
      member: { roles: ['fake'] },
      memberPermissions: none,
      options: { getSubcommand: () => 'list' },
    });
    await handlerFor()(asI(sub));
    expect(sub.reply.mock.calls[0]?.[0].content).toBe('Brak uprawnień.');

    const setup = mkInteraction({
      commandName: 'setup',
      guild: spoofGuild,
      user: { id: 'u1' },
      member: { roles: ['fake'] },
      memberPermissions: manage,
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getBoolean: () => true },
    });
    await handlerFor()(asI(setup));
    expect(setup.reply).not.toHaveBeenCalled();
    expect(setup.editReply.mock.calls[0]?.[0].content).toContain(
      'zapisz rolę Studies Admin jako rolę admina',
    );
  });

  it('accepts the stored role id for other admin commands', async () => {
    const i = mkInteraction({
      commandName: 'subject',
      member: { roles: ['r'] },
      memberPermissions: none,
      options: { getSubcommand: () => 'list' },
    });
    await handlerFor()(asI(i));
    expect(i.reply.mock.calls[0]?.[0].content).not.toBe('Brak uprawnień.');
  });

  it('keeps other admin commands role-only', async () => {
    const i = mkInteraction({
      commandName: 'subject',
      member: { roles: [] },
      memberPermissions: manage,
      options: { getSubcommand: () => 'list' },
    });
    await handlerFor()(asI(i));
    expect(i.reply.mock.calls[0]?.[0].content).toBe('Brak uprawnień.');
  });

  it('imports unlinked forums, pulls their posts and finishes them in a second pass', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const forum = {
      id: 'f-fiz',
      type: ChannelType.GuildForum,
      name: 'fiz-fizyka',
      parentId: null,
      topic: null,
      availableTags: [{ id: 'x1', name: 'Laboratorium' }],
      setAvailableTags: vi.fn(async (t: { id?: string; name: string }[]) => ({
        availableTags: t.map((x, n) => ({ id: x.id ?? `n${n}`, name: x.name })),
      })),
      setTopic: vi.fn().mockResolvedValue(undefined),
      threads: {
        fetchActive: async () => ({ threads: new Collection() }),
        fetchArchived: async () => ({
          threads: new Collection(),
          hasMore: false,
        }),
        create: vi.fn(async () => ({
          id: 'th',
          fetchStarterMessage: async () => ({
            id: 'th',
            attachments: new Collection(),
          }),
        })),
      },
    };
    const infoThread = {
      isThread: () => true,
      pin: vi.fn().mockResolvedValue(undefined),
    };
    const clientFetch = vi.fn().mockRejectedValue(new Error('no client'));
    const g = {
      ...setupGuild,
      channels: {
        fetch: async (id?: string) =>
          id === 'th'
            ? infoThread
            : id
              ? forum
              : new Collection([[forum.id, forum]]),
      },
      members: {
        fetch: async () => ({
          roles: { cache: new Collection([['r', {}]]) },
        }),
      },
    };
    const i = mkInteraction({
      commandName: 'setup',
      guild: g,
      user: { id: 'u1' },
      memberPermissions: none,
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getBoolean: () => null },
    });
    await createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: { channels: { fetch: clientFetch } } as never,
      config,
    })(asI(i));
    const [s] = await db.select().from(subjects);
    expect(s).toMatchObject({ code: 'FIZ', discordChannelId: 'f-fiz' });
    expect(clientFetch).toHaveBeenCalled(); // catch-up ran
    expect(forum.setTopic).toHaveBeenCalled(); // second pass ran
    expect(forum.threads.create).toHaveBeenCalled(); // info post created
    expect(infoThread.pin).toHaveBeenCalled();
    const text = i.editReply.mock.calls[0]?.[0].content;
    expect(text).toContain('FIZ');
    expect(text).toContain('wytyczne');
    expect(text).toContain('Pobrano');
  });

  it('skips catch-up and the second pass when nothing was imported', async () => {
    const clientFetch = vi.fn();
    const g = {
      ...setupGuild,
      members: {
        fetch: async () => ({
          roles: { cache: new Collection([['r', {}]]) },
        }),
      },
    };
    const i = mkInteraction({
      commandName: 'setup',
      guild: g,
      user: { id: 'u1' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getBoolean: () => null },
    });
    await createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: { channels: { fetch: clientFetch } } as never,
      config,
    })(asI(i));
    expect(clientFetch).not.toHaveBeenCalled();
    expect(i.editReply.mock.calls[0]?.[0].content).toBe(
      'Wszystko jest aktualne.',
    );
  });
});
