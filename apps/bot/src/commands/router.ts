import {
  type ActionResult,
  type Assessment,
  addLecturer,
  addSubject,
  assignLecturer,
  banUser,
  type ClassKind,
  editClass,
  editLecturer,
  editSubject,
  getSetting,
  lecturers,
  listSubjects,
  subjects,
  upsertUser,
} from '@studies/db';
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  type Interaction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { like, or } from 'drizzle-orm';
import { memberRoleIds, syncAdminFlag } from '../admin-flag.js';
import { auditDiscord } from '../audit.js';
import { catchUp, discordForumSource } from '../catchup.js';
import { ADMIN_ROLE_SETTING, type BotConfig } from '../config.js';
import { toDiscordUser } from '../discord/map.js';
import type { IngestDeps } from '../ingest.js';
import { applySetup } from '../setup/apply.js';
import { discordSetupGuild, snapshotGuild } from '../setup/discord.js';
import { renderGuidelines } from '../setup/guidelines.js';
import { loadSubjectSpecs } from '../setup/load.js';
import { needsSecondPass, planSetup } from '../setup/plan.js';
import { formatPlan, formatReport, mergeReports } from '../setup/report.js';
import { findSubjectByChannel, syncForumTags } from '../sync.js';
import { planStatusReply, planSyncReply } from './plan.js';
import { replyOptions } from './reply.js';
import { linkFor, searchReply } from './student.js';

export type RouterDeps = {
  ingest: IngestDeps;
  client: Client;
  config: BotConfig;
};

const ADMIN_COMMANDS = new Set([
  'subject',
  'lecturer',
  'class',
  'plan',
  'ban',
  'unban',
  'resync',
]);
const ERROR_TEXT = 'Wystąpił błąd. Spróbuj ponownie później.';
const FORUM_VISIBILITY_WARNING =
  'Uwaga: bot nie widzi tego forum — sprawdź uprawnienia (View Channel, Read Message History).';
const MAX_LEN = 2000;

let setupRunning = false;

const truncate = (s: string) =>
  s.length <= MAX_LEN ? s : `${s.slice(0, MAX_LEN - 1)}…`;

/**
 * Has the admin role whose id /setup stored in bot_settings. No stored id:
 * nobody (a role name alone can be copied by anyone who can create roles).
 */
export function isAdmin(
  i: ChatInputCommandInteraction,
  roleId: string | null,
): boolean {
  const roles = i.member?.roles;
  if (!roles || roleId === null) return false;
  return Array.isArray(roles)
    ? roles.includes(roleId)
    : roles.cache.has(roleId);
}

/** /setup also accepts Manage Server, so the first run can create the role. */
export function canRunSetup(
  i: ChatInputCommandInteraction,
  roleId: string | null,
): boolean {
  return (
    isAdmin(i, roleId) ||
    i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true
  );
}

// Escape LIKE wildcards so user input matches literally.
const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

async function autocomplete(
  deps: RouterDeps,
  i: AutocompleteInteraction,
): Promise<void> {
  const { db } = deps.ingest;
  const focused = i.options.getFocused(true);
  const pat = likePattern(focused.value);
  if (focused.name === 'lecturer') {
    const rows = await db
      .select({ id: lecturers.id, name: lecturers.name })
      .from(lecturers)
      .where(like(lecturers.name, pat))
      .limit(25);
    await i.respond(
      rows.map((r) => ({ name: r.name.slice(0, 100), value: String(r.id) })),
    );
    return;
  }
  const rows = await db
    .select({ code: subjects.code, name: subjects.name })
    .from(subjects)
    .where(or(like(subjects.code, pat), like(subjects.name, pat)))
    .limit(25);
  await i.respond(
    rows.map((r) => ({
      name: `${r.code} — ${r.name}`.slice(0, 100),
      value: r.code,
    })),
  );
}

type Audit = (
  action: string,
  target: string | null,
  details: object,
) => Promise<void>;

const callerOf = (i: ChatInputCommandInteraction) =>
  toDiscordUser(i.user, i.member as GuildMember | null);

/** /setup: plan, apply, and a second pass for new or imported forums. */
async function runSetup(
  deps: RouterDeps,
  i: ChatInputCommandInteraction,
  audit: Audit,
): Promise<void> {
  const { db } = deps.ingest;
  const eph = { flags: MessageFlags.Ephemeral } as const;
  await i.deferReply(eph);
  if (!i.guild) throw new Error('/setup outside a guild');
  const guild = i.guild;
  const plan = async () => {
    const snapshot = await snapshotGuild(guild, i.user.id);
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
  if (i.options.getBoolean('dry_run')) {
    await i.editReply(replyOptions(formatPlan(first.actions)));
    await audit('bot.setup_dry_run', null, {
      actions: first.actions.length,
    });
    return;
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
      `Pobrano posty: ${r.topics} tematów, ${r.created} plików, ${r.failed} błędów`,
    );
  }
  if (needsSecondPass(first.actions)) {
    // New/imported forums: tags, guidelines, topic posts and info post.
    const second = await plan();
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
  // assigned, which the interaction's member roles don't include yet.
  try {
    const roles = memberRoleIds(i);
    if (report.assignedRoleId) roles.push(report.assignedRoleId);
    await syncAdminFlag(db, callerOf(i), roles);
  } catch (err) {
    console.error('admin flag sync after /setup failed', err);
  }
  await i.editReply(replyOptions(formatReport(report)));
  await audit('bot.setup', null, {
    created: report.created.length,
    updated: report.updated.length,
    failures: report.failures.length,
  });
}

async function runCommand(
  deps: RouterDeps,
  i: ChatInputCommandInteraction,
): Promise<void> {
  const { db } = deps.ingest;
  const eph = { flags: MessageFlags.Ephemeral } as const;
  const reply = (content: string) => i.reply(replyOptions(content, true));
  const name = i.commandName;

  // The sync also yields the stored admin role id; read it directly only if
  // the sync failed and this command needs it.
  let synced: string | null | undefined;
  let callerId: number | undefined;
  try {
    ({ roleId: synced, userId: callerId } = await syncAdminFlag(
      db,
      callerOf(i),
      memberRoleIds(i),
    ));
  } catch (err) {
    console.error('admin flag sync failed', err);
  }

  // Audit an applied admin change. If the flag sync failed, resolve the
  // caller's id with a plain upsert; failures are logged, never thrown.
  const audit: Audit = async (action, target, details) => {
    try {
      callerId ??= await upsertUser(db, callerOf(i));
    } catch (err) {
      console.error('audit: caller lookup failed', action, err);
      return;
    }
    await auditDiscord(db, callerId, action, target, details);
  };
  const auditResult = async (
    r: ActionResult,
    action: string,
    target: string | null,
    details: object = {},
  ) => {
    if (r.ok) await audit(action, target, details);
  };

  const needsAdmin = name === 'setup' || ADMIN_COMMANDS.has(name);
  const roleId = !needsAdmin
    ? null
    : synced !== undefined
      ? synced
      : await getSetting(db, ADMIN_ROLE_SETTING);
  const allowed =
    name === 'setup'
      ? canRunSetup(i, roleId)
      : !needsAdmin || isAdmin(i, roleId);
  if (!allowed) {
    await reply('Brak uprawnień.');
    return;
  }

  switch (name) {
    case 'subject': {
      const sub = i.options.getSubcommand();
      if (sub === 'list')
        return void (await reply((await listSubjects(db)).message));
      if (sub === 'add') {
        const channel = i.options.getChannel('channel', true);
        const code = i.options.getString('code', true);
        const result = await addSubject(db, {
          channelId: channel.id,
          name: i.options.getString('name', true),
          code,
          semester: i.options.getInteger('semester', true) as 1 | 2,
          ects: i.options.getInteger('ects', true),
          description: i.options.getString('description') ?? undefined,
        });
        await reply(result.message);
        await auditResult(result, 'subject.add', code.trim().toUpperCase(), {
          channelId: channel.id,
        });
        if (result.ok) {
          try {
            const subject = await findSubjectByChannel(db, channel.id);
            if (subject) {
              await syncForumTags(
                db,
                subject.id,
                await discordForumSource(deps.client).listTags(channel.id),
              );
            }
          } catch (err) {
            console.error('tag sync after subject add failed', err);
            await i.followUp(replyOptions(FORUM_VISIBILITY_WARNING, true));
          }
        }
        return;
      }
      const semester = i.options.getInteger('semester');
      const ects = i.options.getInteger('ects');
      const code = i.options.getString('code', true);
      const patch = {
        name: i.options.getString('name') ?? undefined,
        semester: semester === null ? undefined : (semester as 1 | 2),
        ects: ects === null ? undefined : ects,
        description: i.options.getString('description') ?? undefined,
        platformUrl: i.options.getString('platform_url') ?? undefined,
      };
      const result = await editSubject(db, code, patch);
      await reply(result.message);
      await auditResult(result, 'subject.edit', code.trim().toUpperCase(), {
        fields: Object.keys(patch).filter(
          (k) => patch[k as keyof typeof patch] !== undefined,
        ),
      });
      return;
    }
    case 'lecturer': {
      const lsub = i.options.getSubcommand();
      if (lsub === 'add') {
        const name = i.options.getString('name', true);
        const result = await addLecturer(db, {
          name,
          title: i.options.getString('title') ?? undefined,
          email: i.options.getString('email') ?? undefined,
          officeHours: i.options.getString('office_hours') ?? undefined,
          room: i.options.getString('room') ?? undefined,
        });
        await reply(result.message);
        await auditResult(
          result,
          'lecturer.add',
          /\(id (\d+)\)\.$/.exec(result.message)?.[1] ?? null,
          { name },
        );
        return;
      }
      if (lsub === 'edit') {
        const id = Number(i.options.getString('lecturer', true));
        if (!Number.isInteger(id)) {
          await reply('Wybierz prowadzącego z listy podpowiedzi.');
          return;
        }
        const patch = {
          name: i.options.getString('name') ?? undefined,
          title: i.options.getString('title') ?? undefined,
          email: i.options.getString('email') ?? undefined,
          officeHours: i.options.getString('office_hours') ?? undefined,
          room: i.options.getString('room') ?? undefined,
        };
        const result = await editLecturer(db, id, patch);
        await reply(result.message);
        await auditResult(result, 'lecturer.edit', String(id), {
          fields: Object.keys(patch).filter(
            (k) => patch[k as keyof typeof patch] !== undefined,
          ),
        });
        return;
      }
      const lecturerId = Number(i.options.getString('lecturer', true));
      if (!Number.isInteger(lecturerId)) {
        await reply('Wybierz prowadzącego z listy podpowiedzi.');
        return;
      }
      const subjectCode = i.options.getString('subject', true);
      const classKind = i.options.getString('class', true) as ClassKind;
      const groupNumber = i.options.getInteger('group') ?? undefined;
      const result = await assignLecturer(db, {
        subjectCode,
        lecturerId,
        classKind,
        groupNumber,
      });
      await reply(result.message);
      await auditResult(
        result,
        'lecturer.assign',
        subjectCode.trim().toUpperCase(),
        { lecturerId, classKind, groupNumber },
      );
      return;
    }
    case 'class': {
      const subjectCode = i.options.getString('subject', true);
      const kind = i.options.getString('kind', true) as ClassKind;
      const input = {
        assessment:
          (i.options.getString('assessment') as Assessment | 'brak' | null) ??
          undefined,
        note: i.options.getString('note') ?? undefined,
        platformUrl: i.options.getString('platform_url') ?? undefined,
      };
      const result = await editClass(db, { subjectCode, kind, ...input });
      await reply(result.message);
      await auditResult(
        result,
        'class.edit',
        subjectCode.trim().toUpperCase(),
        {
          kind,
          fields: Object.keys(input).filter(
            (k) => input[k as keyof typeof input] !== undefined,
          ),
        },
      );
      return;
    }
    case 'plan': {
      const now = new Date();
      if (i.options.getSubcommand() === 'sync') {
        await reply(await planSyncReply(db, now));
        await audit('plan.sync', null, {});
      } else {
        await reply(await planStatusReply(db, now));
      }
      return;
    }
    case 'ban':
    case 'unban': {
      const target = i.options.getUser('user', true);
      // Make sure the user row exists so the ban applies even if they never
      // used the bot.
      await upsertUser(db, toDiscordUser(target));
      const result = await banUser(db, target.id, name === 'ban');
      await reply(result.message);
      await auditResult(
        result,
        name === 'ban' ? 'user.ban' : 'user.unban',
        target.id,
      );
      return;
    }
    case 'setup': {
      // One run at a time: two concurrent runs could both create a forum.
      if (setupRunning) {
        await reply('/setup już trwa — spróbuj za chwilę.');
        return;
      }
      setupRunning = true;
      try {
        await runSetup(deps, i, audit);
      } finally {
        setupRunning = false;
      }
      return;
    }
    case 'resync': {
      await i.deferReply(eph);
      const r = await catchUp(deps.ingest, discordForumSource(deps.client), {
        ignoreWatermark: true,
      });
      await i.editReply(
        replyOptions(
          `Zsynchronizowano: ${r.topics} tematów, ${r.created} nowych plików, ${r.failed} błędów.`,
        ),
      );
      await audit('bot.resync', null, {
        topics: r.topics,
        created: r.created,
        failed: r.failed,
      });
      return;
    }
    case 'link': {
      const res = await linkFor(
        db,
        deps.config.webBaseUrl,
        toDiscordUser(i.user, i.member as never),
      );
      if (!res.ok) {
        await reply('Twój dostęp do strony jest zablokowany.');
        return;
      }
      await i.deferReply(eph);
      try {
        // <url> + SuppressEmbeds: no link preview, so Discord's crawler
        // never fetches the one-time URL.
        await i.user.send({
          content: `Twój link do Studies DB (ważny 15 minut, jednorazowy): <${res.url}>`,
          flags: MessageFlags.SuppressEmbeds,
        });
      } catch {
        await i.editReply(
          replyOptions(
            'Nie mogę wysłać DM — włącz wiadomości prywatne od członków serwera.',
          ),
        );
        return;
      }
      await i.editReply(
        replyOptions('Wysłałem Ci link w wiadomości prywatnej.'),
      );
      return;
    }
    case 'search': {
      await i.deferReply();
      await i.editReply(
        replyOptions(
          truncate(
            await searchReply(
              db,
              deps.config.webBaseUrl,
              i.options.getString('query', true),
            ),
          ),
        ),
      );
      return;
    }
  }
}

export function createInteractionHandler(deps: RouterDeps) {
  return async (interaction: Interaction): Promise<void> => {
    try {
      if (interaction.isAutocomplete()) {
        await autocomplete(deps, interaction);
      } else if (interaction.isChatInputCommand()) {
        await runCommand(deps, interaction);
      }
    } catch (err) {
      console.error('interaction failed', err);
      if (interaction.isAutocomplete() || !interaction.isRepliable()) return;
      try {
        const content = ERROR_TEXT;
        if (interaction.deferred)
          await interaction.editReply(replyOptions(content));
        else if (interaction.replied) {
          await interaction.followUp(replyOptions(content, true));
        } else {
          await interaction.reply(replyOptions(content, true));
        }
      } catch (err2) {
        console.error('failed to report interaction error', err2);
      }
    }
  };
}
