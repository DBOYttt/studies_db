import {
  ASSESSMENT_NAMES,
  ASSESSMENTS,
  CLASS_KINDS,
  CLASS_NAMES,
} from '@studies/db';
import { EVENT_KIND_KEYS, EVENT_KINDS } from '@studies/db/constants';
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
  .setDescription('Manage subjects')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add a subject')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Forum channel')
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Name')
          .setMaxLength(FIELD_MAX.subjectName)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('code')
          .setDescription('Code')
          .setMaxLength(FIELD_MAX.subjectCode)
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('semester')
          .setDescription('Semester')
          .addChoices(...SEMESTERS.map((n) => ({ name: String(n), value: n })))
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('ects')
          .setDescription('ECTS points')
          .setMinValue(ECTS_MIN)
          .setMaxValue(ECTS_MAX)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Description')
          .setMaxLength(FIELD_MAX.description),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Edit a subject')
      .addStringOption((o) =>
        o
          .setName('code')
          .setDescription('Subject code')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Name')
          .setMaxLength(FIELD_MAX.subjectName),
      )
      .addIntegerOption((o) =>
        o
          .setName('semester')
          .setDescription('Semester')
          .addChoices(...SEMESTERS.map((n) => ({ name: String(n), value: n }))),
      )
      .addIntegerOption((o) =>
        o
          .setName('ects')
          .setDescription('ECTS points')
          .setMinValue(ECTS_MIN)
          .setMaxValue(ECTS_MAX),
      )
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Description')
          .setMaxLength(FIELD_MAX.description),
      )
      .addStringOption((o) =>
        o
          .setName('platform_url')
          .setDescription('Platform URL (- clears)')
          .setMaxLength(FIELD_MAX.platformUrl),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('List subjects'));

const lecturer = new SlashCommandBuilder()
  .setName('lecturer')
  .setDescription('Manage lecturers')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add a lecturer')
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Full name')
          .setMaxLength(FIELD_MAX.lecturerName)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('title')
          .setDescription('Title')
          .setMaxLength(FIELD_MAX.lecturerTitle),
      )
      .addStringOption((o) =>
        o
          .setName('email')
          .setDescription('Email')
          .setMaxLength(FIELD_MAX.email),
      )
      .addStringOption((o) =>
        o
          .setName('office_hours')
          .setDescription('Office hours')
          .setMaxLength(FIELD_MAX.officeHours),
      )
      .addStringOption((o) =>
        o.setName('room').setDescription('Room').setMaxLength(FIELD_MAX.room),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Edit a lecturer (- clears the field)')
      .addStringOption((o) =>
        o
          .setName('lecturer')
          .setDescription('Lecturer')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Full name')
          .setMaxLength(FIELD_MAX.lecturerName),
      )
      .addStringOption((o) =>
        o
          .setName('title')
          .setDescription('Title')
          .setMaxLength(FIELD_MAX.lecturerTitle),
      )
      .addStringOption((o) =>
        o
          .setName('email')
          .setDescription('Email')
          .setMaxLength(FIELD_MAX.email),
      )
      .addStringOption((o) =>
        o
          .setName('office_hours')
          .setDescription('Office hours')
          .setMaxLength(FIELD_MAX.officeHours),
      )
      .addStringOption((o) =>
        o.setName('room').setDescription('Room').setMaxLength(FIELD_MAX.room),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('assign')
      .setDescription('Assign a lecturer to a subject')
      .addStringOption((o) =>
        o
          .setName('subject')
          .setDescription('Subject')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('lecturer')
          .setDescription('Lecturer')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('class')
          .setDescription('Class type')
          .addChoices(
            ...CLASS_KINDS.map((k) => ({ name: CLASS_NAMES[k], value: k })),
          )
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('group')
          .setDescription('Group number')
          .setMinValue(GROUP_MIN)
          .setMaxValue(GROUP_MAX),
      ),
  );

const classCmd = new SlashCommandBuilder()
  .setName('class')
  .setDescription('Manage classes')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Edit a class (- clears the field)')
      .addStringOption((o) =>
        o
          .setName('subject')
          .setDescription('Subject')
          .setAutocomplete(true)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('kind')
          .setDescription('Class type')
          .addChoices(
            ...CLASS_KINDS.map((k) => ({ name: CLASS_NAMES[k], value: k })),
          )
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('assessment')
          .setDescription('Assessment')
          .addChoices(
            ...ASSESSMENTS.map((a) => ({
              name: ASSESSMENT_NAMES[a],
              value: a,
            })),
            { name: 'None (clear)', value: 'brak' },
          ),
      )
      .addStringOption((o) =>
        o
          .setName('note')
          .setDescription('Notes')
          .setMaxLength(FIELD_MAX.classNote),
      )
      .addStringOption((o) =>
        o
          .setName('platform_url')
          .setDescription('Platform URL')
          .setMaxLength(FIELD_MAX.platformUrl),
      ),
  );

const planCmd = new SlashCommandBuilder()
  .setName('plan')
  .setDescription('Timetable sync')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s.setName('sync').setDescription('Request a timetable sync'),
  )
  .addSubcommand((s) =>
    s.setName('status').setDescription('Timetable sync status'),
  );

const userCmd = (name: string, description: string) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) =>
      o.setName('user').setDescription('User').setRequired(true),
    );

const eventCmd = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Events: tests, exams, trips')
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add an event')
      .addStringOption((o) =>
        o
          .setName('kind')
          .setDescription('Type')
          .addChoices(
            ...EVENT_KIND_KEYS.map((k) => ({
              name: EVENT_KINDS[k].label,
              value: k,
            })),
          )
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('title')
          .setDescription('Title')
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('when')
          .setDescription('When: DD.MM[.YYYY] [HH:MM[-HH:MM]]')
          .setMaxLength(40)
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('subject')
          .setDescription('Subject (code)')
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o.setName('place').setDescription('Place').setMaxLength(100),
      )
      .addStringOption((o) =>
        o.setName('note').setDescription('Note').setMaxLength(1000),
      )
      .addStringOption((o) =>
        o
          .setName('class')
          .setDescription('Class of the subject')
          .addChoices(
            ...CLASS_KINDS.map((k) => ({ name: CLASS_NAMES[k], value: k })),
          ),
      )
      .addIntegerOption((o) =>
        o
          .setName('group')
          .setDescription('Group number')
          .setMinValue(GROUP_MIN)
          .setMaxValue(GROUP_MAX),
      )
      .addStringOption((o) =>
        o
          .setName('repeat')
          .setDescription('Repeat')
          .addChoices(
            { name: 'every week', value: 'weekly' },
            { name: 'every 2 weeks', value: 'biweekly' },
          ),
      )
      .addStringOption((o) =>
        o
          .setName('until')
          .setDescription('Repeat until: DD.MM[.YYYY]')
          .setMaxLength(20),
      ),
  );

export const commandDefinitions: RESTPostAPIApplicationCommandsJSONBody[] = [
  subject,
  lecturer,
  classCmd,
  planCmd,
  eventCmd,
  userCmd('ban', "Block a user's access to the website"),
  userCmd('unban', "Unblock a user's access to the website"),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription(
      'Create forums, tags, categories and the admin role from the database',
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) =>
      o
        .setName('dry_run')
        .setDescription('Only show the plan, make no changes'),
    ),
  new SlashCommandBuilder()
    .setName('resync')
    .setDescription('Sync the forums with the database')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open the admin panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Get a login link for the website'),
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the panel: timetable, My groups, login'),
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search materials')
    .addStringOption((o) =>
      o.setName('query').setDescription('Query').setRequired(true),
    ),
].map((c) => c.toJSON());
