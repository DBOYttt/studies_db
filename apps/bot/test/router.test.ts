import {
  adminAudit,
  botSettings,
  getSetting,
  insertMaterial,
  lecturers,
  setSetting,
  subjects,
  topics,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { ChannelType, Collection, MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canRunSetup,
  createInteractionHandler,
  isAdmin,
} from '../src/commands/router.js';
import { withSetupLock } from '../src/ops.js';

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
  discordGuildId: 'G1',
} as never;
const mkInteraction = (over: Record<string, unknown>) => ({
  guildId: 'G1',
  isAutocomplete: () => false,
  isChatInputCommand: () => true,
  isRepliable: () => true,
  deferred: false,
  replied: false,
  guild,
  member: { roles: ['r'] },
  user: { id: 'caller' },
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
      pool: {} as never,
      config,
    });
    await handler(asI(i));
    expect(i.reply.mock.calls[0]?.[0].content).toBe(
      'You do not have permission.',
    );
  });

  it('any command syncs users.is_admin from the member roles', async () => {
    const run = async (roles: string[]) => {
      const i = mkInteraction({
        commandName: 'subject',
        user: {
          id: 'adm',
          username: 'adm',
          globalName: null,
          displayAvatarURL: () => 'a',
        },
        member: { roles },
        options: { getSubcommand: () => 'list' },
      });
      await createInteractionHandler({
        ingest: { db, storageDir: '', fetchBody: vi.fn() },
        client: {} as never,
        pool: {} as never,
        config,
      })(asI(i));
      const [u] = await db
        .select()
        .from(users)
        .where(eq(users.discordUserId, 'adm'));
      return u?.isAdmin;
    };
    expect(await run(['r'])).toBe(true);
    expect(await run([])).toBe(false);
  });

  it('logs a failing admin-flag sync and still runs the command', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const i = mkInteraction({
      commandName: 'subject',
      user: { id: 'x', username: 'x', globalName: null },
      member: { roles: ['r'] },
      options: { getSubcommand: () => 'list' },
    });
    await createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {} as never,
      pool: {} as never,
      config,
    })(asI(i));
    expect(err).toHaveBeenCalledWith(
      'admin flag sync failed',
      expect.anything(),
    );
    expect(i.reply).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  describe('audit', () => {
    const run = async (patch: Record<string, unknown>) => {
      await db
        .insert(subjects)
        .values({ code: 'ALG', name: 'Algebra', semester: 1, ects: 5 });
      const i = mkInteraction({
        commandName: 'subject',
        user: {
          id: 'adm',
          username: 'adm',
          globalName: null,
          displayAvatarURL: () => 'a',
        },
        options: {
          getSubcommand: () => 'edit',
          getString: (n: string) => (n === 'code' ? 'alg' : (patch[n] ?? null)),
          getInteger: () => null,
        },
      });
      await createInteractionHandler({
        ingest: { db, storageDir: '', fetchBody: vi.fn() },
        client: {} as never,
        pool: {} as never,
        config,
      })(asI(i));
      return db.select().from(adminAudit);
    };
    it('a successful /subject edit writes one discord audit row', async () => {
      const rows = await run({ name: 'Algebra 2' });
      expect(rows).toHaveLength(1);
      const [adm] = await db
        .select()
        .from(users)
        .where(eq(users.discordUserId, 'adm'));
      expect(rows[0]).toMatchObject({
        action: 'subject.edit',
        target: 'ALG',
        userId: adm?.id,
      });
      expect(rows[0]?.details).toMatchObject({ source: 'discord' });
    });
    it('/lecturer add audits lecturer.add with the new id as target', async () => {
      const i = mkInteraction({
        commandName: 'lecturer',
        user: {
          id: 'adm',
          username: 'adm',
          globalName: null,
          displayAvatarURL: () => 'a',
        },
        options: {
          getSubcommand: () => 'add',
          getString: (n: string) => (n === 'name' ? 'Jan Kowalski' : null),
        },
      });
      await createInteractionHandler({
        ingest: { db, storageDir: '', fetchBody: vi.fn() },
        client: {} as never,
        pool: {} as never,
        config,
      })(asI(i));
      const [l] = await db.select().from(lecturers);
      const rows = await db.select().from(adminAudit);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'lecturer.add',
        target: String(l?.id),
      });
    });
    it('a refused /subject edit writes none', async () => {
      expect(await run({ platform_url: 'ftp://x' })).toHaveLength(0);
    });
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
      pool: {} as never,
      config,
    });
    await handler(asI(i));
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'ghost'));
    expect(u?.isBanned).toBe(true);
    expect(i.reply.mock.calls[0]?.[0].content).toBe(
      'Blocked access to the website.',
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
      pool: {} as never,
      config,
    });
    await handler(asI(i));
    const [s] = await db.select().from(subjects);
    expect(s?.code).toBe('ALG');
    expect(i.followUp.mock.calls[0]?.[0].content).toContain(
      'the bot cannot see this forum',
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
      pool: {} as never,
      config,
    });
    await handler(asI(i));
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0]?.[0];
    expect(msg.content).toMatch(
      /^Your Studies DB link \(valid for 15 minutes, single use\): <https:\/\/x\.pl\/auth\/callback\?token=[^>\s]+>\nUsing the installed app\? Copy this link and paste it on the app's sign-in screen\.$/,
    );
    expect(msg.flags).toBe(MessageFlags.SuppressEmbeds);
    expect(i.editReply.mock.calls[0]?.[0].content).toBe(
      'I sent you the link in a direct message.',
    );
  });
});

describe('/resync', () => {
  it('refuses while /setup holds the lock', async () => {
    let release = () => {};
    const held = withSetupLock(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const i = {
      ...mkInteraction({ commandName: 'resync', user: { id: 'u1' } }),
      deferReply,
    };
    const handler = createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {} as never,
      pool: {} as never,
      config,
    });
    await handler(asI(i));
    release();
    await held;
    expect(deferReply).not.toHaveBeenCalled();
    expect(i.reply.mock.calls[0]?.[0]).toMatchObject({
      content: '/setup is already running. Try again in a moment.',
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe('/setup', () => {
  const handlerFor = () =>
    createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {} as never,
      pool: {} as never,
      config,
    });
  /** The #panel / #admin-panel channel /setup creates and posts into. */
  const panelText = {
    type: ChannelType.GuildText,
    send: vi.fn(async () => ({ id: 'pm', pin: async () => {} })),
  };
  /** Forums the fake guild created, so a second /setup pass finds them. */
  const createdForums = new Collection<string, unknown>();
  beforeEach(() => createdForums.clear());
  /** Info posts created in those forums (threads that can be pinned). */
  const infoThread = {
    isThread: () => true,
    archived: false,
    pin: vi.fn().mockResolvedValue(undefined),
  };
  const createChannel = async (o: {
    name: string;
    type?: ChannelType;
    parent?: string | null;
    topic?: string;
    availableTags?: { name: string }[];
  }) => {
    if (o.type !== ChannelType.GuildForum) return { id: `text-${o.name}` };
    const id = `forum-${o.name}`;
    const tagsOf = (names: { id?: string; name: string }[]) =>
      names.map((t, n) => ({ id: t.id ?? `${id}-t${n}`, name: t.name }));
    const f = {
      id,
      type: ChannelType.GuildForum,
      permissionsFor: () => ({ has: () => true }),
      name: o.name,
      parentId: o.parent ?? null,
      topic: o.topic ?? null,
      availableTags: tagsOf(o.availableTags ?? []),
      setAvailableTags: vi.fn(async (t: { id?: string; name: string }[]) => {
        f.availableTags = tagsOf(t);
        return f;
      }),
      setTopic: vi.fn().mockResolvedValue(undefined),
      threads: {
        fetchActive: async () => ({ threads: new Collection() }),
        fetchArchived: async () => ({
          threads: new Collection(),
          hasMore: false,
        }),
        create: vi.fn(async () => ({
          id: `th-${id}`,
          fetchStarterMessage: async () => null,
        })),
      },
    };
    createdForums.set(id, f);
    return f;
  };
  /** The fake guild's channel lookup, falling back to `rest` for other ids. */
  const fetchChannel =
    (rest: (id: string) => unknown = () => panelText) =>
    async (id?: string) =>
      id
        ? (createdForums.get(id) ??
          (id.startsWith('th-forum-') ? infoThread : rest(id)))
        : new Collection(createdForums);
  const setupGuild = {
    ...guild,
    client: { user: { id: 'bot' } },
    roles: {
      ...guild.roles,
      everyone: { id: 'everyone' },
      fetch: async () => guild.roles.cache,
    },
    channels: {
      fetch: fetchChannel(),
      create: createChannel,
    },
    members: {
      me: { id: 'bot' },
      fetch: async () => ({ roles: { cache: new Collection() } }),
    },
  };
  const manage = { has: () => true };
  const none = { has: () => false };

  it('plans re-sending files whose message is gone from a bot-owned thread', async () => {
    const [{ id: sid }] = await db
      .insert(subjects)
      .values({
        code: 'ASD',
        name: 'Algorytmy',
        semester: 1,
        ects: 5,
        discordChannelId: 'f-asd',
      })
      .$returningId();
    const [{ id: tid }] = await db
      .insert(topics)
      .values({ subjectId: sid, title: 'Lab 1', discordThreadId: 'th-b' })
      .$returningId();
    const [{ id: uid }] = await db
      .insert(users)
      .values({ discordUserId: 'u-x', displayName: 'X' })
      .$returningId();
    for (const [n, msg] of [
      ['a', 'th-b'],
      ['b', 'gone'],
    ]) {
      await insertMaterial(
        db,
        {
          topicId: tid,
          uploaderId: uid,
          discordMessageId: msg,
          discordAttachmentId: `att-${n}`,
          originalFilename: `${n}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1,
          sha256: n.padEnd(64, '0'),
          storagePath: `${n}.pdf`,
          previewKind: 'pdf',
        },
        [],
      );
    }
    const fetchMessages = vi.fn(async () => new Collection([['th-b', {}]]));
    const thread = {
      id: 'th-b',
      parentId: 'f-asd',
      ownerId: 'bot',
      name: 'Lab 1',
      flags: { has: () => false },
      messages: { fetch: fetchMessages },
    };
    const forum = {
      id: 'f-asd',
      type: ChannelType.GuildForum,
      name: 'asd',
      parentId: null,
      topic: null,
      availableTags: [],
      permissionsFor: () => ({ has: () => true }),
      threads: {
        fetchActive: async () => ({
          threads: new Collection([[thread.id, thread]]),
        }),
        fetchArchived: async () => ({
          threads: new Collection(),
          hasMore: false,
        }),
      },
    };
    const i = mkInteraction({
      commandName: 'setup',
      guild: {
        ...setupGuild,
        channels: {
          fetch: async () => new Collection([[forum.id, forum]]),
        },
      },
      user: { id: 'u1' },
      member: { roles: [] },
      memberPermissions: manage,
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getBoolean: () => true },
    });
    await handlerFor()(asI(i));
    expect(fetchMessages).toHaveBeenCalled();
    const text = i.editReply.mock.calls[0]?.[0].content;
    expect(text).toContain('ASD: send 1 more file to topic "Lab 1"');
  });

  it('reports forums the bot cannot read and still plans the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const forumBase = {
      type: ChannelType.GuildForum,
      parentId: null,
      topic: null,
      availableTags: [],
      threads: {
        fetchActive: async () => ({ threads: new Collection() }),
        fetchArchived: async () => ({
          threads: new Collection(),
          hasMore: false,
        }),
      },
    };
    const hidden = {
      ...forumBase,
      id: 'f-a',
      name: 'aaa-ukryte',
      permissionsFor: () => ({ has: () => false }),
    };
    const broken = {
      ...forumBase,
      id: 'f-b',
      name: 'bbb-zepsute',
      permissionsFor: () => ({ has: () => true }),
      threads: {
        ...forumBase.threads,
        fetchActive: async () => {
          throw new Error('Missing Access');
        },
      },
    };
    const ok = {
      ...forumBase,
      id: 'f-c',
      name: 'ccc-dobre',
      permissionsFor: () => ({ has: () => true }),
    };
    const g = {
      ...setupGuild,
      channels: {
        fetch: async () =>
          new Collection<string, unknown>([
            [hidden.id, hidden],
            [broken.id, broken],
            [ok.id, ok],
          ]),
      },
    };
    const i = mkInteraction({
      commandName: 'setup',
      guild: g,
      user: { id: 'u1' },
      member: { roles: [] },
      memberPermissions: manage,
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getBoolean: () => true },
    });
    await handlerFor()(asI(i));
    const text = i.editReply.mock.calls[0]?.[0].content;
    expect(text).toContain('the bot cannot read forum #aaa-ukryte');
    expect(text).toContain('the bot cannot read forum #bbb-zepsute');
    expect(text).toContain('from forum #ccc-dobre');
    expect(text).not.toContain('z forum #aaa-ukryte');
  });

  it('leaves the caller with is_admin after /setup creates the role', async () => {
    await db.delete(botSettings);
    let created = 0;
    // Like Discord, the role exists once created (a second pass sees it).
    const roleCache = new Collection<string, unknown>();
    const g = {
      ...setupGuild,
      roles: {
        cache: roleCache,
        fetch: async () => roleCache,
        create: async (o: { name: string }) => {
          created++;
          roleCache.set('newrole', { id: 'newrole', name: o.name });
          return { id: 'newrole' };
        },
      },
      members: {
        me: { id: 'bot' },
        addRole: vi.fn().mockResolvedValue(undefined),
        fetch: async () => ({ roles: { cache: new Collection() } }),
      },
    };
    const i = mkInteraction({
      commandName: 'setup',
      guild: g,
      user: {
        id: 'caller',
        username: 'caller',
        globalName: null,
        displayAvatarURL: () => 'a',
      },
      member: { roles: [] },
      memberPermissions: manage,
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getBoolean: () => false },
    });
    await handlerFor()(asI(i));
    expect(created).toBe(1);
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'caller'));
    expect(u?.isAdmin).toBe(true);
  });

  it('sets is_admin when /setup adopts a role the caller already holds', async () => {
    await db.delete(botSettings);
    const g = {
      ...setupGuild,
      members: {
        me: { id: 'bot' },
        addRole: vi.fn().mockResolvedValue(undefined),
        fetch: async () => ({
          roles: { cache: new Collection([['r', { id: 'r' }]]) },
        }),
      },
    };
    const i = mkInteraction({
      commandName: 'setup',
      guild: g,
      user: {
        id: 'holder',
        username: 'holder',
        globalName: null,
        displayAvatarURL: () => 'a',
      },
      member: { roles: ['r'] },
      memberPermissions: manage,
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getBoolean: () => false },
    });
    await handlerFor()(asI(i));
    expect(g.members.addRole).not.toHaveBeenCalled();
    expect(await getSetting(db, 'admin_role_id')).toBe('r');
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'holder'));
    expect(u?.isAdmin).toBe(true);
  });

  it('still sets is_admin when an unrelated setup action fails', async () => {
    await db.delete(botSettings);
    await db.insert(subjects).values({
      code: 'ZZZ',
      name: 'Zzz',
      semester: 1,
      ects: 5,
    });
    const g = {
      ...setupGuild,
      roles: {
        cache: new Collection(),
        fetch: async () => new Collection(),
        create: async () => ({ id: 'newrole' }),
      },
      channels: {
        fetch: async () => new Collection(),
        create: async () => {
          throw new Error('boom');
        },
      },
      members: {
        me: { id: 'bot' },
        addRole: vi.fn().mockResolvedValue(undefined),
        fetch: async () => ({ roles: { cache: new Collection() } }),
      },
    };
    const i = mkInteraction({
      commandName: 'setup',
      guild: g,
      user: {
        id: 'caller2',
        username: 'c2',
        globalName: null,
        displayAvatarURL: () => 'a',
      },
      member: { roles: [] },
      memberPermissions: manage,
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getBoolean: () => false },
    });
    await handlerFor()(asI(i));
    expect(i.editReply.mock.calls[0]?.[0].content).toContain('boom');
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'caller2'));
    expect(u?.isAdmin).toBe(true);
  });

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
    expect(text).toContain('Plan (no changes made):');
    expect(text).toContain('give you the role Studies Admin');
  });

  it('refuses a second /setup while one is running, and allows it afterwards', async () => {
    let release = () => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const run = (defer: () => Promise<void>) => {
      const deferReply = vi.fn(defer);
      return {
        ...mkInteraction({
          commandName: 'setup',
          guild: setupGuild,
          user: { id: 'u1' },
          member: { roles: [] },
          memberPermissions: manage,
          options: { getBoolean: () => true },
        }),
        deferReply,
      };
    };
    const first = run(() => blocked);
    const firstDone = handlerFor()(asI(first));
    await vi.waitFor(() => expect(first.deferReply).toHaveBeenCalled());

    const second = run(async () => {});
    await handlerFor()(asI(second));
    expect(second.deferReply).not.toHaveBeenCalled();
    expect(second.reply.mock.calls[0]?.[0]).toMatchObject({
      content: '/setup is already running. Try again in a moment.',
      flags: MessageFlags.Ephemeral,
    });

    release();
    await firstDone;
    expect(first.editReply.mock.calls[0]?.[0].content).toContain('Plan');
    const third = run(async () => {});
    await handlerFor()(asI(third));
    expect(third.reply).not.toHaveBeenCalled();
    expect(third.editReply.mock.calls[0]?.[0].content).toContain('Plan');
  });

  it('releases the /setup lock when a run fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = (deferReply: () => Promise<void>) =>
      mkInteraction({
        commandName: 'setup',
        guild: setupGuild,
        user: { id: 'u1' },
        member: { roles: [] },
        memberPermissions: manage,
        deferReply: vi.fn(deferReply),
        options: { getBoolean: () => true },
      });
    await handlerFor()(asI(run(() => Promise.reject(new Error('boom')))));
    const next = run(async () => {});
    await handlerFor()(asI(next));
    expect(next.editReply.mock.calls[0]?.[0].content).toContain('Plan');
  });

  it('refuses members with neither the role nor Manage Server', async () => {
    const i = mkInteraction({
      commandName: 'setup',
      member: { roles: [] },
      memberPermissions: none,
      options: { getBoolean: () => true },
    });
    await handlerFor()(asI(i));
    expect(i.reply.mock.calls[0]?.[0].content).toBe(
      'You do not have permission.',
    );
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
    expect(sub.reply.mock.calls[0]?.[0].content).toBe(
      'You do not have permission.',
    );

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
      'save role Studies Admin as the admin role',
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
    expect(i.reply.mock.calls[0]?.[0].content).not.toBe(
      'You do not have permission.',
    );
  });

  it('keeps other admin commands role-only', async () => {
    const i = mkInteraction({
      commandName: 'subject',
      member: { roles: [] },
      memberPermissions: manage,
      options: { getSubcommand: () => 'list' },
    });
    await handlerFor()(asI(i));
    expect(i.reply.mock.calls[0]?.[0].content).toBe(
      'You do not have permission.',
    );
  });

  it('imports unlinked forums, pulls their posts and finishes them in a second pass', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const forum = {
      id: 'f-fiz',
      type: ChannelType.GuildForum,
      permissionsFor: () => ({ has: () => true }),
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
        // The starter message cannot be fetched back: the post still counts.
        create: vi.fn(async () => ({
          id: 'th',
          fetchStarterMessage: async () => {
            throw new Error('Unknown Message');
          },
        })),
      },
    };
    const fizInfoThread = {
      isThread: () => true,
      pin: vi.fn().mockResolvedValue(undefined),
    };
    const clientFetch = vi.fn().mockRejectedValue(new Error('no client'));
    const g = {
      ...setupGuild,
      channels: {
        fetch: async (id?: string) => {
          if (!id) {
            return new Collection<string, unknown>([
              [forum.id, forum],
              ...createdForums,
            ]);
          }
          if (id === 'th') return fizInfoThread;
          if (id === forum.id) return forum;
          return fetchChannel(() =>
            id.startsWith('text-') ? panelText : forum,
          )(id);
        },
        create: createChannel,
      },
      members: {
        me: { id: 'bot' },
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
      pool: {} as never,
      config,
    })(asI(i));
    const [s] = await db.select().from(subjects);
    expect(s).toMatchObject({ code: 'FIZ', discordChannelId: 'f-fiz' });
    expect(clientFetch).toHaveBeenCalled(); // catch-up ran
    expect(forum.setTopic).toHaveBeenCalled(); // second pass ran
    expect(forum.threads.create).toHaveBeenCalled(); // info post created
    expect(fizInfoThread.pin).toHaveBeenCalled();
    const text = i.editReply.mock.calls[0]?.[0].content;
    expect(text).toContain('FIZ');
    expect(text).toContain('guidelines');
    expect(text).toContain('Fetched posts');
    expect(text).toContain('info post');
    expect(text).not.toContain('Errors');
  });

  it('skips catch-up when nothing was imported', async () => {
    const clientFetch = vi.fn();
    const g = {
      ...setupGuild,
      members: {
        me: { id: 'bot' },
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
      pool: {} as never,
      config,
    })(asI(i));
    expect(clientFetch).not.toHaveBeenCalled();
    // The panels and #wydarzenia (its info post comes from the second pass).
    expect(i.editReply.mock.calls[0]?.[0].content).toBe(
      [
        '**Created**',
        '- channel #panel',
        '- channel #admin-panel',
        '- panel in #panel',
        '- panel in #admin-panel',
        '- #wydarzenia: forum #wydarzenia',
        '- #wydarzenia: info post',
      ].join('\n'),
    );
  });
});

describe('guild check (I1)', () => {
  const handler = () =>
    createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {} as never,
      pool: {} as never,
      config,
    });

  it.each([['G2'], [null]])(
    'refuses a command from guild %s without running it',
    async (guildId) => {
      const getSubcommand = vi.fn(() => 'list');
      const i = mkInteraction({
        guildId,
        commandName: 'subject',
        user: {
          id: 'adm',
          username: 'adm',
          globalName: null,
          displayAvatarURL: () => 'a',
        },
        options: { getSubcommand },
      });
      await handler()(asI(i));
      expect(getSubcommand).not.toHaveBeenCalled();
      const arg = i.reply.mock.calls[0]?.[0];
      expect(arg.content).toBe('This bot only works on its own server.');
      expect(arg.flags & MessageFlags.Ephemeral).toBeTruthy();
      expect(await db.select().from(users)).toHaveLength(0);
    },
  );

  it('answers no autocomplete from another guild', async () => {
    const respond = vi.fn();
    const i = mkInteraction({
      guildId: 'G2',
      isAutocomplete: () => true,
      isChatInputCommand: () => false,
      isRepliable: () => false,
      options: { getFocused: () => ({ name: 'subject', value: '' }) },
      respond,
    });
    await handler()(asI(i));
    expect(respond).not.toHaveBeenCalled();
  });
});

describe('banned admins (R6)', () => {
  const handler = () =>
    createInteractionHandler({
      ingest: { db, storageDir: '', fetchBody: vi.fn() },
      client: {} as never,
      pool: {} as never,
      config,
    });
  const me = {
    id: 'b1',
    username: 'b1',
    globalName: null,
    displayAvatarURL: () => 'a',
  };

  it('refuses every admin command, /setup with Manage Server included', async () => {
    await db
      .insert(users)
      .values({ discordUserId: 'b1', displayName: 'b1', isBanned: true });
    const cases: Record<string, unknown>[] = [
      { commandName: 'unban', options: { getUser: () => me } },
      { commandName: 'subject', options: { getSubcommand: () => 'list' } },
      {
        commandName: 'setup',
        memberPermissions: { has: () => true },
        options: { getBoolean: () => true },
      },
    ];
    for (const c of cases) {
      const i = mkInteraction({ user: me, member: { roles: ['r'] }, ...c });
      await handler()(asI(i));
      expect(i.reply.mock.calls[0]?.[0].content).toBe(
        'You do not have permission.',
      );
    }
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'b1'));
    expect(row.isBanned).toBe(true);
    expect(await db.select().from(adminAudit)).toHaveLength(0);
  });
});
