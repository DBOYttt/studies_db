import { lecturers, subjects } from '@studies/db';
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  MessageFlags,
} from 'discord.js';
import { like, or } from 'drizzle-orm';
import { catchUp, discordForumSource } from '../catchup.js';
import type { BotConfig } from '../config.js';
import { toDiscordUser } from '../discord/map.js';
import type { IngestDeps } from '../ingest.js';
import { findSubjectByChannel, syncForumTags } from '../sync.js';
import {
  addLecturer,
  addSubject,
  assignLecturer,
  banReply,
  editSubject,
  type LecturerRole,
  listSubjects,
} from './admin.js';
import { linkFor, searchReply } from './student.js';

export type RouterDeps = {
  ingest: IngestDeps;
  client: Client;
  config: BotConfig;
};

const ADMIN_COMMANDS = new Set([
  'subject',
  'lecturer',
  'ban',
  'unban',
  'resync',
]);
const ERROR_TEXT = 'Wystąpił błąd. Spróbuj ponownie później.';
const MAX_LEN = 2000;

const truncate = (s: string) =>
  s.length <= MAX_LEN ? s : `${s.slice(0, MAX_LEN - 1)}…`;

function isAdmin(i: ChatInputCommandInteraction, adminRoleId: string): boolean {
  const roles = i.member?.roles;
  if (!roles) return false;
  return Array.isArray(roles)
    ? roles.includes(adminRoleId)
    : roles.cache.has(adminRoleId);
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

async function runCommand(
  deps: RouterDeps,
  i: ChatInputCommandInteraction,
): Promise<void> {
  const { db } = deps.ingest;
  const eph = { flags: MessageFlags.Ephemeral } as const;
  const reply = (content: string) => i.reply({ content, ...eph });
  const name = i.commandName;

  if (ADMIN_COMMANDS.has(name) && !isAdmin(i, deps.config.adminRoleId)) {
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
        if (text.startsWith('Dodano')) {
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
        }),
      );
      return;
    }
    case 'lecturer': {
      if (i.options.getSubcommand() === 'add') {
        await reply(
          await addLecturer(db, {
            name: i.options.getString('name', true),
            title: i.options.getString('title') ?? undefined,
            email: i.options.getString('email') ?? undefined,
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
          role: i.options.getString('role', true) as LecturerRole,
        }),
      );
      return;
    }
    case 'ban':
    case 'unban':
      await reply(
        await banReply(db, i.options.getUser('user', true).id, name === 'ban'),
      );
      return;
    case 'resync': {
      await i.deferReply(eph);
      const r = await catchUp(deps.ingest, discordForumSource(deps.client), {
        ignoreWatermark: true,
      });
      await i.editReply(
        `Zsynchronizowano: ${r.topics} tematów, ${r.created} nowych plików, ${r.failed} błędów.`,
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
        await i.user.send(
          `Twój link do Studies DB (ważny 15 minut, jednorazowy): ${res.url}`,
        );
      } catch {
        await i.editReply(
          'Nie mogę wysłać DM — włącz wiadomości prywatne od członków serwera.',
        );
        return;
      }
      await i.editReply('Wysłałem Ci link w wiadomości prywatnej.');
      return;
    }
    case 'search': {
      await i.deferReply();
      await i.editReply(
        truncate(
          await searchReply(
            db,
            deps.config.webBaseUrl,
            i.options.getString('query', true),
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
        if (interaction.deferred) await interaction.editReply(content);
        else if (interaction.replied) {
          await interaction.followUp({
            content,
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (err2) {
        console.error('failed to report interaction error', err2);
      }
    }
  };
}
