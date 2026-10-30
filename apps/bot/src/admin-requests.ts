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
/** No admin role is pinned yet: only a Discord /setup can pin it. */
export const NO_ROLE_MESSAGE = 'Run /setup from Discord first.';
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
  /** Waits between finish-write retries; injectable so tests don't wait. */
  sleep?(ms: number): Promise<void>;
};

const FINISH_WAITS_MS = [1_000, 5_000];
const SNOWFLAKE = /^\d{17,20}$/;

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
  // Without a pinned role nobody can be checked, and the flag is left alone:
  // the first /setup (which pins the role) must come from Discord.
  const roleId = await getSetting(db, ADMIN_ROLE_SETTING);
  if (roleId === null) throw new AdminRequestError(NO_ROLE_MESSAGE);
  // A malformed id (seed users, hand-edited rows) must not reach Discord.
  if (!SNOWFLAKE.test(user.discordUserId)) {
    throw new AdminRequestError(NOT_MEMBER_MESSAGE);
  }
  const guild = await deps.fetchGuild();
  // A pinned role deleted in Discord: nobody can be checked, flag untouched.
  // A fetch error propagates as an ordinary failed run.
  if ((await guild.roles.fetch(roleId)) === null) {
    throw new AdminRequestError(NO_ROLE_MESSAGE);
  }
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
  if (!roles.includes(roleId)) {
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
 * Writes the final status, up to 3 attempts (waits 1 s, then 5 s). If all
 * fail the row stays `running` and the per-tick recovery fails it later; a
 * run that worked is never reported as a failed one. An affected-rows count
 * of 0 means the row was cancelled meanwhile: the result is dropped.
 */
async function storeFinish(
  deps: AdminRequestDeps,
  id: number,
  status: 'done' | 'failed',
  error: string | undefined,
  report: string | undefined,
  log: Log,
): Promise<void> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt <= FINISH_WAITS_MS.length; attempt++) {
    try {
      const n = await finishBotRequest(
        deps.db,
        id,
        status,
        error,
        new Date(),
        report,
      );
      if (n === 0) {
        log(
          `admin request ${id} finished after it was cancelled; result dropped`,
        );
      }
      return;
    } catch (err) {
      log(
        `admin request ${id}: cannot store the result (try ${attempt + 1}):`,
        err,
      );
      if (attempt < FINISH_WAITS_MS.length)
        await sleep(FINISH_WAITS_MS[attempt]);
    }
  }
  log(`admin request ${id}: could not store the result`);
}

/** Claims and runs one request; null when the queue is empty. */
async function processOne(
  deps: AdminRequestDeps,
  log: Log,
): Promise<BotRequest | null> {
  const req = await claimNextBotRequest(deps.db, [...ADMIN_REQUEST_KINDS]);
  if (!req) return null;
  let report: string;
  try {
    report = await runRequest(deps, req, log);
  } catch (err) {
    log(`admin request ${req.id} (${req.kind}) failed:`, err);
    await storeFinish(
      deps,
      req.id,
      'failed',
      failureMessage(req.kind, err),
      undefined,
      log,
    );
    return req;
  }
  await storeFinish(deps, req.id, 'done', undefined, report, log);
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
  // Every run happens inside the lock, so while it is free this process runs
  // nothing: any admin row still `running` is orphaned (a finish write that
  // failed for good). Recovering inside the lock keeps it from racing a run.
  if (!isStopped()) {
    await withSetupLock(async () => {
      const failed = await recoverInterruptedAdminRequests(deps.db);
      if (failed > 0) log(`admin requests failed as interrupted: ${failed}`);
    }).catch((err) => log('admin request recovery failed:', err));
  }
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
