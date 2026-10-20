/**
 * Long-running admin operations shared by the slash commands and the admin
 * panel: /setup and the forum re-sync, plus the lock that keeps /setup to one
 * run at a time.
 */
import { enqueueMissingEventPosts, getSetting, users } from '@studies/db';
import type { Guild } from 'discord.js';
import { eq } from 'drizzle-orm';
import { catchUp, discordForumSource } from './catchup.js';
import type { RouterDeps } from './commands/router.js';
import { ADMIN_ROLE_SETTING } from './config.js';
import { applySetup } from './setup/apply.js';
import { discordSetupGuild, snapshotGuild } from './setup/discord.js';
import { renderGuidelines } from './setup/guidelines.js';
import { loadPanelSettings, loadSubjectSpecs } from './setup/load.js';
import { needsSecondPass, planSetup, secondPassActions } from './setup/plan.js';
import { formatPlan, formatReport, mergeReports } from './setup/report.js';

/** Records an applied admin change (admin_audit); never throws. */
export type Audit = (
  action: string,
  target: string | null,
  details: object,
) => Promise<void>;

export const BUSY_TEXT = '/setup is already running. Try again in a moment.';

let setupRunning = false;

/**
 * Runs `fn` unless another locked run is in progress ('busy'). One /setup at a
 * time: two concurrent runs could both create a forum.
 */
export async function withSetupLock<T>(
  fn: () => Promise<T>,
): Promise<T | 'busy'> {
  if (setupRunning) return 'busy';
  setupRunning = true;
  try {
    return await fn();
  } finally {
    setupRunning = false;
  }
}

/**
 * Mirrors "has the stored admin role" into users.is_admin for a user who
 * already has a row (the caller was synced when the interaction started).
 */
async function refreshAdminFlag(
  deps: RouterDeps,
  discordUserId: string,
  roleIds: string[],
): Promise<void> {
  const { db } = deps.ingest;
  const roleId = await getSetting(db, ADMIN_ROLE_SETTING);
  await db
    .update(users)
    .set({ isAdmin: roleId !== null && roleIds.includes(roleId) })
    .where(eq(users.discordUserId, discordUserId));
}

/**
 * /setup: plan, apply, and a second pass for new or imported forums. Returns
 * the report text (the plan for a dry run) and audits the run.
 */
export async function runSetup(
  deps: RouterDeps,
  guild: Guild,
  callerId: string,
  dryRun: boolean,
  audit: Audit,
): Promise<string> {
  const { db } = deps.ingest;
  const plan = async () => {
    const snapshot = {
      ...(await snapshotGuild(guild, callerId)),
      ...(await loadPanelSettings(db)),
    };
    const actions = planSetup(
      await loadSubjectSpecs(db),
      snapshot,
      {
        name: deps.config.adminRoleName,
        storedId: await getSetting(db, ADMIN_ROLE_SETTING),
      },
      renderGuidelines,
      { webBaseUrl: deps.config.webBaseUrl },
    );
    return { snapshot, actions };
  };
  const first = await plan();
  if (dryRun) {
    await audit('bot.setup_dry_run', null, {
      actions: first.actions.length,
    });
    return formatPlan(first.actions);
  }
  const setupGuild = discordSetupGuild(guild);
  const storageDir = deps.ingest.storageDir;
  let report = await applySetup(
    db,
    setupGuild,
    first.actions,
    first.snapshot,
    storageDir,
  );
  if (first.actions.some((a) => a.type === 'importForum')) {
    // Pull posts from the imported forums before planning what to add.
    const r = await catchUp(deps.ingest, discordForumSource(deps.client), {
      ignoreWatermark: true,
    });
    report.updated.push(
      `Fetched posts: ${r.topics} topics, ${r.created} files, ${r.failed} errors`,
    );
  }
  if (needsSecondPass(first.actions)) {
    // New/imported forums: tags, guidelines, topic posts and info post. The
    // panels were handled by the first pass.
    const second = await plan();
    second.actions = secondPassActions(first.actions, second.actions);
    report = mergeReports(
      report,
      await applySetup(
        db,
        setupGuild,
        second.actions,
        second.snapshot,
        storageDir,
      ),
    );
  }
  // The stored role may have just been created, adopted or replaced (which
  // clears every flag): mirror it for the caller, counting a role this run
  // assigned, which the snapshot's member roles don't include yet.
  try {
    const roles = [...first.snapshot.callerRoleIds];
    if (report.assignedRoleId) roles.push(report.assignedRoleId);
    await refreshAdminFlag(deps, callerId, roles);
  } catch (err) {
    console.error('admin flag sync after /setup failed', err);
  }
  // Forums may exist now that didn't before: retry the posts that are missing.
  try {
    await enqueueMissingEventPosts(db);
  } catch (err) {
    console.error('re-queueing event posts after /setup failed', err);
  }
  await audit('bot.setup', null, {
    created: report.created.length,
    updated: report.updated.length,
    failures: report.failures.length,
  });
  return formatReport(report);
}

/** /resync: catch up on every forum, ignoring the watermark. */
export async function runResync(
  deps: RouterDeps,
  audit: Audit,
): Promise<string> {
  const r = await catchUp(deps.ingest, discordForumSource(deps.client), {
    ignoreWatermark: true,
  });
  await audit('bot.resync', null, {
    topics: r.topics,
    created: r.created,
    failed: r.failed,
  });
  return `Synced: ${r.topics} topics, ${r.created} new files, ${r.failed} errors.`;
}
