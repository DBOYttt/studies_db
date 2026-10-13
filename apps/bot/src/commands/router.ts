import {
  type Assessment,
  type ClassKind,
  getSetting,
  lecturers,
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
import {
  addLecturer,
  addSubject,
  assignLecturer,
  banReply,
  editClass,
  editLecturer,
  editSubject,
  listSubjects,
} from './admin.js';
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

const callerOf = (i: ChatInputCommandInteraction) =>
  toDiscordUser(i.user, i.member as GuildMember | null);

/** /setup: plan, apply, and a second pass for new or imported forums. */
async function runSetup(
  deps: RouterDeps,
  i: ChatInputCommandInteraction,
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
  // The role was just created/adopted and assigned to the caller: mirror it.
  const gotRole = first.actions.some((a) => a.type === 'assignRole');
  if (gotRole) {
    try {
      const roleId = await getSetting(db, ADMIN_ROLE_SETTING);
      if (roleId && report.failures.length === 0) {
        await syncAdminFlag(db, callerOf(i), [...memberRoleIds(i), roleId]);
      }
    } catch (err) {
      console.error('admin flag sync after /setup failed', err);
    }
  }
  await i.editReply(replyOptions(formatReport(report)));
}

async function runCommand(
  deps: RouterDeps,
  i: ChatInputCommandInteraction,
): Promise<void> {
  const { db } = deps.ingest;
  const eph = { flags: MessageFlags.Ephemeral } as const;
  const reply = (content: string) => i.reply(replyOptions(content, true));
  const name = i.commandName;

  try {
    await syncAdminFlag(db, callerOf(i), memberRoleIds(i));
  } catch (err) {
    console.error('admin flag sync failed', err);
  }

  const needsAdmin = name === 'setup' || ADMIN_COMMANDS.has(name);
  const roleId = needsAdmin ? await getSetting(db, ADMIN_ROLE_SETTING) : null;
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
      if (sub === 'list') return void (await reply(await listSubjects(db)));
      if (sub === 'add') {
        const channel = i.options.getChannel('channel', true);
        const text = await addSubject(db, {
          channelId: channel.id,
          name: i.options.getString('name', true),
          code: i.options.getString('code', true),
          semester: i.options.getInteger('semester', true) as 1 | 2,
          ects: i.options.getInteger('ects', true),
          description: i.options.getString('description') ?? undefined,
        });
        await reply(text);
        if (text.startsWith('Dodano') || text.startsWith('Połączono')) {
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
      await reply(
        await editSubject(db, i.options.getString('code', true), {
          name: i.options.getString('name') ?? undefined,
          semester: semester === null ? undefined : (semester as 1 | 2),
          ects: ects === null ? undefined : ects,
          description: i.options.getString('description') ?? undefined,
          platformUrl: i.options.getString('platform_url') ?? undefined,
        }),
      );
      return;
    }
    case 'lecturer': {
      const lsub = i.options.getSubcommand();
      if (lsub === 'add') {
        await reply(
          await addLecturer(db, {
            name: i.options.getString('name', true),
            title: i.options.getString('title') ?? undefined,
            email: i.options.getString('email') ?? undefined,
            officeHours: i.options.getString('office_hours') ?? undefined,
            room: i.options.getString('room') ?? undefined,
          }),
        );
        return;
      }
      if (lsub === 'edit') {
        const id = Number(i.options.getString('lecturer', true));
        if (!Number.isInteger(id)) {
          await reply('Wybierz prowadzącego z listy podpowiedzi.');
          return;
        }
        await reply(
          await editLecturer(db, id, {
            name: i.options.getString('name') ?? undefined,
            title: i.options.getString('title') ?? undefined,
            email: i.options.getString('email') ?? undefined,
            officeHours: i.options.getString('office_hours') ?? undefined,
            room: i.options.getString('room') ?? undefined,
          }),
        );
        return;
      }
      const lecturerId = Number(i.options.getString('lecturer', true));
      if (!Number.isInteger(lecturerId)) {
        await reply('Wybierz prowadzącego z listy podpowiedzi.');
        return;
      }
      await reply(
        await assignLecturer(db, {
          subjectCode: i.options.getString('subject', true),
          lecturerId,
          classKind: i.options.getString('class', true) as ClassKind,
          groupNumber: i.options.getInteger('group') ?? undefined,
        }),
      );
      return;
    }
    case 'class': {
      await reply(
        await editClass(db, {
          subjectCode: i.options.getString('subject', true),
          kind: i.options.getString('kind', true) as ClassKind,
          assessment:
            (i.options.getString('assessment') as Assessment | 'brak' | null) ??
            undefined,
          note: i.options.getString('note') ?? undefined,
          platformUrl: i.options.getString('platform_url') ?? undefined,
        }),
      );
      return;
    }
    case 'plan': {
      const now = new Date();
      await reply(
        i.options.getSubcommand() === 'sync'
          ? await planSyncReply(db, now)
          : await planStatusReply(db, now),
      );
      return;
    }
    case 'ban':
    case 'unban': {
      const target = i.options.getUser('user', true);
      // Make sure the user row exists so the ban applies even if they never
      // used the bot.
      await upsertUser(db, toDiscordUser(target));
      await reply(await banReply(db, target.id, name === 'ban'));
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
        await runSetup(deps, i);
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
