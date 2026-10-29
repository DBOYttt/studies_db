import {
  adminAudit,
  botRequests,
  type Db,
  enqueueAdminBotRequest,
  enqueueBotRequest,
  STALE_BOT_REQUEST_ERROR,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdminRequestDeps,
  drainAdminRequests,
  recoverInterruptedAdminRequests,
} from '../src/admin-requests.js';
import { withSetupLock } from '../src/ops.js';

let db: Db;
let adminId: number;
beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  [{ id: adminId }] = await db
    .insert(users)
    .values({ discordUserId: 'd-admin', displayName: 'Admin', isAdmin: true })
    .$returningId();
});
afterAll(async () => {
  await closeTestDb(db);
});

const fakeGuild = { id: 'g' };

function fakeDeps(over: Partial<AdminRequestDeps> = {}) {
  const deps: AdminRequestDeps = {
    db,
    fetchGuild: vi.fn(async () => fakeGuild as never),
    fetchMember: vi.fn(async () => {}),
    runSetup: vi.fn(async (_guild, _caller, dryRun, audit) => {
      await audit(dryRun ? 'bot.setup_dry_run' : 'bot.setup', null, {
        actions: 3,
      });
      return dryRun ? 'Plan (no changes made): 3' : 'Setup report';
    }),
    runResync: vi.fn(async (audit) => {
      await audit('bot.resync', null, { topics: 1 });
      return 'Synced: 1 topic.';
    }),
    ...over,
  };
  return deps;
}

const log = vi.fn();

async function request(id: number) {
  const [r] = await db.select().from(botRequests).where(eq(botRequests.id, id));
  return r;
}

async function enqueue(
  kind: 'setup' | 'setup_dry_run' | 'resync',
  by = adminId,
) {
  const r = await enqueueAdminBotRequest(db, kind, by);
  if (!r.ok) throw new Error(r.message);
  return r.id;
}

describe('drainAdminRequests', () => {
  it.each([
    ['setup', 'Setup report', 'bot.setup'],
    ['setup_dry_run', 'Plan (no changes made): 3', 'bot.setup_dry_run'],
    ['resync', 'Synced: 1 topic.', 'bot.resync'],
  ] as const)(
    '%s stores the report and a web audit row',
    async (kind, report, action) => {
      const id = await enqueue(kind);
      const deps = fakeDeps();
      expect(await drainAdminRequests(deps, { log })).toBe(1);
      const r = await request(id);
      expect(r.status).toBe('done');
      expect(r.error).toBeNull();
      expect(r.report).toBe(report);
      const rows = await db.select().from(adminAudit);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: adminId, action, target: null });
      expect(rows[0].details).toMatchObject({ source: 'web', requestId: id });
      if (kind === 'resync') expect(deps.runSetup).not.toHaveBeenCalled();
      else {
        expect(deps.runSetup).toHaveBeenCalledWith(
          fakeGuild,
          'd-admin',
          kind === 'setup_dry_run',
          expect.any(Function),
        );
        expect(deps.fetchMember).toHaveBeenCalledWith(fakeGuild, 'd-admin');
      }
    },
  );

  it('fails when the requester is no longer an admin', async () => {
    const id = await enqueue('setup');
    await db.update(users).set({ isAdmin: false }).where(eq(users.id, adminId));
    const deps = fakeDeps();
    await drainAdminRequests(deps, { log });
    const r = await request(id);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('The requester is no longer an admin.');
    expect(deps.runSetup).not.toHaveBeenCalled();
    expect(await db.select().from(adminAudit)).toEqual([]);
  });

  it('fails when the requester is not a member of the server', async () => {
    const id = await enqueue('resync');
    const deps = fakeDeps({
      fetchMember: vi.fn(async () => {
        throw new Error('Unknown Member');
      }),
    });
    await drainAdminRequests(deps, { log });
    const r = await request(id);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('The requester is not a member of the server.');
    expect(deps.runResync).not.toHaveBeenCalled();
  });

  it('a run that throws fails with a short message', async () => {
    const id = await enqueue('setup');
    const deps = fakeDeps({
      runSetup: vi.fn(async () => {
        throw new Error(`boom ${'x'.repeat(300)}`);
      }),
    });
    await drainAdminRequests(deps, { log });
    const r = await request(id);
    expect(r.status).toBe('failed');
    expect(r.error).toBe(`Setup failed: boom ${'x'.repeat(195)}`);
    expect(log).toHaveBeenCalled();
  });

  it('a failing audit write does not fail the run', async () => {
    const id = await enqueue('resync');
    const deps = fakeDeps({
      runResync: vi.fn(async (audit) => {
        // Details that cannot be serialised make writeAudit throw.
        const circ: Record<string, unknown> = {};
        circ.self = circ;
        await audit('bot.resync', null, circ);
        return 'ok';
      }),
    });
    await drainAdminRequests(deps, { log });
    expect((await request(id)).status).toBe('done');
    expect(await db.select().from(adminAudit)).toEqual([]);
  });

  it('with the setup lock held nothing is claimed', async () => {
    const id = await enqueue('setup');
    let release!: () => void;
    const held = withSetupLock(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const deps = fakeDeps();
    expect(await drainAdminRequests(deps, { log })).toBe(0);
    expect((await request(id)).status).toBe('queued');
    release();
    await held;
    expect(await drainAdminRequests(deps, { log })).toBe(1);
    expect((await request(id)).status).toBe('done');
  });

  it('leaves event requests alone', async () => {
    const { id } = await enqueueBotRequest(db, 'event_post_upsert', 'event:1');
    expect(await drainAdminRequests(fakeDeps(), { log })).toBe(0);
    expect((await request(id)).status).toBe('queued');
  });
});

describe('recoverInterruptedAdminRequests', () => {
  it('fails running admin requests, not event ones', async () => {
    const id = await enqueue('setup');
    const { id: ev } = await enqueueBotRequest(
      db,
      'event_post_upsert',
      'event:1',
    );
    const past = new Date(Date.now() - 60_000);
    await db.update(botRequests).set({ status: 'running', startedAt: past });
    expect(await recoverInterruptedAdminRequests(db)).toBe(1);
    const r = await request(id);
    expect(r.status).toBe('failed');
    expect(r.error).toBe(STALE_BOT_REQUEST_ERROR);
    expect((await request(ev)).status).toBe('running');
  });
});
