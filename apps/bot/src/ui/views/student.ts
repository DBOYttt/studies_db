/**
 * Student panel views (Components V2). Pure: plain data in, builders out.
 *
 * Session times are wall Dates (UTC fields = Europe/Warsaw wall clock), so
 * everything here reads UTC fields only and never converts time zones.
 */
import type { MyGroups } from '@studies/db';
import {
  formatIsoWeek,
  type IsoWeek,
  isoWeekOf,
  type MyGroupOption,
  type PlanSession,
  shiftWeek,
  weekStart,
} from '@studies/db/plan';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { encodeId } from '../ids.js';
import { MAX_COMPONENTS, MAX_ID, MAX_OPTIONS, MAX_TEXT } from '../limits.js';

export type ViewComponent = ContainerBuilder | TextDisplayBuilder;

export interface View {
  components: ViewComponent[];
  flags: MessageFlags.IsComponentsV2;
}

const view = (...components: ViewComponent[]): View => ({
  components,
  flags: MessageFlags.IsComponentsV2,
});

export const NO_GROUPS_HINT =
  'Ustaw Moje grupy, aby widzieć tylko swoje zajęcia';
export const EMPTY_DAY = 'Brak zajęć';
const more = (n: number) => `…i ${n} więcej — otwórz na stronie`;

/* ---------- formatting ---------- */

const DAY_MS = 86_400_000;
const WEEKDAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const ddmm = (d: Date) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`;
/** `śr 14.10` */
const dayLabel = (d: Date) => `${WEEKDAYS[d.getUTCDay()]} ${ddmm(d)}`;
/** `2026-10-14` */
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const clip = (s: string, n = MAX_ID) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

/**
 * `HH:MM–HH:MM · <code> <subject> · <class>[ · <group>][ · <room>][ · <lecturer>]`;
 * cancelled sessions are struck through and marked "(odwołane)".
 */
export function sessionLine(s: PlanSession): string {
  const parts = [
    `${hhmm(s.startsAt)}–${hhmm(s.endsAt)}`,
    `${s.subjectCode} ${s.subjectName}`.trim(),
    s.className ?? s.label,
    s.groupName,
    s.room,
    s.lecturerName,
  ].filter((p): p is string => !!p);
  const line = parts.join(' · ');
  return s.status === 'cancelled' ? `~~${line}~~ (odwołane)` : line;
}

/* ---------- shared pieces ---------- */

const text = (content: string) => new TextDisplayBuilder().setContent(content);
const divider = () =>
  new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
const button = (id: string, label: string, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const linkButton = (url: string, label: string) =>
  new ButtonBuilder().setURL(url).setLabel(label).setStyle(ButtonStyle.Link);
const row = (...buttons: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

const webPlanUrl = (base: string, w: IsoWeek) =>
  `${base.replace(/\/+$/, '')}/s/plan?week=${formatIsoWeek(w)}`;

/**
 * Takes blocks in order while both budgets allow, keeping room for the
 * overflow line. `cost` is the text length of a block.
 */
function takeFitting<T>(
  items: T[],
  cost: (t: T) => number,
  textBudget: number,
  slotBudget: number,
): { shown: T[]; rest: number } {
  const reserve = more(items.length).length + 1;
  let used = 0;
  const shown: T[] = [];
  for (const [i, item] of items.entries()) {
    const last = i === items.length - 1;
    const c = cost(item);
    const textLeft = textBudget - used - (last ? 0 : reserve);
    const slotsLeft = slotBudget - shown.length - (last ? 0 : 1);
    if (c > textLeft || slotsLeft < 1) break;
    used += c;
    shown.push(item);
  }
  return { shown, rest: items.length - shown.length };
}

/* ---------- views ---------- */

export function studentPanel(): View {
  return view(
    new ContainerBuilder()
      .addTextDisplayComponents(
        text('## 📚 Studies DB'),
        text('Plan zajęć i Moje grupy. Odpowiedzi widzisz tylko Ty.'),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('stu', 'plan', 'day'),
            'Plan dziś',
            ButtonStyle.Primary,
          ),
          button(encodeId('stu', 'plan', 'week'), 'Ten tydzień'),
          button(encodeId('stu', 'groups', 'open'), 'Moje grupy'),
          button(encodeId('stu', 'login'), 'Zaloguj się na stronie'),
        ),
      ),
  );
}

/** `## title` plus the hint line when no groups are saved. */
function heading(title: string, hasGroups: boolean): string {
  return hasGroups ? `## ${title}` : `## ${title}\n-# ${NO_GROUPS_HINT}`;
}

/**
 * Plan layout: heading, divider, body blocks (or "Brak zajęć"), overflow
 * line, divider, navigation row.
 */
function planView(
  head: string,
  bodies: string[],
  rest: number,
  nav: ButtonBuilder[],
): View {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(head))
    .addSeparatorComponents(divider());
  if (bodies.length === 0 && rest === 0) {
    container.addTextDisplayComponents(text(EMPTY_DAY));
  }
  for (const b of bodies) container.addTextDisplayComponents(text(b));
  if (rest > 0) container.addTextDisplayComponents(text(`-# ${more(rest)}`));
  return view(
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(row(...nav)),
  );
}

/** Components of planView besides the body: container, heading, 2 dividers, row. */
const planChrome = (nav: unknown[]) => 1 + 1 + 2 + 1 + nav.length;

const byStart = (a: PlanSession, b: PlanSession) =>
  a.startsAt.getTime() - b.startsAt.getTime() ||
  a.endsAt.getTime() - b.endsAt.getTime() ||
  a.id - b.id;

/** One day; each session is its own text block. `day` is a wall Date. */
export function planDay(
  sessions: PlanSession[],
  day: Date,
  hasGroups: boolean,
  webBaseUrl: string,
): View {
  const d = midnight(day);
  const key = dayKey(d);
  const lines = sessions
    .filter((s) => dayKey(s.startsAt) === key)
    .sort(byStart)
    .map(sessionLine);
  const week = isoWeekOf(d);
  const nav = [
    button(
      encodeId('stu', 'plan', 'day', dayKey(new Date(d.getTime() - DAY_MS))),
      '◀',
    ),
    button(encodeId('stu', 'plan', 'day'), 'Dziś'),
    button(
      encodeId('stu', 'plan', 'day', dayKey(new Date(d.getTime() + DAY_MS))),
      '▶',
    ),
    button(encodeId('stu', 'plan', 'week', formatIsoWeek(week)), 'Tydzień'),
    linkButton(webPlanUrl(webBaseUrl, week), 'Otwórz na stronie'),
  ];
  const head = heading(`Plan — ${dayLabel(d)}`, hasGroups);
  const { shown, rest } = takeFitting(
    lines,
    (l) => l.length,
    MAX_TEXT - head.length,
    MAX_COMPONENTS - planChrome(nav),
  );
  return planView(head, shown, rest, nav);
}

/**
 * One ISO week; one text block per day with a line per session. "Dzień"
 * opens `today` (a wall Date) when it falls in the week, else the Monday.
 */
export function planWeek(
  sessions: PlanSession[],
  week: IsoWeek,
  hasGroups: boolean,
  webBaseUrl: string,
  today?: Date,
): View {
  const monday = weekStart(week);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const wanted = formatIsoWeek(week);
  // Each line carries its day; the first line of a day pays for the day title.
  const lines = sessions
    .filter((s) => formatIsoWeek(isoWeekOf(s.startsAt)) === wanted)
    .sort(byStart)
    .map((s, i, all) => ({
      day: dayLabel(s.startsAt),
      line: sessionLine(s),
      first: i === 0 || dayKey(all[i - 1].startsAt) !== dayKey(s.startsAt),
    }));
  const head = heading(
    `Plan — tydzień ${ddmm(monday)}–${ddmm(sunday)}`,
    hasGroups,
  );
  // At most 7 day blocks, far below the component limit; text decides.
  const { shown, rest } = takeFitting(
    lines,
    (l) => l.line.length + 1 + (l.first ? l.day.length + 5 : 0),
    MAX_TEXT - head.length,
    Number.POSITIVE_INFINITY,
  );
  const blocks: string[] = [];
  for (const l of shown) {
    if (l.first) blocks.push(`**${l.day}**\n${l.line}`);
    else blocks[blocks.length - 1] += `\n${l.line}`;
  }
  const dayTarget =
    today && formatIsoWeek(isoWeekOf(today)) === wanted ? today : monday;
  const nav = [
    button(
      encodeId('stu', 'plan', 'week', formatIsoWeek(shiftWeek(week, -1))),
      '◀',
    ),
    button(
      encodeId('stu', 'plan', 'week', formatIsoWeek(shiftWeek(week, 1))),
      '▶',
    ),
    button(encodeId('stu', 'plan', 'day', dayKey(dayTarget)), 'Dzień'),
    linkButton(webPlanUrl(webBaseUrl, week), 'Otwórz na stronie'),
  ];
  return planView(head, blocks, rest, nav);
}

/* ---------- Moje grupy ---------- */

/**
 * Distinct subject names that have at least one class with groups, in the
 * options' order. Subject select values are indexes into this list, so the
 * router decodes a choice with the same function over the same options.
 */
export function groupSubjects(options: MyGroupOption[]): string[] {
  const out: string[] = [];
  for (const o of options) {
    if (o.groups.length > 0 && !out.includes(o.subjectName)) {
      out.push(o.subjectName);
    }
  }
  return out;
}

const chunk = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) =>
    xs.slice(i * n, i * n + n),
  );

function classSelect(o: MyGroupOption, chosen: number | undefined) {
  let groups = o.groups.slice(0, MAX_OPTIONS - 1);
  const mine = o.groups.find((g) => g.id === chosen);
  if (mine && !groups.includes(mine)) groups = [...groups.slice(0, -1), mine];
  const selected = mine ? mine.id : 0;
  return new StringSelectMenuBuilder()
    .setCustomId(encodeId('stu', 'groups', 'set', o.classId))
    .setPlaceholder(clip(o.className))
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('— brak —')
        .setValue('0')
        .setDefault(selected === 0),
      ...groups.map((g) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(clip(g.name))
          .setValue(String(g.id))
          .setDefault(g.id === selected),
      ),
    );
}

/**
 * Subject select(s) (25 per select), then for the selected subject one
 * labelled select per class with its groups and "— brak —" (value 0).
 */
export function groupsView(
  options: MyGroupOption[],
  selectedSubject: string | null,
  my: MyGroups,
): View {
  const withGroups = options.filter((o) => o.groups.length > 0);
  const subjects = groupSubjects(options);

  const summary: string[] = [];
  for (const o of withGroups) {
    const g = o.groups.find((x) => x.id === my[String(o.classId)]);
    if (g) summary.push(`${o.subjectName} · ${o.className} — **${g.name}**`);
  }
  let summaryText = summary.length
    ? summary.join('\n')
    : '-# Wybierz przedmiot, a potem swoją grupę na każdych zajęciach.';
  if (summaryText.length > 1000) {
    const { shown, rest } = takeFitting(
      summary,
      (l) => l.length + 1,
      1000,
      999,
    );
    summaryText = [...shown, `-# ${more(rest)}`].join('\n');
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text('## Moje grupy'), text(summaryText))
    .addSeparatorComponents(divider());

  const subjectPages = chunk(subjects.slice(0, MAX_OPTIONS * 3), MAX_OPTIONS);
  subjectPages.forEach((page, p) => {
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            p === 0
              ? encodeId('stu', 'groups', 'subj')
              : encodeId('stu', 'groups', 'subj', p),
          )
          .setPlaceholder(
            subjectPages.length > 1
              ? `Wybierz przedmiot (${p + 1}/${subjectPages.length})`
              : 'Wybierz przedmiot',
          )
          .addOptions(
            page.map((name, i) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(clip(name))
                .setValue(String(p * MAX_OPTIONS + i))
                .setDefault(name === selectedSubject),
            ),
          ),
      ),
    );
  });

  const classes =
    selectedSubject === null
      ? []
      : withGroups.filter((o) => o.subjectName === selectedSubject);
  if (classes.length) {
    container.addSeparatorComponents(divider());
    // Used so far: container, 2 texts, divider, 2 per subject select, divider;
    // still to come: overflow text, divider, row + 2 buttons.
    const used = 1 + 2 + 1 + 2 * subjectPages.length + 1;
    const slots = MAX_COMPONENTS - used - 1 - 1 - 3;
    const fitting = Math.max(0, Math.floor(slots / 3));
    const shown = classes.slice(0, fitting);
    for (const o of shown) {
      container
        .addTextDisplayComponents(text(`**${o.className}**`))
        .addActionRowComponents(
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            classSelect(o, my[String(o.classId)]),
          ),
        );
    }
    if (classes.length > shown.length) {
      container.addTextDisplayComponents(
        text(`-# ${more(classes.length - shown.length)}`),
      );
    }
  }

  return view(
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(encodeId('stu', 'groups', 'clear'), 'Wyczyść'),
          button(
            encodeId('stu', 'plan', 'day'),
            'Pokaż mój plan',
            ButtonStyle.Primary,
          ),
        ),
      ),
  );
}

/** A single text message (errors and info). */
export function notice(content: string): View {
  return view(text(clip(content, MAX_TEXT)));
}
