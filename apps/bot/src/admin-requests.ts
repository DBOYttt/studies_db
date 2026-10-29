// Runs the admin requests queued from the web admin panel (bot_requests kinds
// `setup`, `setup_dry_run`, `resync`; target `guild`, payload
// `{ requestedBy: <users.id> }`). A poller of its own, so a long /setup never
// holds up the event posts. Each run checks that the requester is still an
// admin and a member of the server, takes the /setup lock, audits with
// `source: 'web'` and stores the text report on the request.
import {
  ADMIN_REQUEST_KINDS,
  type AdminRequestKind,
  type BotRequest,
  claimNextBotRequest,
  type Db,
  failStaleBotRequests,
  finishBotRequest,
  users,
  writeAudit,
} from '@studies/db';
import type { Guild } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { RouterDeps } from './commands/router.js';
import {
  type Audit,
  BUSY_TEXT,
  runResync,
  runSetup,
  setupBusy,
  withSetupLock,
} from './ops.js';

export const ADMIN_POLL_INTERVAL_MS = 5_000;
export const NOT_ADMIN_MESSAGE = 'The requester is no longer an admin.';
export const NOT_MEMBER_MESSAGE =
  'The requester is not a member of the server.';

export type AdminRequestDeps = {
  db: Db;
  fetchGuild(): Promise<Guild>;
  /** Throws when `discordUserId` is not a member of `guild`. */
  fetchMember(guild: Guild, discordUserId: string): Promise<unknown>;
  runSetup(
    guild: Guild,
    callerId: string,
    dryRun: boolean,
    audit: Audit,
  ): Promise<string>;
  runResync(audit: Audit): Promise<string>;
};

/** The real Discord side, over the router's deps. */
export function adminRequestDeps(deps: RouterDeps): AdminRequestDeps {
  return {
    db: deps.ingest.db,
    fetchGuild: () => deps.client.guilds.fetch(deps.config.discordGuildId),
    fetchMember: (guild, id) => guild.members.fetch(id),
    runSetup: (guild, callerId, dryRun, audit) =>
      runSetup(deps, guild, callerId, dryRun, audit),
    runResync: (audit) => runResync(deps, audit),
  };
}

/** A failure whose message is stored on the request as is. */
class AdminRequestError extends Error {}

type Log = (msg: string, err?: unknown) => void;

const isAdminKind = (k: string): k is AdminRequestKind =>
  (ADMIN_REQUEST_KINDS as readonly string[]).includes(k);

async function runRequest(
  deps: AdminRequestDeps,
  req: BotRequest,
  log: Log,
): Promise<string> {
  const { db } = deps;
  if (!isAdminKind(req.kind)) throw new AdminRequestError('Invalid request.');
  const by = (req.payload as { requestedBy?: unknown } | null)?.requestedBy;
  if (!Number.isInteger(by)) throw new AdminRequestError('Invalid request.');
  const userId = by as number;
  const [user] = await db
    .select({ discordUserId: users.discordUserId, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.isAdmin) throw new AdminRequestError(NOT_ADMIN_MESSAGE);
  const guild = await deps.fetchGuild();
  try {
    await deps.fetchMember(guild, user.discordUserId);
  } catch {
    throw new AdminRequestError(NOT_MEMBER_MESSAGE);
  }
  const audit: Audit = async (action, target, details) => {
    try {
      await writeAudit(db, {
        userId,
        action,
        target,
        details: { ...details, source: 'web', requestId: req.id },
      });
    } catch (err) {
      log(`audit write failed (${action}, request ${req.id}):`, err);
    }
  };
  const kind = req.kind;
  const result = await withSetupLock(() =>
    kind === 'resync'
      ? deps.runResync(audit)
      : deps.runSetup(
          guild,
          user.discordUserId,
          kind === 'setup_dry_run',
          audit,
        ),
  );
  if (result === 'busy') throw new AdminRequestError(BUSY_TEXT);
  return result;
}

function failureMessage(kind: string, err: unknown): string {
  if (err instanceof AdminRequestError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  const what = kind === 'resync' ? 'Resync' : 'Setup';
  return `${what} failed: ${msg.slice(0, 200)}`;
}

/**
 * Processes queued admin requests one by one until none are left, a locked
 * run (a slash-command /setup or resync) is in progress, or `isStopped()`.
 */
export async function drainAdminRequests(
  deps: AdminRequestDeps,
  opts: { log?: Log; isStopped?: () => boolean } = {},
): Promise<number> {
  const log = opts.log ?? console.error;
  const isStopped = opts.isStopped ?? (() => false);
  const { db } = deps;
  let n = 0;
  for (;;) {
    // Busy: leave the request queued for a later tick.
    if (isStopped() || setupBusy()) return n;
    const req = await claimNextBotRequest(db, [...ADMIN_REQUEST_KINDS]);
    if (!req) return n;
    n++;
    try {
      const report = await runRequest(deps, req, log);
      await finishBotRequest(db, req.id, 'done', undefined, new Date(), report);
    } catch (err) {
      log(`admin request ${req.id} (${req.kind}) failed:`, err);
      await finishBotRequest(
        db,
        req.id,
        'failed',
        failureMessage(req.kind, err),
      ).catch((e) =>
        log(`admin request ${req.id}: cannot store the failure:`, e),
      );
    }
  }
}

/** Polls every `intervalMs`; the next tick is scheduled after the last ends. */
export function startAdminRequestPoller(
  deps: AdminRequestDeps,
  intervalMs = ADMIN_POLL_INTERVAL_MS,
): { stop(): Promise<void> } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const tick = () => {
    running = drainAdminRequests(deps, { isStopped: () => stopped })
      .catch((err) => console.error('admin request poller:', err))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
  };
  timer = setTimeout(tick, 0);
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}

/**
 * At boot: fails every `running` admin request (this process is their only
 * consumer, so they were interrupted). Awaited before the poller starts.
 */
export async function recoverInterruptedAdminRequests(db: Db): Promise<number> {
  return failStaleBotRequests(db, new Date(), 0, [...ADMIN_REQUEST_KINDS]);
}
