import {
  ASSESSMENT_NAMES,
  ASSESSMENTS,
  CLASS_KINDS,
  CLASS_NAMES,
} from '@studies/db';
import {
  ChannelType,
  PermissionFlagsBits,
  type RESTPostAPIApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from 'discord.js';
import {
  ECTS_MAX,
  ECTS_MIN,
  FIELD_MAX,
  GROUP_MAX,
  GROUP_MIN,
  SEMESTERS,
} from './fields.js';

const subject = new SlashCommandBuilder()
  .setName('subject')
  .setDescription('Zarządzanie przedmiotami')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Dodaj przedmiot')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Kanał forum')
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Nazwa')
          .setMaxLength(FIELD_MAX.subjectName)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('code')
          .setDescription('Kod')
          .setMaxLength(FIELD_MAX.subjectCode)
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('semester')
          .setDescription('Semestr')
          .addChoices(...SEMESTERS.map((n) => ({ name: String(n), value: n })))
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('ects')
          .setDescription('Punkty ECTS')
          .setMinValue(ECTS_MIN)
          .setMaxValue(ECTS_MAX)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Opis')
          .setMaxLength(FIELD_MAX.description),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Edytuj przedmiot')
      .addStringOption((o) =>
        o
          .setName('code')
          .setDescription('Kod przedmiotu')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Nazwa')
          .setMaxLength(FIELD_MAX.subjectName),
      )
      .addIntegerOption((o) =>
        o
          .setName('semester')
          .setDescription('Semestr')
          .addChoices(...SEMESTERS.map((n) => ({ name: String(n), value: n }))),
      )
      .addIntegerOption((o) =>
        o
          .setName('ects')
          .setDescription('Punkty ECTS')
          .setMinValue(ECTS_MIN)
          .setMaxValue(ECTS_MAX),
      )
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Opis')
          .setMaxLength(FIELD_MAX.description),
      )
      .addStringOption((o) =>
        o
          .setName('platform_url')
          .setDescription('Adres platformy (- usuwa)')
          .setMaxLength(FIELD_MAX.platformUrl),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Lista przedmiotów'));

const lecturer = new SlashCommandBuilder()
  .setName('lecturer')
  .setDescription('Zarządzanie prowadzącymi')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Dodaj prowadzącego')
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Imię i nazwisko')
          .setMaxLength(FIELD_MAX.lecturerName)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('title')
          .setDescription('Tytuł')
          .setMaxLength(FIELD_MAX.lecturerTitle),
      )
      .addStringOption((o) =>
        o
          .setName('email')
          .setDescription('E-mail')
          .setMaxLength(FIELD_MAX.email),
      )
      .addStringOption((o) =>
        o
          .setName('office_hours')
          .setDescription('Konsultacje')
          .setMaxLength(FIELD_MAX.officeHours),
      )
      .addStringOption((o) =>
        o.setName('room').setDescription('Pokój').setMaxLength(FIELD_MAX.room),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Edytuj prowadzącego (- usuwa pole)')
      .addStringOption((o) =>
        o
          .setName('lecturer')
          .setDescription('Prowadzący')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Imię i nazwisko')
          .setMaxLength(FIELD_MAX.lecturerName),
      )
      .addStringOption((o) =>
        o
          .setName('title')
          .setDescription('Tytuł')
          .setMaxLength(FIELD_MAX.lecturerTitle),
      )
      .addStringOption((o) =>
        o
          .setName('email')
          .setDescription('E-mail')
          .setMaxLength(FIELD_MAX.email),
      )
      .addStringOption((o) =>
        o
          .setName('office_hours')
          .setDescription('Konsultacje')
          .setMaxLength(FIELD_MAX.officeHours),
      )
      .addStringOption((o) =>
        o.setName('room').setDescription('Pokój').setMaxLength(FIELD_MAX.room),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('assign')
      .setDescription('Przypisz prowadzącego do przedmiotu')
      .addStringOption((o) =>
        o
          .setName('subject')
          .setDescription('Przedmiot')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('lecturer')
          .setDescription('Prowadzący')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('class')
          .setDescription('Rodzaj zajęć')
          .addChoices(
            ...CLASS_KINDS.map((k) => ({ name: CLASS_NAMES[k], value: k })),
          )
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('group')
          .setDescription('Numer grupy')
          .setMinValue(GROUP_MIN)
          .setMaxValue(GROUP_MAX),
      ),
  );

const classCmd = new SlashCommandBuilder()
  .setName('class')
  .setDescription('Zarządzanie zajęciami')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Edytuj zajęcia (- usuwa pole)')
      .addStringOption((o) =>
        o
          .setName('subject')
          .setDescription('Przedmiot')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('kind')
          .setDescription('Rodzaj zajęć')
          .addChoices(
            ...CLASS_KINDS.map((k) => ({ name: CLASS_NAMES[k], value: k })),
          )
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('assessment')
          .setDescription('Forma zaliczenia')
          .addChoices(
            ...ASSESSMENTS.map((a) => ({
              name: ASSESSMENT_NAMES[a],
              value: a,
            })),
            { name: 'Brak (usuń)', value: 'brak' },
          ),
      )
      .addStringOption((o) =>
        o
          .setName('note')
          .setDescription('Uwagi')
          .setMaxLength(FIELD_MAX.classNote),
      )
      .addStringOption((o) =>
        o
          .setName('platform_url')
          .setDescription('Adres platformy')
          .setMaxLength(FIELD_MAX.platformUrl),
      ),
  );

const planCmd = new SlashCommandBuilder()
  .setName('plan')
  .setDescription('Synchronizacja planu zajęć')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s.setName('sync').setDescription('Zleć synchronizację planu'),
  )
  .addSubcommand((s) =>
    s.setName('status').setDescription('Status synchronizacji planu'),
  );

const userCmd = (name: string, description: string) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) =>
      o.setName('user').setDescription('Użytkownik').setRequired(true),
    );

export const commandDefinitions: RESTPostAPIApplicationCommandsJSONBody[] = [
  subject,
  lecturer,
  classCmd,
  planCmd,
  userCmd('ban', 'Zablokuj dostęp użytkownika do strony'),
  userCmd('unban', 'Odblokuj dostęp użytkownika do strony'),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Utwórz fora, tagi, kategorie i rolę admina z bazy')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) =>
      o.setName('dry_run').setDescription('Tylko pokaż plan, bez zmian'),
    ),
  new SlashCommandBuilder()
    .setName('resync')
    .setDescription('Zsynchronizuj fora z bazą')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Otrzymaj link do logowania na stronie'),
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Otwórz panel: plan zajęć, Moje grupy, logowanie'),
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Szukaj materiałów')
    .addStringOption((o) =>
      o.setName('query').setDescription('Zapytanie').setRequired(true),
    ),
].map((c) => c.toJSON());
