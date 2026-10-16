/**
 * Event views (Components V2): the card, the new/edit modal, the class/group
 * and linked-post pickers and the delete confirmation. Pure: plain data in,
 * builders out. Times are wall Dates (UTC fields = local), never converted.
 */
import {
  EVENT_KIND_KEYS,
  EVENT_KINDS,
  type EventKind,
} from '@studies/db/constants';
import {
  ActionRowBuilder,
  ButtonStyle,
  ContainerBuilder,
  escapeMarkdown,
  LabelBuilder,
  type ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { encodeId } from '../ids.js';
import { MAX_OPTIONS, MAX_TEXT } from '../limits.js';
import { field, modal } from './modals.js';
import {
  button,
  clip,
  divider,
  linkButton,
  row,
  text,
  type View,
  view,
} from './parts.js';

/** Materials listed on the card before "…i N więcej". */
export const MAX_MATERIAL_LINES = 15;
/** Subjects offered in the modal select ("— brak —" takes the 25th slot). */
export const MAX_MODAL_SUBJECTS = MAX_OPTIONS - 1;
const NO_SUBJECT = '-';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const ddmmyyyy = (d: Date) =>
  `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
const WEEKDAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];

/** `śr 20.10.2026 10:00–11:30`, or `… (cały dzień)`. */
export function whenLabel(
  startsAt: Date,
  endsAt: Date | null,
  allDay: boolean,
): string {
  const day = `${WEEKDAYS[startsAt.getUTCDay()]} ${ddmmyyyy(startsAt)}`;
  if (allDay) return `${day} (cały dzień)`;
  return endsAt
    ? `${day} ${hhmm(startsAt)}–${hhmm(endsAt)}`
    : `${day} ${hhmm(startsAt)}`;
}

/** The "Kiedy" text that parses back to the same time. */
export function whenInput(
  startsAt: Date,
  endsAt: Date | null,
  allDay: boolean,
): string {
  if (allDay) return ddmmyyyy(startsAt);
  return `${ddmmyyyy(startsAt)} ${hhmm(startsAt)}${endsAt ? `-${hhmm(endsAt)}` : ''}`;
}

/* ---------- card ---------- */

export interface EventCardData {
  id: number;
  kind: EventKind;
  title: string;
  subjectCode: string | null;
  subjectName: string | null;
  /** `Laboratorium · Gr. 2` or null. */
  placement: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  place: string | null;
  note: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  materials: { id: number; filename: string; previewKind: string }[];
  webBaseUrl: string;
  /** https://discord.com/channels/… of the event's post; null without one. */
  postUrl: string | null;
  /** "co tydzień" / "co 2 tygodnie" for an occurrence of a series. */
  seriesLabel?: string | null;
}

const base = (u: string) => u.replace(/\/+$/, '');
export const eventPageUrl = (webBaseUrl: string, id: number) =>
  `${base(webBaseUrl)}/s/wydarzenia/${id}`;
const fileUrl = (webBaseUrl: string, m: { id: number; previewKind: string }) =>
  `${base(webBaseUrl)}/files/${m.id}/${m.previewKind === 'none' ? 'original' : 'preview'}`;

const esc = (s: string) => escapeMarkdown(s);
const MORE = (n: number) => `…i ${n} więcej — otwórz na stronie`;

/** The Materiały block, within `budget` characters. */
function materialsText(d: EventCardData, budget: number): string {
  const head = `**Materiały (${d.materials.length})**`;
  if (d.materials.length === 0) return head;
  const lines: string[] = [];
  let used = head.length + 1;
  const listed = d.materials.slice(0, MAX_MATERIAL_LINES);
  for (const m of listed) {
    const name = esc(clip(m.filename, 60)).replace(/[[\]]/g, '');
    const line = `• [${name}](${fileUrl(d.webBaseUrl, m)})`;
    const rest = d.materials.length - lines.length - 1;
    const reserve = rest > 0 ? MORE(rest).length + 4 : 0;
    if (used + line.length + 1 + reserve > budget) break;
    lines.push(line);
    used += line.length + 1;
  }
  const rest = d.materials.length - lines.length;
  if (rest > 0) lines.push(`-# ${MORE(rest)}`);
  return [head, ...lines].join('\n');
}

export function eventCard(d: EventCardData): View {
  const { symbol, label } = EVENT_KINDS[d.kind];
  const subject = d.subjectCode
    ? `${d.subjectCode} ${d.subjectName ?? ''}`.trim()
    : null;
  const info = [
    `**Kiedy** ${whenLabel(d.startsAt, d.endsAt, d.allDay)}`,
    d.place ? `**Miejsce** ${esc(d.place)}` : null,
    d.placement ? `**Zajęcia** ${esc(d.placement)}` : null,
    d.note ? esc(d.note) : null,
  ]
    .filter((l): l is string => !!l)
    .join('\n');
  const who = [
    d.createdByName ? `Dodał(a): ${esc(d.createdByName)}` : null,
    d.updatedByName && d.updatedByName !== d.createdByName
      ? `ostatnio edytował(a): ${esc(d.updatedByName)}`
      : null,
  ]
    .filter((l): l is string => !!l)
    .join(' · ');
  const head = `## ${symbol} ${esc(d.title)}\n-# ${[label, subject && esc(subject), d.seriesLabel ? `Część serii: ${d.seriesLabel}` : null].filter(Boolean).join(' · ')}`;
  const tail = who ? `-# ${who}` : '';
  const budget = MAX_TEXT - head.length - info.length - tail.length - 40;

  const needsSubject = d.subjectCode === null;
  const noSubject = (b: ReturnType<typeof button>) =>
    needsSubject ? b.setDisabled(true) : b;
  const links = [
    d.postUrl ? linkButton(d.postUrl, 'Otwórz post') : null,
    linkButton(eventPageUrl(d.webBaseUrl, d.id), 'Otwórz na stronie'),
  ].filter((b) => b !== null);
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text(head),
      text(info),
      text(materialsText(d, budget)),
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      row(
        noSubject(button(encodeId('evt', 'grp', d.id), 'Zajęcia/grupa')),
        noSubject(button(encodeId('evt', 'link', d.id), 'Powiąż posty')),
        button(encodeId('evt', 'edit', d.id), 'Edytuj'),
        button(encodeId('evt', 'del', d.id), 'Usuń', ButtonStyle.Danger),
      ),
      row(...links),
    );
  if (tail) container.addTextDisplayComponents(text(tail));
  return view(container);
}

/* ---------- delete confirmation ---------- */

export type Scope = 'one' | 'following';

/** "Tylko to" / "To i następne" before an edit or a delete in a series. */
export function scopeChoice(
  action: 'edit' | 'del',
  id: number,
  title: string,
): View {
  return view(
    new ContainerBuilder()
      .addTextDisplayComponents(
        text(
          `## ${action === 'edit' ? 'Edytować' : 'Usunąć'} wydarzenie z serii\n${esc(clip(title, 100))}`,
        ),
        text('-# Dotyczy tylko tego wystąpienia czy także następnych?'),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(encodeId('evt', action, id, 'one'), 'Tylko to'),
          button(encodeId('evt', action, id, 'following'), 'To i następne'),
          button(encodeId('evt', 'show', id), 'Anuluj'),
        ),
      ),
  );
}

export function deleteConfirm(id: number, title: string, scope?: Scope): View {
  return view(
    new ContainerBuilder()
      .addTextDisplayComponents(
        text(`## Usunąć wydarzenie?\n${esc(clip(title, 100))}`),
        text('-# Post na Discordzie zostanie zarchiwizowany, pliki zostają.'),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('evt', 'delok', ...(scope ? [id, scope] : [id])),
            'Usuń',
            ButtonStyle.Danger,
          ),
          button(encodeId('evt', 'show', id), 'Anuluj'),
        ),
      ),
  );
}

/* ---------- class/group picker ---------- */

export interface ClassOption {
  classId: number;
  className: string;
  groups: { id: number; name: string }[];
}

/** Select values: `0` none, `c<classId>`, `g<groupId>`. */
export function placementView(
  eventId: number,
  title: string,
  classes: ClassOption[],
  current: { classId: number | null; groupId: number | null },
): View {
  const opts: StringSelectMenuOptionBuilder[] = [
    new StringSelectMenuOptionBuilder()
      .setLabel('— brak —')
      .setValue('0')
      .setDefault(current.classId === null && current.groupId === null),
  ];
  for (const c of classes) {
    opts.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(clip(c.className))
        .setValue(`c${c.classId}`)
        .setDefault(current.groupId === null && current.classId === c.classId),
    );
    for (const g of c.groups) {
      opts.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(clip(`${c.className} · ${g.name}`))
          .setValue(`g${g.id}`)
          .setDefault(current.groupId === g.id),
      );
    }
  }
  const shown = opts.slice(0, MAX_OPTIONS);
  const cut = opts.length - shown.length;
  const container = new ContainerBuilder().addTextDisplayComponents(
    text(`## Zajęcia/grupa\n${esc(clip(title, 100))}`),
  );
  if (classes.length === 0) {
    container.addTextDisplayComponents(text('-# Ten przedmiot nie ma zajęć.'));
  }
  container.addActionRowComponents(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(encodeId('evt', 'grp', eventId))
        .setPlaceholder('Wybierz zajęcia lub grupę')
        .addOptions(shown),
    ),
  );
  if (cut > 0) container.addTextDisplayComponents(text(`-# ${MORE(cut)}`));
  return view(
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(button(encodeId('evt', 'show', eventId), '◀ Wróć')),
      ),
  );
}

/* ---------- linked posts ---------- */

export interface TopicOption {
  id: number;
  title: string;
  linked: boolean;
}

/** One page (<= 25) of the subject's posts; choosing one toggles its link. */
export function linkView(
  eventId: number,
  title: string,
  topics: TopicOption[],
  page: number,
  pages: number,
  linkedCount: number,
): View {
  const container = new ContainerBuilder().addTextDisplayComponents(
    text(
      `## Powiąż posty\n${esc(clip(title, 100))}\n-# Wybierz post, aby go powiązać lub odpiąć. Powiązane: ${linkedCount}`,
    ),
  );
  if (topics.length === 0) {
    container.addTextDisplayComponents(text('-# Brak postów tego przedmiotu.'));
  } else {
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('evt', 'link', eventId, page))
          .setPlaceholder(
            pages > 1 ? `Posty (${page + 1}/${pages})` : 'Posty przedmiotu',
          )
          .addOptions(
            topics
              .slice(0, MAX_OPTIONS)
              .map((t) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(clip(`${t.linked ? '✓ ' : ''}${t.title}`))
                  .setValue(String(t.id)),
              ),
          ),
      ),
    );
  }
  const nav = [
    button(encodeId('evt', 'show', eventId), '◀ Wróć'),
    ...(page > 0
      ? [button(encodeId('evt', 'link', eventId, page - 1), 'Nowsze')]
      : []),
    ...(page + 1 < pages
      ? [button(encodeId('evt', 'link', eventId, page + 1), 'Starsze')]
      : []),
  ];
  return view(
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(row(...nav)),
  );
}

/* ---------- modal ---------- */

export interface ModalSubject {
  code: string;
  name: string;
}

export interface ModalCurrent {
  kind: EventKind;
  title: string;
  subjectCode: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  place: string | null;
  note: string | null;
}

/**
 * `evt:save:<id|new>`. Fields: kind (select), title, subject (select with
 * "— brak —", or a code text field past 24 subjects), when, place_note.
 */
export function eventModal(
  eventId: number | null,
  subjects: ModalSubject[],
  cur?: ModalCurrent,
  scope?: Scope,
): ModalBuilder {
  const kind = new StringSelectMenuBuilder()
    .setCustomId('kind')
    .setRequired(true)
    .addOptions(
      EVENT_KIND_KEYS.map((k) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${EVENT_KINDS[k].symbol} ${EVENT_KINDS[k].label}`)
          .setValue(k)
          .setDefault(k === (cur?.kind ?? 'inne')),
      ),
    );
  const subject =
    subjects.length <= MAX_MODAL_SUBJECTS
      ? new LabelBuilder().setLabel('Przedmiot').setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('subject')
            .setRequired(true)
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel('— brak —')
                .setValue(NO_SUBJECT)
                .setDefault(!cur?.subjectCode),
              ...subjects.map((s) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(clip(`${s.code} ${s.name}`))
                  .setValue(s.code)
                  .setDefault(s.code === cur?.subjectCode),
              ),
            ),
        )
      : field({
          id: 'subject',
          label: 'Przedmiot (kod, puste = brak)',
          max: 50,
          value: cur?.subjectCode,
        });
  // An empty place keeps its (empty) first line, so the note stays a note.
  const placeNote = cur?.note
    ? `${cur.place ?? ''}\n${cur.note}`
    : (cur?.place ?? '');
  return modal(
    encodeId(
      'evt',
      'save',
      ...(scope ? [eventId ?? 'new', scope] : [eventId ?? 'new']),
    ),
    eventId === null ? 'Dodaj wydarzenie' : 'Edytuj wydarzenie',
    [
      new LabelBuilder().setLabel('Rodzaj').setStringSelectMenuComponent(kind),
      field({
        id: 'title',
        label: 'Tytuł',
        max: 100,
        value: cur?.title,
        required: true,
      }),
      subject,
      field({
        id: 'when',
        label: 'Kiedy (DD.MM[.RRRR] [GG:MM[-GG:MM]])',
        max: 40,
        value: cur ? whenInput(cur.startsAt, cur.endsAt, cur.allDay) : null,
        required: true,
        placeholder: '20.10 10:00-11:30',
      }),
      field({
        id: 'place_note',
        label: 'Miejsce / notatka (pierwsza linia = miejsce)',
        max: 1101,
        value: placeNote,
        long: true,
      }),
    ],
  );
}

/** The `SUBJECT_NONE` select value. */
export const SUBJECT_NONE = NO_SUBJECT;
