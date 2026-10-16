import { type Db, setSetting, subjects, users } from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { ChannelType, Collection } from 'discord.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouterDeps } from '../src/commands/router.js';
import { runResync, runSetup, withSetupLock } from '../src/ops.js';

let db: Db;
beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  await setSetting(db, 'admin_role_id', 'r');
});
afterAll(async () => {
  await closeTestDb(db);
});

const deps = (client: object = {}): RouterDeps => ({
  ingest: { db, storageDir: '', fetchBody: vi.fn() },
  client: client as never,
  config: {
    adminRoleName: 'Studies Admin',
    webBaseUrl: 'https://x.pl',
  } as never,
  pool: {} as never,
});

const roles = new Collection([['r', { id: 'r', name: 'Studies Admin' }]]);
/** The #panel / #admin-panel channel /setup creates and posts into. */
const panelText = {
  type: ChannelType.GuildText,
  send: async () => ({ id: 'pm', pin: async () => {} }),
};
const guild = (callerRoles: string[]) =>
  ({
    client: { user: { id: 'bot' } },
    roles: { cache: roles, everyone: { id: 'e' }, fetch: async () => roles },
    channels: {
      fetch: async (id?: string) => (id ? panelText : new Collection()),
      create: async (o: { name: string }) => ({
        id: `text-${o.name}`,
        availableTags: [],
      }),
    },
    members: {
      me: { id: 'bot' },
      fetch: async () => ({
        roles: {
          cache: new Collection(callerRoles.map((r) => [r, { id: r }])),
        },
      }),
    },
  }) as never;

describe('runSetup', () => {
  it('a dry run returns the formatted plan and audits it', async () => {
    await db
      .insert(subjects)
      .values({ code: 'FIZ', name: 'Fizyka', semester: 1, ects: 5 });
    const audit = vi.fn().mockResolvedValue(undefined);
    const text = await runSetup(deps(), guild(['r']), 'u1', true, audit);
    expect(text).toContain('Plan (bez zmian):');
    expect(text).toContain('FIZ');
    expect(audit).toHaveBeenCalledWith('bot.setup_dry_run', null, {
      actions: expect.any(Number),
    });
  });

  it('a run re-syncs the caller admin flag from their roles', async () => {
    await db
      .insert(users)
      .values({ discordUserId: 'u1', displayName: 'u1', isAdmin: false });
    const audit = vi.fn().mockResolvedValue(undefined);
    const text = await runSetup(deps(), guild(['r']), 'u1', false, audit);
    expect(text).not.toContain('Błędy');
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, 'u1'));
    expect(u.isAdmin).toBe(true);
    // The two panel channels and their messages, #wydarzenia and its info post.
    expect(audit).toHaveBeenCalledWith('bot.setup', null, {
      created: 6,
      updated: 0,
      failures: 0,
    });
  });
});

describe('runResync', () => {
  it('returns the summary and audits bot.resync', async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    expect(await runResync(deps(), audit)).toBe(
      'Zsynchronizowano: 0 tematów, 0 nowych plików, 0 błędów.',
    );
    expect(audit).toHaveBeenCalledWith('bot.resync', null, {
      topics: 0,
      created: 0,
      failed: 0,
    });
  });
});

describe('withSetupLock', () => {
  it('is busy while held and free again after a failure', async () => {
    let release = () => {};
    const held = withSetupLock(
      () =>
        new Promise<string>((r) => {
          release = () => r('done');
        }),
    );
    expect(await withSetupLock(async () => 'x')).toBe('busy');
    release();
    expect(await held).toBe('done');
    await expect(
      withSetupLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withSetupLock(async () => 'again')).toBe('again');
  });
});
