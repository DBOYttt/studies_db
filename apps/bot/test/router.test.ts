import { subjects, users } from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInteractionHandler, isAdmin } from '../src/commands/router.js';

let db: Awaited<ReturnType<typeof resetTestDb>>;
beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

const asI = (o: unknown) => o as never;

describe('isAdmin', () => {
  it('handles array roles, cache roles and missing member', () => {
    expect(isAdmin(asI({ member: { roles: ['a', 'r'] } }), 'r')).toBe(true);
    expect(isAdmin(asI({ member: { roles: ['a'] } }), 'r')).toBe(false);
    const cache = new Map([['r', {}]]);
    expect(isAdmin(asI({ member: { roles: { cache } } }), 'r')).toBe(true);
    expect(isAdmin(asI({ member: { roles: { cache } } }), 'x')).toBe(false);
    expect(isAdmin(asI({ member: null }), 'r')).toBe(false);
  });
});

const config = { adminRoleId: 'r', webBaseUrl: 'https://x.pl' } as never;
const mkInteraction = (over: Record<string, unknown>) => ({
  isAutocomplete: () => false,
  isChatInputCommand: () => true,
  isRepliable: () => true,
  deferred: false,
  replied: false,
  member: { roles: ['r'] },
  reply: vi.fn().mockResolvedValue(undefined),
  followUp: vi.fn().mockResolvedValue(undefined),
  ...over,
});

describe('router', () => {
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
});
