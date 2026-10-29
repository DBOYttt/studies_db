// Runs the admin requests queued from the web admin panel (bot_requests kinds
// `setup`, `setup_dry_run`, `resync`; target `guild`, payload
// `{ requestedBy: <users.id> }`). A poller of its own, so a long /setup never
// holds up the event posts. Each request is claimed and run inside the /setup
// lock (a busy lock leaves it queued). The run re-checks the requester against
// Discord (a forced member fetch: the bot has no GuildMembers intent, so the
// cache can be stale) and the stored admin role, audits with `source: 'web'`
// and stores the text report on the request.
import {
  ADMIN_REQUEST_KINDS,
  type AdminRequestKind,
  type BotRequest,
  claimNextBotRequest,
  type Db,
  failStaleBotRequests,
  finishBotRequest,
  getSetting,
  users,
  writeAudit,
} from '@studies/db';
import { DiscordAPIError, type Guild, RESTJSONErrorCodes } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { RouterDeps } from './commands/router.js';
import { ADMIN_ROLE_SETTING } from './config.js';
import { type Audit, runResync, runSetup, withSetupLock } from './ops.js';

export const ADMIN_POLL_INTERVAL_MS = 5_000;
export const NOT_ADMIN_MESSAGE = 'The requester is no longer an admin.';
export const NOT_MEMBER_MESSAGE =
  'The requester is not a member of the server.';
const INVALID_MESSAGE = 'Invalid request.';

export type AdminRequestDeps = {
  db: Db;
  fetchGuild(): Promise<Guild>;
  /**
   * The member's current role ids, fetched from Discord (not the cache).
   * Throws Unknown Member / Unknown User when they are not in `guild`.
   */
  fetchMemberRoles(guild: Guild, discordUserId: string): Promise<string[]>;
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
    // force: the cache may hold a member who left or lost the role. The fetch
    // also refreshes the cache, which snapshotGuild's plain fetch then reads.
    fetchMemberRoles: async (guild, id) => [
      ...(
        await guild.members.fetch({ user: id, force: true })
      ).roles.cache.keys(),
    ],
    runSetup: (guild, callerId, dryRun, audit) =>
      runSetup(deps, guild, callerId, dryRun, audit),
    runResync: (audit) => runResync(deps, audit),
  };
}

/** A failure whose message is stored on the request as is. */
class AdminRequestError extends Error {}

type Log = (msg: string, err?: unknown) => void;

const NOT_MEMBER_CODES: readonly number[] = [
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownUser,
];

const isAdminKind = (k: string): k is AdminRequestKind =>
  (ADMIN_REQUEST_KINDS as readonly string[]).includes(k);

async function runRequest(
  deps: AdminRequestDeps,
  req: BotRequest,
  log: Log,
): Promise<string> {
  const { db } = deps;
  const kind = req.kind;
  if (!isAdminKind(kind)) throw new AdminRequestError(INVALID_MESSAGE);
  const by = (req.payload as { requestedBy?: unknown } | null)?.requestedBy;
  if (typeof by !== 'number' || !Number.isInteger(by)) {
    throw new AdminRequestError(INVALID_MESSAGE);
  }
  const userId = by;
  const [user] = await db
    .select({
      discordUserId: users.discordUserId,
      isAdmin: users.isAdmin,
      isBanned: users.isBanned,
    })
    .from(users)
    .where(eq(users.id, userId));
  // A banned admin is refused on every admin path.
  if (!user?.isAdmin || user.isBanned) {
    throw new AdminRequestError(NOT_ADMIN_MESSAGE);
  }
  const guild = await deps.fetchGuild();
  let roles: string[];
  try {
    roles = await deps.fetchMemberRoles(guild, user.discordUserId);
  } catch (err) {
    if (
      err instanceof DiscordAPIError &&
      NOT_MEMBER_CODES.includes(Number(err.code))
    ) {
      throw new AdminRequestError(NOT_MEMBER_MESSAGE);
    }
    throw err;
  }
  // users.is_admin may be stale: the stored role is what counts, and the flag
  // follows it (as syncAdminFlag does).
  const roleId = await getSetting(db, ADMIN_ROLE_SETTING);
  if (roleId === null || !roles.includes(roleId)) {
    await db.update(users).set({ isAdmin: false }).where(eq(users.id, userId));
    throw new AdminRequestError(NOT_ADMIN_MESSAGE);
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
  return kind === 'resync'
    ? deps.runResync(audit)
    : deps.runSetup(guild, user.discordUserId, kind === 'setup_dry_run', audit);
}

function failureMessage(kind: string, err: unknown): string {
  if (err instanceof AdminRequestError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  const what = kind === 'resync' ? 'Resync' : 'Setup';
  return `${what} failed: ${msg.slice(0, 200)}`;
}

/**
 * Stores a successful run, retried once. If both tries fail the row stays
 * `running` and is failed as interrupted at the next boot: a run that worked
 * is never reported as a failed one.
 */
async function storeDone(
  db: Db,
  id: number,
  report: string,
  log: Log,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await finishBotRequest(db, id, 'done', undefined, new Date(), report);
      return;
    } catch (err) {
      log(
        `admin request ${id}: cannot store the result (try ${attempt}):`,
        err,
      );
    }
  }
}

/** Claims and runs one request; null when the queue is empty. */
async function processOne(
  deps: AdminRequestDeps,
  log: Log,
): Promise<BotRequest | null> {
  const { db } = deps;
  const req = await claimNextBotRequest(db, [...ADMIN_REQUEST_KINDS]);
  if (!req) return null;
  let report: string;
  try {
    report = await runRequest(deps, req, log);
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
    return req;
  }
  await storeDone(db, req.id, report, log);
  return req;
}

/**
 * Processes queued admin requests one by one until none are left, the /setup
 * lock is held elsewhere (a slash command, the boot catch-up; the requests
 * stay queued), or `isStopped()`. Each claim and run happens inside the lock.
 */
export async function drainAdminRequests(
  deps: AdminRequestDeps,
  opts: { log?: Log; isStopped?: () => boolean } = {},
): Promise<number> {
  const log = opts.log ?? console.error;
  const isStopped = opts.isStopped ?? (() => false);
  let n = 0;
  for (;;) {
    if (isStopped()) return n;
    const req = await withSetupLock(() => processOne(deps, log));
    if (req === 'busy' || req === null) return n;
    n++;
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
