import {
  type ActionResult,
  type Assessment,
  addLecturer,
  addSubject,
  assignLecturer,
  banUser,
  type ClassKind,
  type createDb,
  editClass,
  editLecturer,
  editSubject,
  getSetting,
  lecturers,
  listSubjects,
  type RateLimiter,
  type Semester,
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
import {
  isBannedDiscordUser,
  memberRoleIds,
  syncAdminFlag,
} from '../admin-flag.js';
import { auditDiscord } from '../audit.js';
import { discordForumSource } from '../catchup.js';
import { ADMIN_ROLE_SETTING, type BotConfig } from '../config.js';
import { toDiscordUser } from '../discord/map.js';
import type { IngestDeps } from '../ingest.js';
import {
  type Audit,
  BUSY_TEXT,
  runResync,
  runSetup,
  withSetupLock,
} from '../ops.js';
import { findSubjectByChannel, syncForumTags } from '../sync.js';
import { handleUi, openAdminPanel, openStudentPanel } from '../ui/router.js';
import { notice } from '../ui/views/student.js';
import { runEventAdd } from './event.js';
import { planStatusReply, planSyncReply } from './plan.js';
import { replyOptions } from './reply.js';
import {
  LINK_BANNED,
  LINK_DM_CLOSED,
  LINK_SENT,
  linkFor,
  searchReply,
  sendLoginDm,
} from './student.js';

export type RouterDeps = {
  ingest: IngestDeps;
  client: Client;
  config: BotConfig;
  /** Raw pool for the shared plan queries (`@studies/db/plan`). */
  pool: ReturnType<typeof createDb>['pool'];
  /** "Import from UniTime" overrides (tests); defaults are the real ones. */
  groupImport?: {
    fetchImpl?: typeof fetch;
    limiter?: RateLimiter;
    env?: NodeJS.ProcessEnv;
  };
};

const ADMIN_COMMANDS = new Set([
  'subject',
  'lecturer',
  'class',
  'plan',
  'ban',
  'unban',
  'resync',
  'admin',
]);
const ERROR_TEXT = 'Something went wrong. Try again later.';
const FORUM_VISIBILITY_WARNING =
  'Warning: the bot cannot see this forum. Check its permissions (View Channel, Read Message History).';
const MAX_LEN = 2000;

/** A V2 text notice (no `content`), for editing a deferred V2 response. */
const uiNotice = (text: string) => {
  const v = notice(text);
  return {
    components: v.components,
    flags: v.flags,
    allowedMentions: { parse: [] as never[] },
  };
};

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
  let banned: boolean | undefined;
  try {
    ({
      roleId: synced,
      userId: callerId,
      isBanned: banned,
    } = await syncAdminFlag(db, callerOf(i), memberRoleIds(i)));
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
  // A banned admin is refused every admin command, /setup included (R6).
  if (needsAdmin && banned === undefined)
    banned = await isBannedDiscordUser(db, i.user.id);
  const allowed =
    name === 'setup'
      ? !banned && canRunSetup(i, roleId)
      : !needsAdmin || (!banned && isAdmin(i, roleId));
  if (!allowed) {
    await reply('You do not have permission.');
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
          semester: i.options.getInteger('semester', true) as Semester,
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
                await discordForumSource(
                  deps.client,
                  deps.config.discordGuildId,
                ).listTags(channel.id),
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
        semester: semester === null ? undefined : (semester as Semester),
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
          result.id === undefined ? null : String(result.id),
          { name },
        );
        return;
      }
      if (lsub === 'edit') {
        const id = Number(i.options.getString('lecturer', true));
        if (!Number.isInteger(id)) {
          await reply('Choose a lecturer from the suggestions.');
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
        await reply('Choose a lecturer from the suggestions.');
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
      const result = await withSetupLock(async () => {
        await i.deferReply(eph);
        if (!i.guild) throw new Error('/setup outside a guild');
        const text = await runSetup(
          deps,
          i.guild,
          i.user.id,
          i.options.getBoolean('dry_run') === true,
          audit,
        );
        await i.editReply(replyOptions(text));
      });
      if (result === 'busy') await reply(BUSY_TEXT);
      return;
    }
    case 'resync': {
      // Under the /setup lock: a catch-up during /setup could race it.
      const result = await withSetupLock(async () => {
        await i.deferReply(eph);
        await i.editReply(replyOptions(await runResync(deps, audit)));
      });
      if (result === 'busy') await reply(BUSY_TEXT);
      return;
    }
    case 'admin': {
      await openAdminPanel(i);
      return;
    }
    case 'link': {
      const res = await linkFor(
        db,
        deps.config.webBaseUrl,
        toDiscordUser(i.user, i.member as never),
      );
      if (!res.ok) {
        await reply(LINK_BANNED);
        return;
      }
      await i.deferReply(eph);
      const sent = await sendLoginDm(i.user, res.url);
      await i.editReply(replyOptions(sent ? LINK_SENT : LINK_DM_CLOSED));
      return;
    }
    case 'event': {
      await runEventAdd(deps, i, callerId, callerOf(i));
      return;
    }
    case 'panel': {
      await openStudentPanel(i, deps, callerId);
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

export const OTHER_GUILD_TEXT = 'This bot only works on its own server.';

export function createInteractionHandler(deps: RouterDeps) {
  return async (interaction: Interaction): Promise<void> => {
    try {
      // Commands are registered only in the configured server and the bot
      // sends no components in DMs: anything else is refused before it runs.
      if (
        !deps.config.discordGuildId ||
        interaction.guildId !== deps.config.discordGuildId
      ) {
        if (interaction.isRepliable())
          await interaction.reply(replyOptions(OTHER_GUILD_TEXT, true));
        return;
      }
      if (interaction.isAutocomplete()) {
        await autocomplete(deps, interaction);
      } else if (interaction.isChatInputCommand()) {
        await runCommand(deps, interaction);
      } else if (
        interaction.isButton() ||
        interaction.isStringSelectMenu() ||
        interaction.isUserSelectMenu() ||
        interaction.isModalSubmit()
      ) {
        await handleUi(deps, interaction);
      }
    } catch (err) {
      console.error('interaction failed', err);
      if (interaction.isAutocomplete() || !interaction.isRepliable()) return;
      try {
        const content = ERROR_TEXT;
        // A deferred UI response is a V2 view (or a pending ephemeral
        // reply): replace it with a V2 notice, since `content` can't be set
        // on a V2 message. Fall back to a separate ephemeral notice.
        const isUi = !interaction.isChatInputCommand();
        if (interaction.deferred && isUi) {
          try {
            await interaction.editReply(uiNotice(content));
          } catch (err3) {
            console.error('failed to edit the deferred response', err3);
            await interaction.followUp({
              ...uiNotice(content),
              flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
          }
        } else if (interaction.deferred)
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
