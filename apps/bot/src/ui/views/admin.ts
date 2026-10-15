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

const warsawDate = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  day: '2-digit',
  month: '2-digit',
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
    card('Panel administratora', 'Odpowiedzi widzisz tylko Ty.')
      .addTextDisplayComponents(
        text(
          'Synchronizacja planu i serwera, przedmioty, prowadzący i dostęp użytkowników.',
        ),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'status'),
            'Status i synchronizacja',
            ButtonStyle.Primary,
          ),
          button(encodeId('adm', 'subj', 'list', 0), 'Przedmioty'),
          button(encodeId('adm', 'lect', 'list', 0), 'Prowadzący'),
          button(encodeId('adm', 'user', 'open'), 'Użytkownicy'),
          button(encodeId('adm', 'web'), 'Panel www'),
        ),
      ),
  );
}

export function statusCard(s: StatusData): View {
  const { queued, running, failed } = s.jobs;
  return view(
    card('Status i synchronizacja')
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(
        text(`**Plan zajęć**\n${clip(s.planText, 2000)}`),
        text(
          `**Zadania**\nW kolejce: ${queued} · W toku: ${running} · Błędy: ${failed}`,
        ),
        text(`**Materiały w przetwarzaniu**\n${s.pending}`),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'plan', 'sync'),
            'Synchronizuj plan',
            ButtonStyle.Primary,
          ),
          button(encodeId('adm', 'resync'), 'Pobierz z Discorda'),
          button(encodeId('adm', 'status'), 'Odśwież'),
        ),
        row(
          button(encodeId('adm', 'setup', 'dry'), 'Podgląd /setup'),
          button(encodeId('adm', 'setup', 'ask'), 'Uruchom /setup'),
        ),
      ),
  );
}

export function setupConfirm(): View {
  return view(
    card('Uruchomić /setup?')
      .addTextDisplayComponents(
        text(
          'Bot utworzy brakujące fora, tagi, kategorie i rolę admina z bazy oraz zaktualizuje przypięte panele.',
        ),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'setup', 'run'),
            'Tak, uruchom',
            ButtonStyle.Danger,
          ),
          button(encodeId('adm', 'status'), 'Anuluj'),
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
                'Uruchom /setup',
                ButtonStyle.Primary,
              )
            : button(encodeId('adm', 'status'), 'Wróć'),
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
    'Przedmioty',
    subjects.length ? `${subjects.length} w bazie` : 'Brak przedmiotów.',
  );
  if (pg.items.length) {
    c.addActionRowComponents(
      selectRow(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('adm', 'subj', 'pick'))
          .setPlaceholder(`Wybierz przedmiot${pageHint(pg.page, pg.pages)}`)
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
            'Dodaj przedmiot',
            ButtonStyle.Primary,
          ),
        ),
      ),
  );
}

function classBlock(c: SubjectCardData['classes'][number]): string {
  const assessment = c.assessment
    ? ASSESSMENT_NAMES[c.assessment]
    : 'bez formy zaliczenia';
  const lines = [
    `**${CLASS_NAMES[c.kind]}** · ${assessment}${c.assessmentNote ? ` — ${c.assessmentNote}` : ''}`,
    c.lecturers.length
      ? c.lecturers
          .map((l) => (l.groupName ? `${l.name} (${l.groupName})` : l.name))
          .join(', ')
      : '-# brak prowadzących',
  ];
  if (c.platformUrl) lines.push(`-# Platforma: ${c.platformUrl}`);
  return lines.join('\n');
}

export function subjectCard(s: SubjectCardData): View {
  const forum = s.channelId ? `<#${s.channelId}>` : 'brak forum';
  const head = `## ${s.code} · ${clip(s.name, 200)}\n-# Semestr ${s.semester} · ${s.ects} ECTS · ${forum}`;
  const about = [
    s.description ? clip(s.description, 1000) : null,
    s.platformUrl ? `Platforma: ${s.platformUrl}` : null,
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
    c.addTextDisplayComponents(text('-# Brak zajęć'));
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
            .setPlaceholder('Wybierz zajęcia')
            .addOptions(
              CLASS_KINDS.map((kind) => {
                const x = existing.get(kind);
                return new StringSelectMenuOptionBuilder()
                  .setLabel(CLASS_NAMES[kind])
                  .setValue(kind)
                  .setDescription(
                    !x
                      ? 'Jeszcze nie ma tych zajęć'
                      : x.assessment
                        ? ASSESSMENT_NAMES[x.assessment]
                        : 'Bez formy zaliczenia',
                  );
              }),
            ),
        ),
      )
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'subj', 'edit', s.code),
            'Edytuj',
            ButtonStyle.Primary,
          ),
          button(encodeId('adm', 'subj', 'list', 0), 'Wszystkie przedmioty'),
        ),
      ),
  );
}

export function classActions(code: string, kind: ClassKind): View {
  return view(
    card(`${code} · ${CLASS_NAMES[kind]}`, 'Co chcesz zmienić?')
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'class', 'edit', code, kind),
            'Edytuj zajęcia',
            ButtonStyle.Primary,
          ),
          button(
            encodeId('adm', 'assign', 'start', code, kind),
            'Przypisz prowadzącego',
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
    'Przypisz prowadzącego',
  ).addSeparatorComponents(divider());
  if (pg.items.length === 0) {
    c.addTextDisplayComponents(text('Brak prowadzących. Dodaj ich w panelu.'));
  } else {
    c.addActionRowComponents(
      selectRow(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('adm', 'assign', 'lect', code, kind))
          .setPlaceholder(`Prowadzący${pageHint(pg.page, pg.pages)}`)
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
          .setPlaceholder('Grupa')
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel('Całe zajęcia')
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
    // One option is "Całe zajęcia"; later groups only via the slash command.
    const hidden = groups.length - (MAX_OPTIONS - 1);
    if (hidden > 0) {
      c.addTextDisplayComponents(
        text(`-# …i ${hidden} więcej — użyj /lecturer assign`),
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
    'Prowadzący',
    lecturers.length ? `${lecturers.length} w bazie` : 'Brak prowadzących.',
  );
  if (pg.items.length) {
    c.addActionRowComponents(
      selectRow(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('adm', 'lect', 'pick'))
          .setPlaceholder(`Wybierz prowadzącego${pageHint(pg.page, pg.pages)}`)
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
            'Dodaj prowadzącego',
            ButtonStyle.Primary,
          ),
        ),
      ),
  );
}

export function lecturerCard(l: LecturerCardData): View {
  const lines = [
    ['E-mail', l.email],
    ['Konsultacje', l.officeHours],
    ['Pokój', l.room],
  ].map(([k, v]) => `${k}: ${v ?? '—'}`);
  return view(
    card(clip(lecturerLabel(l), 250))
      .addTextDisplayComponents(text(lines.join('\n')))
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('adm', 'lect', 'edit', l.id),
            'Edytuj',
            ButtonStyle.Primary,
          ),
          button(encodeId('adm', 'lect', 'list', 0), 'Wszyscy prowadzący'),
        ),
      ),
  );
}

/* ---------- users ---------- */

export function userPicker(): View {
  return view(
    card('Użytkownicy', 'Wybierz osobę z serwera.').addActionRowComponents(
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(encodeId('adm', 'user', 'pick'))
          .setPlaceholder('Użytkownik'),
      ),
    ),
  );
}

const yesNo = (b: boolean) => (b ? 'tak' : 'nie');

/** A display name for one-line headings and bold text. */
const oneLine = (s: string) =>
  clip(s.replace(/[\r\n]+/g, ' ').trim() || '—', 100);

export function userCard(u: UserCardData, isSelf: boolean): View {
  const action: ButtonBuilder = u.isBanned
    ? button(
        encodeId('adm', 'user', 'unban', u.discordUserId),
        'Odblokuj',
        ButtonStyle.Primary,
      )
    : button(
        encodeId('adm', 'user', 'ban', u.discordUserId),
        'Zablokuj',
        ButtonStyle.Danger,
      );
  const c = card(oneLine(u.displayName), `<@${u.discordUserId}>`)
    .addTextDisplayComponents(
      text(
        [
          `Admin: ${yesNo(u.isAdmin)}`,
          `Dostęp do strony: ${u.isBanned ? 'zablokowany' : 'aktywny'}`,
          `Pierwsze użycie: ${u.createdAt ? warsawDate.format(u.createdAt) : 'jeszcze nie korzystał z bota'}`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(divider());
  if (isSelf) {
    c.addTextDisplayComponents(text('-# Nie możesz zablokować siebie.'));
  }
  return view(
    c.addActionRowComponents(
      row(
        action.setDisabled(isSelf),
        button(encodeId('adm', 'user', 'open'), 'Inny użytkownik'),
      ),
    ),
  );
}

/** Confirm step; `banned` is the state being confirmed. */
export function banConfirm(u: UserCardData, banned: boolean): View {
  const name = oneLine(u.displayName);
  return view(
    card(banned ? 'Zablokować dostęp?' : 'Odblokować dostęp?')
      .addTextDisplayComponents(
        text(
          banned
            ? `**${name}** nie będzie mógł zalogować się na stronie.`
            : `**${name}** znowu będzie mógł zalogować się na stronie.`,
        ),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          banned
            ? button(
                encodeId('adm', 'user', 'banok', u.discordUserId),
                'Tak, zablokuj',
                ButtonStyle.Danger,
              )
            : button(
                encodeId('adm', 'user', 'unbanok', u.discordUserId),
                'Tak, odblokuj',
                ButtonStyle.Primary,
              ),
          button(encodeId('adm', 'user', 'open'), 'Anuluj'),
        ),
      ),
  );
}
