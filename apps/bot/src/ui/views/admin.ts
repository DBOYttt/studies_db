/**
 * Admin panel views (Components V2). Pure: plain data in, builders out.
 * Task 9 loads the data and routes the `adm` ids; option values and id args
 * are codes, ids, kinds and numbers only, never free text.
 */
import {
  ASSESSMENT_NAMES,
  type Assessment,
  CLASS_KINDS,
  CLASS_NAMES,
  type ClassKind,
} from '@studies/db';
import {
  ActionRowBuilder,
  type ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { encodeId } from '../ids.js';
import { MAX_OPTIONS, MAX_TEXT } from '../limits.js';
import { button, clip, divider, row, text, type View, view } from './parts.js';

/* ---------- data ---------- */

export interface SubjectOption {
  code: string;
  name: string;
}

export interface LecturerOption {
  id: number;
  name: string;
  title: string | null;
}

export interface GroupOption {
  /** Group number, as `/lecturer assign` takes it. */
  number: number;
  name: string;
}

export interface SubjectCardData {
  code: string;
  name: string;
  semester: number;
  ects: number;
  description: string | null;
  platformUrl: string | null;
  channelId: string | null;
  classes: {
    kind: ClassKind;
    assessment: Assessment | null;
    assessmentNote: string | null;
    platformUrl: string | null;
    lecturers: { name: string; groupName: string | null }[];
  }[];
}

export interface LecturerCardData {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  officeHours: string | null;
  room: string | null;
}

export interface UserCardData {
  discordUserId: string;
  displayName: string;
  isAdmin: boolean;
  isBanned: boolean;
  /** First use of the bot; null when the user has no row yet. */
  createdAt: Date | null;
}

export interface StatusData {
  planText: string;
  jobs: { queued: number; running: number; failed: number };
  pending: number;
}

/* ---------- helpers ---------- */

const card = (head: string, sub?: string) =>
  new ContainerBuilder().addTextDisplayComponents(
    text(sub ? `## ${head}\n-# ${sub}` : `## ${head}`),
  );

export const lecturerLabel = (l: { title: string | null; name: string }) =>
  l.title ? `${l.title} ${l.name}` : l.name;

const warsawDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** One page of a list, the page clamped to the existing ones. */
function pageOf<T>(items: T[], page: number) {
  const pages = Math.max(1, Math.ceil(items.length / MAX_OPTIONS));
  const p = Math.min(
    Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0),
    pages - 1,
  );
  return {
    page: p,
    pages,
    items: items.slice(p * MAX_OPTIONS, (p + 1) * MAX_OPTIONS),
  };
}

/** ◀ ▶ buttons; the ids carry the target page (disabled ones never fire). */
const pager = (id: (page: number) => string, page: number, pages: number) => [
  button(id(page - 1), '◀').setDisabled(page === 0),
  button(id(page + 1), '▶').setDisabled(page >= pages - 1),
];

const selectRow = (select: StringSelectMenuBuilder) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

const pageHint = (page: number, pages: number) =>
  pages > 1 ? ` (${page + 1}/${pages})` : '';

/* ---------- panel and status ---------- */

export function adminPanel(): View {
  return view(
    card('Admin panel', 'Only you see the replies.')
      .addTextDisplayComponents(
        text('Timetable and server sync, subjects, lecturers and user access.'),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'status'),
            'Status and sync',
            ButtonStyle.Primary,
          ),
          button(encodeId('adm', 'subj', 'list', 0), 'Subjects'),
          button(encodeId('adm', 'lect', 'list', 0), 'Lecturers'),
          button(encodeId('adm', 'user', 'open'), 'Users'),
          button(encodeId('adm', 'web'), 'Web panel'),
        ),
      ),
  );
}

export function statusCard(s: StatusData): View {
  const { queued, running, failed } = s.jobs;
  return view(
    card('Status and sync')
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(
        text(`**Timetable**\n${clip(s.planText, 2000)}`),
        text(
          `**Jobs**\nQueued: ${queued} · Running: ${running} · Failed: ${failed}`,
        ),
        text(`**Materials being processed**\n${s.pending}`),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'plan', 'sync'),
            'Sync timetable',
            ButtonStyle.Primary,
          ),
          button(encodeId('adm', 'resync'), 'Fetch from Discord'),
          button(encodeId('adm', 'status'), 'Refresh'),
        ),
        row(
          button(encodeId('adm', 'setup', 'dry'), 'Preview /setup'),
          button(encodeId('adm', 'setup', 'ask'), 'Run /setup'),
        ),
      ),
  );
}

export function setupConfirm(): View {
  return view(
    card('Run /setup?')
      .addTextDisplayComponents(
        text(
          'The bot will create the missing forums, tags, categories and the admin role from the database, and update the pinned panels.',
        ),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'setup', 'run'),
            'Yes, run it',
            ButtonStyle.Danger,
          ),
          button(encodeId('adm', 'status'), 'Cancel'),
        ),
      ),
  );
}

/** Follow-up buttons under a report: back to status, or run /setup. */
export type ReportAction = 'status' | 'setup';

/** A titled report (setup plan, sync result); text cut at MAX_TEXT. */
export function reportView(
  title: string,
  body: string,
  actions: ReportAction[] = [],
): View {
  const head = `## ${clip(title, 200)}`;
  const c = new ContainerBuilder().addTextDisplayComponents(
    text(head),
    text(clip(body || '—', MAX_TEXT - head.length - 1)),
  );
  if (actions.length) {
    c.addSeparatorComponents(divider()).addActionRowComponents(
      row(
        ...actions.map((a) =>
          a === 'setup'
            ? button(
                encodeId('adm', 'setup', 'ask'),
                'Run /setup',
                ButtonStyle.Primary,
              )
            : button(encodeId('adm', 'status'), 'Back'),
        ),
      ),
    );
  }
  return view(c);
}

/* ---------- subjects and classes ---------- */

export function subjectPicker(subjects: SubjectOption[], page: number): View {
  const pg = pageOf(subjects, page);
  const c = card(
    'Subjects',
    subjects.length ? `${subjects.length} in the database` : 'No subjects.',
  );
  if (pg.items.length) {
    c.addActionRowComponents(
      selectRow(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('adm', 'subj', 'pick'))
          .setPlaceholder(`Choose a subject${pageHint(pg.page, pg.pages)}`)
          .addOptions(
            pg.items.map((s) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(clip(`${s.code} · ${s.name}`))
                .setValue(s.code),
            ),
          ),
      ),
    );
  }
  return view(
    c
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          ...pager(
            (p) => encodeId('adm', 'subj', 'list', p),
            pg.page,
            pg.pages,
          ),
          button(
            encodeId('adm', 'subj', 'add'),
            'Add subject',
            ButtonStyle.Primary,
          ),
        ),
      ),
  );
}

function classBlock(c: SubjectCardData['classes'][number]): string {
  const assessment = c.assessment
    ? ASSESSMENT_NAMES[c.assessment]
    : 'no assessment';
  const lines = [
    `**${CLASS_NAMES[c.kind]}** · ${assessment}${c.assessmentNote ? ` — ${c.assessmentNote}` : ''}`,
    c.lecturers.length
      ? c.lecturers
          .map((l) => (l.groupName ? `${l.name} (${l.groupName})` : l.name))
          .join(', ')
      : '-# no lecturers',
  ];
  if (c.platformUrl) lines.push(`-# Platform: ${c.platformUrl}`);
  return lines.join('\n');
}

export function subjectCard(s: SubjectCardData): View {
  const forum = s.channelId ? `<#${s.channelId}>` : 'no forum';
  const head = `## ${s.code} · ${clip(s.name, 200)}\n-# Semester ${s.semester} · ${s.ects} ECTS · ${forum}`;
  const about = [
    s.description ? clip(s.description, 1000) : null,
    s.platformUrl ? `Platform: ${s.platformUrl}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join('\n');

  const c = new ContainerBuilder().addTextDisplayComponents(text(head));
  let used = head.length;
  if (about) {
    c.addTextDisplayComponents(text(about));
    used += about.length + 1;
  }
  c.addSeparatorComponents(divider());

  const classes = [...s.classes].sort(
    (a, b) => CLASS_KINDS.indexOf(a.kind) - CLASS_KINDS.indexOf(b.kind),
  );
  if (classes.length === 0) {
    c.addTextDisplayComponents(text('-# No classes'));
  } else {
    const each = Math.floor((MAX_TEXT - used) / classes.length) - 1;
    for (const cls of classes) {
      c.addTextDisplayComponents(text(clip(classBlock(cls), each)));
    }
  }

  const existing = new Map(classes.map((x) => [x.kind, x]));
  return view(
    c
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        selectRow(
          new StringSelectMenuBuilder()
            .setCustomId(encodeId('adm', 'class', 'pick', s.code))
            .setPlaceholder('Choose a class')
            .addOptions(
              CLASS_KINDS.map((kind) => {
                const x = existing.get(kind);
                return new StringSelectMenuOptionBuilder()
                  .setLabel(CLASS_NAMES[kind])
                  .setValue(kind)
                  .setDescription(
                    !x
                      ? 'This class does not exist yet'
                      : x.assessment
                        ? ASSESSMENT_NAMES[x.assessment]
                        : 'No assessment',
                  );
              }),
            ),
        ),
      )
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'subj', 'edit', s.code),
            'Edit',
            ButtonStyle.Primary,
          ),
          button(encodeId('adm', 'subj', 'list', 0), 'All subjects'),
        ),
      ),
  );
}

export function classActions(code: string, kind: ClassKind): View {
  return view(
    card(`${code} · ${CLASS_NAMES[kind]}`, 'What do you want to change?')
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'class', 'edit', code, kind),
            'Edit class',
            ButtonStyle.Primary,
          ),
          button(
            encodeId('adm', 'assign', 'start', code, kind),
            'Assign lecturer',
          ),
        ),
      ),
  );
}

/**
 * Lecturer select (paged by 25; ◀ ▶ reuse `adm:assign:start:<code>:<kind>`
 * with the page as an extra arg), then, once `lecturerId` is chosen, a group
 * select whose value is the group number, `0` meaning the whole class.
 */
export function assignPicker(
  code: string,
  kind: ClassKind,
  lecturers: LecturerOption[],
  groups: GroupOption[],
  opts: { page?: number; lecturerId?: number } = {},
): View {
  const chosenAt = lecturers.findIndex((l) => l.id === opts.lecturerId);
  const pg = pageOf(
    lecturers,
    chosenAt >= 0 ? Math.floor(chosenAt / MAX_OPTIONS) : (opts.page ?? 0),
  );
  const c = card(
    `${code} · ${CLASS_NAMES[kind]}`,
    'Assign lecturer',
  ).addSeparatorComponents(divider());
  if (pg.items.length === 0) {
    c.addTextDisplayComponents(text('No lecturers. Add them in the panel.'));
  } else {
    c.addActionRowComponents(
      selectRow(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('adm', 'assign', 'lect', code, kind))
          .setPlaceholder(`Lecturer${pageHint(pg.page, pg.pages)}`)
          .addOptions(
            pg.items.map((l) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(clip(lecturerLabel(l)))
                .setValue(String(l.id))
                .setDefault(l.id === opts.lecturerId),
            ),
          ),
      ),
    );
  }
  if (chosenAt >= 0) {
    c.addActionRowComponents(
      selectRow(
        new StringSelectMenuBuilder()
          .setCustomId(
            encodeId(
              'adm',
              'assign',
              'grp',
              code,
              kind,
              lecturers[chosenAt].id,
            ),
          )
          .setPlaceholder('Group')
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel('Whole class')
              .setValue('0'),
            ...groups
              .slice(0, MAX_OPTIONS - 1)
              .map((g) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(clip(g.name))
                  .setValue(String(g.number)),
              ),
          ),
      ),
    );
    // One option is "Whole class"; later groups only via the slash command.
    const hidden = groups.length - (MAX_OPTIONS - 1);
    if (hidden > 0) {
      c.addTextDisplayComponents(
        text(`-# …and ${hidden} more. Use /lecturer assign`),
      );
    }
  }
  if (pg.pages > 1) {
    c.addActionRowComponents(
      row(
        ...pager(
          (p) => encodeId('adm', 'assign', 'start', code, kind, p),
          pg.page,
          pg.pages,
        ),
      ),
    );
  }
  return view(c);
}

/* ---------- lecturers ---------- */

export function lecturerPicker(
  lecturers: LecturerOption[],
  page: number,
): View {
  const pg = pageOf(lecturers, page);
  const c = card(
    'Lecturers',
    lecturers.length ? `${lecturers.length} in the database` : 'No lecturers.',
  );
  if (pg.items.length) {
    c.addActionRowComponents(
      selectRow(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('adm', 'lect', 'pick'))
          .setPlaceholder(`Choose a lecturer${pageHint(pg.page, pg.pages)}`)
          .addOptions(
            pg.items.map((l) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(clip(lecturerLabel(l)))
                .setValue(String(l.id)),
            ),
          ),
      ),
    );
  }
  return view(
    c
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          ...pager(
            (p) => encodeId('adm', 'lect', 'list', p),
            pg.page,
            pg.pages,
          ),
          button(
            encodeId('adm', 'lect', 'add'),
            'Add lecturer',
            ButtonStyle.Primary,
          ),
        ),
      ),
  );
}

export function lecturerCard(l: LecturerCardData): View {
  const lines = [
    ['Email', l.email],
    ['Office hours', l.officeHours],
    ['Room', l.room],
  ].map(([k, v]) => `${k}: ${v ?? '—'}`);
  return view(
    card(clip(lecturerLabel(l), 250))
      .addTextDisplayComponents(text(lines.join('\n')))
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'lect', 'edit', l.id),
            'Edit',
            ButtonStyle.Primary,
          ),
          button(encodeId('adm', 'lect', 'list', 0), 'All lecturers'),
        ),
      ),
  );
}

/* ---------- users ---------- */

export function userPicker(): View {
  return view(
    card('Users', 'Choose a person from the server.').addActionRowComponents(
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(encodeId('adm', 'user', 'pick'))
          .setPlaceholder('User'),
      ),
    ),
  );
}

const yesNo = (b: boolean) => (b ? 'yes' : 'no');

/** A display name for one-line headings and bold text. */
const oneLine = (s: string) =>
  clip(s.replace(/[\r\n]+/g, ' ').trim() || '—', 100);

export function userCard(u: UserCardData, isSelf: boolean): View {
  const action: ButtonBuilder = u.isBanned
    ? button(
        encodeId('adm', 'user', 'unban', u.discordUserId),
        'Unblock',
        ButtonStyle.Primary,
      )
    : button(
        encodeId('adm', 'user', 'ban', u.discordUserId),
        'Block',
        ButtonStyle.Danger,
      );
  const c = card(oneLine(u.displayName), `<@${u.discordUserId}>`)
    .addTextDisplayComponents(
      text(
        [
          `Admin: ${yesNo(u.isAdmin)}`,
          `Website access: ${u.isBanned ? 'blocked' : 'active'}`,
          `First use: ${u.createdAt ? warsawDate.format(u.createdAt) : 'has not used the bot yet'}`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(divider());
  if (isSelf) {
    c.addTextDisplayComponents(text('-# You cannot block yourself.'));
  }
  return view(
    c.addActionRowComponents(
      row(
        action.setDisabled(isSelf),
        button(encodeId('adm', 'user', 'open'), 'Another user'),
      ),
    ),
  );
}

/** Confirm step; `banned` is the state being confirmed. */
export function banConfirm(u: UserCardData, banned: boolean): View {
  const name = oneLine(u.displayName);
  return view(
    card(banned ? 'Block access?' : 'Unblock access?')
      .addTextDisplayComponents(
        text(
          banned
            ? `**${name}** will not be able to log in to the website.`
            : `**${name}** will be able to log in to the website again.`,
        ),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          banned
            ? button(
                encodeId('adm', 'user', 'banok', u.discordUserId),
                'Yes, block',
                ButtonStyle.Danger,
              )
            : button(
                encodeId('adm', 'user', 'unbanok', u.discordUserId),
                'Yes, unblock',
                ButtonStyle.Primary,
              ),
          button(encodeId('adm', 'user', 'open'), 'Cancel'),
        ),
      ),
  );
}
