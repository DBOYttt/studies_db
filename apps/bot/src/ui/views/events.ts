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
import { MONTHS_SHORT, WEEKDAYS_SHORT } from '@studies/db/text';
import {
  ActionRowBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  type ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { escapeUserText } from '../../markdown.js';
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

/** Materials listed on the card before "…and N more". */
export const MAX_MATERIAL_LINES = 15;
/** Subjects offered in the modal select ("— none —" takes the 25th slot). */
export const MAX_MODAL_SUBJECTS = MAX_OPTIONS - 1;
const NO_SUBJECT = '-';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const ddmmyyyy = (d: Date) =>
  `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
const WEEKDAYS = WEEKDAYS_SHORT;
const MONTHS = MONTHS_SHORT;
/** `20 Oct 2026` */
const dMonY = (d: Date) =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** `Tue 20 Oct 2026, 10:00–11:30`, or `…, all day`. */
export function whenLabel(
  startsAt: Date,
  endsAt: Date | null,
  allDay: boolean,
): string {
  const day = `${WEEKDAYS[startsAt.getUTCDay()]} ${dMonY(startsAt)}`;
  if (allDay) return `${day}, all day`;
  return endsAt
    ? `${day}, ${hhmm(startsAt)}–${hhmm(endsAt)}`
    : `${day}, ${hhmm(startsAt)}`;
}

/** The "When" text that parses back to the same time. */
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
  /** "every week" / "every 2 weeks" for an occurrence of a series. */
  seriesLabel?: string | null;
  /** After a save: "Shown on <class> <group>, <Ddd D Mon>" (a Test on a session). */
  shownOn?: string | null;
}

const base = (u: string) => u.replace(/\/+$/, '');
export const eventPageUrl = (webBaseUrl: string, id: number) =>
  `${base(webBaseUrl)}/s/wydarzenia/${id}`;
const fileUrl = (webBaseUrl: string, m: { id: number; previewKind: string }) =>
  `${base(webBaseUrl)}/files/${m.id}/${m.previewKind === 'none' ? 'original' : 'preview'}`;

const esc = (s: string) => escapeUserText(s);
const MORE = (n: number) => `…and ${n} more. Open the website`;

/** The Materials block, within `budget` characters. */
function materialsText(d: EventCardData, budget: number): string {
  const head = `**Materials (${d.materials.length})**`;
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
    `**When** ${whenLabel(d.startsAt, d.endsAt, d.allDay)}`,
    d.place ? `**Place** ${esc(d.place)}` : null,
    d.placement ? `**Class** ${esc(d.placement)}` : null,
    d.shownOn ? `-# ${esc(d.shownOn)}` : null,
    d.note ? esc(d.note) : null,
  ]
    .filter((l): l is string => !!l)
    .join('\n');
  const who = [
    d.createdByName ? `Added by: ${esc(d.createdByName)}` : null,
    d.updatedByName && d.updatedByName !== d.createdByName
      ? `last edited by: ${esc(d.updatedByName)}`
      : null,
  ]
    .filter((l): l is string => !!l)
    .join(' · ');
  const head = `## ${symbol} ${esc(d.title)}\n-# ${[label, subject && esc(subject), d.seriesLabel ? `Part of a series: ${d.seriesLabel}` : null].filter(Boolean).join(' · ')}`;
  const tail = who ? `-# ${who}` : '';
  const budget = MAX_TEXT - head.length - info.length - tail.length - 40;

  const needsSubject = d.subjectCode === null;
  const noSubject = (b: ReturnType<typeof button>) =>
    needsSubject ? b.setDisabled(true) : b;
  const links = [
    d.postUrl ? linkButton(d.postUrl, 'Open post') : null,
    linkButton(eventPageUrl(d.webBaseUrl, d.id), 'Open on the website'),
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
        noSubject(button(encodeId('evt', 'grp', d.id), 'Class/group')),
        noSubject(button(encodeId('evt', 'link', d.id), 'Link posts')),
        button(encodeId('evt', 'edit', d.id), 'Edit'),
        button(encodeId('evt', 'del', d.id), 'Delete', ButtonStyle.Danger),
      ),
      row(...links),
    );
  if (tail) container.addTextDisplayComponents(text(tail));
  return view(container);
}

/* ---------- delete confirmation ---------- */

export type Scope = 'one' | 'following';

/** "Only this one" / "This and following" before an edit or a delete in a series. */
export function scopeChoice(
  action: 'edit' | 'del',
  id: number,
  title: string,
): View {
  return view(
    new ContainerBuilder()
      .addTextDisplayComponents(
        text(
          `## ${action === 'edit' ? 'Edit' : 'Delete'} event in a series\n${esc(clip(title, 100))}`,
        ),
        text('-# Apply to this occurrence only, or to the following ones too?'),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(encodeId('evt', action, id, 'one'), 'Only this one'),
          button(
            encodeId('evt', action, id, 'following'),
            'This and following',
          ),
          button(encodeId('evt', 'show', id), 'Cancel'),
        ),
      ),
  );
}

/** `<id>[:<scope>[:v<version>]]`; the scope is always written before the version. */
function scopeVersion(
  id: number | string,
  scope?: Scope,
  version?: number,
): (string | number)[] {
  if (version !== undefined) return [id, scope ?? 'one', `v${version}`];
  return scope ? [id, scope] : [id];
}

export function deleteConfirm(
  id: number,
  title: string,
  scope?: Scope,
  version?: number,
): View {
  return view(
    new ContainerBuilder()
      .addTextDisplayComponents(
        text(`## Delete event?\n${esc(clip(title, 100))}`),
        text('-# The Discord post will be archived; files are kept.'),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('evt', 'delok', ...scopeVersion(id, scope, version)),
            'Delete',
            ButtonStyle.Danger,
          ),
          button(encodeId('evt', 'show', id), 'Cancel'),
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
      .setLabel('— none —')
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
    text(`## Class/group\n${esc(clip(title, 100))}`),
  );
  if (classes.length === 0) {
    container.addTextDisplayComponents(text('-# This subject has no classes.'));
  }
  container.addActionRowComponents(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(encodeId('evt', 'grp', eventId))
        .setPlaceholder('Choose a class or group')
        .addOptions(shown),
    ),
  );
  if (cut > 0) container.addTextDisplayComponents(text(`-# ${MORE(cut)}`));
  return view(
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(button(encodeId('evt', 'show', eventId), '◀ Back')),
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
      `## Link posts\n${esc(clip(title, 100))}\n-# Choose a post to link or unlink it. Linked: ${linkedCount}`,
    ),
  );
  if (topics.length === 0) {
    container.addTextDisplayComponents(text('-# This subject has no posts.'));
  } else {
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('evt', 'link', eventId, page))
          .setPlaceholder(
            pages > 1 ? `Posts (${page + 1}/${pages})` : 'Subject posts',
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
    button(encodeId('evt', 'show', eventId), '◀ Back'),
    ...(page > 0
      ? [button(encodeId('evt', 'link', eventId, page - 1), 'Newer')]
      : []),
    ...(page + 1 < pages
      ? [button(encodeId('evt', 'link', eventId, page + 1), 'Older')]
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
 * "— none —", or a code text field past 24 subjects), when, place_note.
 */
export function eventModal(
  eventId: number | null,
  subjects: ModalSubject[],
  cur?: ModalCurrent,
  scope?: Scope,
  version?: number,
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
      ? new LabelBuilder().setLabel('Subject').setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('subject')
            .setRequired(true)
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel('— none —')
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
          label: 'Subject (code, empty = none)',
          max: 50,
          value: cur?.subjectCode,
        });
  // An empty place keeps its (empty) first line, so the note stays a note.
  const placeNote = cur?.note
    ? `${cur.place ?? ''}\n${cur.note}`
    : (cur?.place ?? '');
  return modal(
    encodeId('evt', 'save', ...scopeVersion(eventId ?? 'new', scope, version)),
    eventId === null ? 'Add event' : 'Edit event',
    [
      new LabelBuilder().setLabel('Type').setStringSelectMenuComponent(kind),
      field({
        id: 'title',
        label: 'Title',
        max: 100,
        value: cur?.title,
        required: true,
      }),
      subject,
      field({
        id: 'when',
        label: 'When (DD.MM[.YYYY] [HH:MM[-HH:MM]])',
        max: 40,
        value: cur ? whenInput(cur.startsAt, cur.endsAt, cur.allDay) : null,
        required: true,
        placeholder: '20.10 10:00-11:30',
      }),
      field({
        id: 'place_note',
        label: 'Place / note (first line = place)',
        max: 1101,
        value: placeNote,
        long: true,
      }),
    ],
  );
}

/** The `SUBJECT_NONE` select value. */
export const SUBJECT_NONE = NO_SUBJECT;
