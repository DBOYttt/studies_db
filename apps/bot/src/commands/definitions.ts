import {
  ChannelType,
  type RESTPostAPIApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from 'discord.js';
import { LECTURER_ROLES } from './admin.js';

const subject = new SlashCommandBuilder()
  .setName('subject')
  .setDescription('Zarządzanie przedmiotami')
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
        o.setName('name').setDescription('Nazwa').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('code').setDescription('Kod').setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('semester')
          .setDescription('Semestr')
          .addChoices({ name: '1', value: 1 }, { name: '2', value: 2 })
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('ects')
          .setDescription('Punkty ECTS')
          .setMinValue(0)
          .setMaxValue(30)
          .setRequired(true),
      )
      .addStringOption((o) => o.setName('description').setDescription('Opis')),
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
      .addStringOption((o) => o.setName('name').setDescription('Nazwa'))
      .addIntegerOption((o) =>
        o
          .setName('semester')
          .setDescription('Semestr')
          .addChoices({ name: '1', value: 1 }, { name: '2', value: 2 }),
      )
      .addIntegerOption((o) =>
        o
          .setName('ects')
          .setDescription('Punkty ECTS')
          .setMinValue(0)
          .setMaxValue(30),
      )
      .addStringOption((o) => o.setName('description').setDescription('Opis')),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Lista przedmiotów'));

const lecturer = new SlashCommandBuilder()
  .setName('lecturer')
  .setDescription('Zarządzanie prowadzącymi')
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Dodaj prowadzącego')
      .addStringOption((o) =>
        o.setName('name').setDescription('Imię i nazwisko').setRequired(true),
      )
      .addStringOption((o) => o.setName('title').setDescription('Tytuł'))
      .addStringOption((o) => o.setName('email').setDescription('E-mail')),
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
          .setName('role')
          .setDescription('Rola')
          .addChoices(...LECTURER_ROLES.map((r) => ({ name: r, value: r })))
          .setRequired(true),
      ),
  );

const userCmd = (name: string, description: string) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addUserOption((o) =>
      o.setName('user').setDescription('Użytkownik').setRequired(true),
    );

export const commandDefinitions: RESTPostAPIApplicationCommandsJSONBody[] = [
  subject,
  lecturer,
  userCmd('ban', 'Zablokuj dostęp użytkownika do strony'),
  userCmd('unban', 'Odblokuj dostęp użytkownika do strony'),
  new SlashCommandBuilder()
    .setName('resync')
    .setDescription('Zsynchronizuj fora z bazą'),
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Otrzymaj link do logowania na stronie'),
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Szukaj materiałów')
    .addStringOption((o) =>
      o.setName('query').setDescription('Zapytanie').setRequired(true),
    ),
].map((c) => c.toJSON());
