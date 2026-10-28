/**
 * Student panel views (Components V2). Pure: plain data in, builders out.
 *
 * Session times are wall Dates (UTC fields = Europe/Warsaw wall clock), so
 * everything here reads UTC fields only and never converts time zones.
 */
import type { MyGroups } from '@studies/db';
import { CLASS_NAMES, EVENT_KINDS } from '@studies/db/constants';
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
  AttachmentBuilder,
  type ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { dayMonth as ddmm, WEEKDAYS, weekTitle } from '../../dates.js';
import { escapeUserText } from '../../markdown.js';
import { badgeDetail, badgeLabel, badgesOf, isExamSession } from '../badges.js';
import { encodeId } from '../ids.js';
import { MAX_COMPONENTS, MAX_OPTIONS, MAX_TEXT } from '../limits.js';
import {
  button,
  chunk,
  clip,
  divider,
  linkButton,
  row,
  text,
  type View,
  view,
} from './parts.js';

export { notice, type View, type ViewComponent } from './parts.js';

export type RemindersState = { dayBefore: boolean; hourBefore: boolean };
export const REMINDERS_OFF_NOTICE =
  'Reminders turned off: DMs closed. Enable direct messages and set them again in My groups.';

export const NO_GROUPS_HINT = 'Set My groups to see only your classes';
export const EMPTY_DAY = 'No classes';
const more = (n: number) => `…and ${n} more. Open the website`;

/* ---------- formatting ---------- */

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
/** `Wed 14 Oct` */
const dayLabel = (d: Date) => `${WEEKDAYS[d.getUTCDay()]} ${ddmm(d)}`;
/** `2026-10-14` */
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * `HH:MM–HH:MM · <code> <subject> · <class>[ · <group>][ · <room>][ · <lecturer>]`
 * then the badges (` · Test: <title> · Entry quiz`); an exam session says
 * "Exam" for the class. Cancelled sessions are struck through and marked
 * "(cancelled)".
 */
export function sessionLine(s: PlanSession): string {
  if (s.type === 'event') return eventLine(s);
  const parts = [
    `${hhmm(s.startsAt)}–${hhmm(s.endsAt)}`,
    `${s.subjectCode} ${s.subjectName}`.trim(),
    isExamSession(s) ? 'Exam' : (s.className ?? s.label),
    s.groupName,
    s.room,
    s.lecturerName,
    ...badgesOf(s).map(badgeDetail),
  ].filter((p): p is string => !!p);
  const line = parts.join(' · ');
  return s.status === 'cancelled' ? `~~${line}~~ (cancelled)` : line;
}

/** `HH:MM–HH:MM · 📝 Title · <code> <subject> · <class> · <group> · <place>` */
function eventLine(s: PlanSession): string {
  const kind = s.eventKind ? EVENT_KINDS[s.eventKind].symbol : '📌';
  const time = s.allDay
    ? 'all day'
    : s.endsAt > s.startsAt
      ? `${hhmm(s.startsAt)}–${hhmm(s.endsAt)}`
      : hhmm(s.startsAt);
  return [
    time,
    `${kind} ${s.eventTitle ?? s.label}`,
    `${s.subjectCode} ${s.subjectName}`.trim(),
    s.className,
    s.groupName,
    s.room,
  ]
    .filter((p): p is string => !!p)
    .join(' · ');
}

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
        text(
          'Timetable, events, entry quizzes and My groups. Only you see the replies.',
        ),
      )
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(
          button(
            encodeId('stu', 'plan', 'day'),
            'Timetable today',
            ButtonStyle.Primary,
          ),
          button(encodeId('stu', 'plan', 'week'), 'This week'),
          button(encodeId('stu', 'groups', 'open'), 'My groups'),
          button(encodeId('stu', 'login'), 'Sign in to the website'),
          button(encodeId('evt', 'new'), 'Add event'),
        ),
        row(button(encodeId('stu', 'quiz', 'open'), 'Entry quizzes')),
      ),
  );
}

/** `## title` plus the hint line when no groups are saved. */
function heading(title: string, hasGroups: boolean): string {
  return hasGroups ? `## ${title}` : `## ${title}\n-# ${NO_GROUPS_HINT}`;
}

/** Discord's limit on a media item's description. */
const MAX_ALT = 1024;

/** A rendered plan: the PNG, its file name and what it shows. */
interface PlanImage {
  png: Buffer;
  name: string;
  title: string;
  /** Shown sessions, in order. */
  sessions: PlanSession[];
  /** Prefix each session in the alt text with its day (week view). */
  withDay: boolean;
  hasGroups: boolean;
}

/** `HH:MM–HH:MM CODE type[ group][ (cancelled)]` */
function altSession(s: PlanSession): string {
  if (s.type === 'event') {
    return [
      s.allDay ? 'all day' : hhmm(s.startsAt),
      s.eventKind ? EVENT_KINDS[s.eventKind].label : 'Event',
      s.eventTitle ?? s.label,
    ].join(' ');
  }
  const kind = isExamSession(s)
    ? 'Exam'
    : (s.className ?? (s.classKind ? CLASS_NAMES[s.classKind] : s.label));
  return [
    `${hhmm(s.startsAt)}–${hhmm(s.endsAt)}`,
    s.subjectCode || s.subjectName,
    kind,
    s.groupName,
    s.status === 'cancelled' ? '(cancelled)' : null,
    ...badgesOf(s).map(badgeLabel),
  ]
    .filter((p): p is string => !!p)
    .join(' ');
}

/** The image's alt text: the title, then every session; at most 1024 chars. */
function altText(image: PlanImage): string {
  const items = image.sessions.map((s) =>
    image.withDay ? `${dayLabel(s.startsAt)} ${altSession(s)}` : altSession(s),
  );
  return clip(`${image.title}: ${items.join('; ')}`, MAX_ALT);
}

/** `Classes: N[ (cancelled: k)] · My groups: yes|no`; N counts active ones. */
function countLine(image: PlanImage): string {
  const classes = image.sessions.filter((s) => s.type !== 'event');
  const events = image.sessions.length - classes.length;
  const cancelled = classes.filter((s) => s.status === 'cancelled').length;
  const active = classes.length - cancelled;
  const off = cancelled > 0 ? ` (cancelled: ${cancelled})` : '';
  const ev = events > 0 ? ` · Events: ${events}` : '';
  return `-# Classes: ${active}${off}${ev} · My groups: ${image.hasGroups ? 'yes' : 'no'}`;
}

/** The note under a plan when "My groups" hides sessions; '' for none. */
const hiddenNote = (hidden: number) =>
  hidden > 0 ? `-# Hidden classes: ${hidden}. Fill in My groups` : '';

const noteCost = (hidden: number) =>
  hidden > 0 ? hiddenNote(hidden).length + 1 : 0;

/**
 * Plan layout: heading, divider, then the image with a count line, or the
 * body blocks (or "No classes") with an overflow line; divider, navigation
 * row.
 */
function planView(
  head: string,
  bodies: string[],
  rest: number,
  nav: ButtonBuilder[],
  image: PlanImage | null,
  hidden = 0,
  events: PlanSession[] = [],
): View {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(head))
    .addSeparatorComponents(divider());
  const files: AttachmentBuilder[] = [];
  if (image) {
    files.push(new AttachmentBuilder(image.png, { name: image.name }));
    container
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL(`attachment://${image.name}`)
            .setDescription(altText(image)),
        ),
      )
      .addTextDisplayComponents(text(countLine(image)));
  } else {
    if (bodies.length === 0 && rest === 0) {
      container.addTextDisplayComponents(text(EMPTY_DAY));
    }
    for (const b of bodies) container.addTextDisplayComponents(text(b));
    if (rest > 0) container.addTextDisplayComponents(text(`-# ${more(rest)}`));
  }
  if (hidden > 0) container.addTextDisplayComponents(text(hiddenNote(hidden)));
  if (events.length > 0) {
    const shown = events.slice(0, MAX_OPTIONS);
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('evt', 'open'))
          .setPlaceholder('Events')
          .addOptions(
            shown.map((e) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(
                  clip(
                    `${e.eventKind ? EVENT_KINDS[e.eventKind].symbol : '📌'} ${e.eventTitle ?? e.label}`,
                  ),
                )
                .setValue(String(e.id))
                .setDescription(
                  clip(
                    `${dayLabel(e.startsAt)}${e.allDay ? '' : ` ${hhmm(e.startsAt)}`}`,
                  ),
                ),
            ),
          ),
      ),
    );
    if (events.length > shown.length) {
      container.addTextDisplayComponents(
        text(`-# …and ${events.length - shown.length} more`),
      );
    }
  }
  return {
    ...view(
      container
        .addSeparatorComponents(divider())
        .addActionRowComponents(row(...nav)),
    ),
    files,
  };
}

/** Components of planView besides the body: container, heading, 2 dividers, row. */
const planChrome = (nav: unknown[], events = 0) =>
  1 + 1 + 2 + 1 + nav.length + (events > 0 ? 3 : 0);

/** Events of `sessions`, earliest first. */
const eventsOf = (sessions: PlanSession[]) =>
  sessions.filter((s) => s.type === 'event').sort(byStart);

const byStart = (a: PlanSession, b: PlanSession) =>
  a.startsAt.getTime() - b.startsAt.getTime() ||
  a.endsAt.getTime() - b.endsAt.getTime() ||
  a.id - b.id;

/**
 * One day (`day` is a wall Date): the rendered `image` of it, or without one
 * each session as its own text block. `linked` are events shown as a badge
 * or an exam: not drawn, but listed in the event select.
 */
export function planDay(
  sessions: PlanSession[],
  day: Date,
  hasGroups: boolean,
  webBaseUrl: string,
  image: Buffer | null = null,
  hidden = 0,
  linked: PlanSession[] = [],
): View {
  const d = midnight(day);
  const key = dayKey(d);
  const daySessions = sessions
    .filter((s) => dayKey(s.startsAt) === key)
    .sort(byStart);
  const lines = daySessions.map(sessionLine);
  const dayEvents = eventsOf([
    ...daySessions,
    ...linked.filter((e) => dayKey(e.startsAt) === key),
  ]);
  const title = `Timetable — ${dayLabel(d)}`;
  const week = isoWeekOf(d);
  const nav = [
    button(
      encodeId('stu', 'plan', 'day', dayKey(new Date(d.getTime() - DAY_MS))),
      '◀',
    ),
    button(encodeId('stu', 'plan', 'day'), 'Today'),
    button(
      encodeId('stu', 'plan', 'day', dayKey(new Date(d.getTime() + DAY_MS))),
      '▶',
    ),
    button(encodeId('stu', 'plan', 'week', formatIsoWeek(week)), 'Week'),
    linkButton(webPlanUrl(webBaseUrl, week), 'Open on the website'),
  ];
  const head = heading(title, hasGroups);
  if (image && lines.length > 0) {
    return planView(
      head,
      [],
      0,
      nav,
      {
        png: image,
        name: `plan-${key}.png`,
        title,
        sessions: daySessions,
        withDay: false,
        hasGroups,
      },
      hidden,
      dayEvents,
    );
  }
  const { shown, rest } = takeFitting(
    lines,
    (l) => l.length + 1,
    MAX_TEXT -
      head.length -
      noteCost(hidden) -
      (dayEvents.length > 25 ? 30 : 0),
    MAX_COMPONENTS -
      planChrome(nav, dayEvents.length) -
      (hidden > 0 ? 1 : 0) -
      (dayEvents.length > MAX_OPTIONS ? 1 : 0),
  );
  return planView(head, shown, rest, nav, null, hidden, dayEvents);
}

/**
 * One ISO week: the rendered `image` of it, or without one a text block per
 * day with a line per session. "Day" opens `today` (a wall Date) when it
 * falls in the week, else the Monday.
 */
export function planWeek(
  sessions: PlanSession[],
  week: IsoWeek,
  hasGroups: boolean,
  webBaseUrl: string,
  today?: Date,
  image: Buffer | null = null,
  hidden = 0,
  linked: PlanSession[] = [],
): View {
  const monday = weekStart(week);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const wanted = formatIsoWeek(week);
  // Each line carries its day; the first line of a day pays for the day title.
  const weekSessions = sessions
    .filter((s) => formatIsoWeek(isoWeekOf(s.startsAt)) === wanted)
    .sort(byStart);
  const weekEvents = eventsOf([
    ...weekSessions,
    ...linked.filter((e) => formatIsoWeek(isoWeekOf(e.startsAt)) === wanted),
  ]);
  const lines = weekSessions.map((s, i, all) => ({
    day: dayLabel(s.startsAt),
    line: sessionLine(s),
    first: i === 0 || dayKey(all[i - 1].startsAt) !== dayKey(s.startsAt),
  }));
  const title = `Timetable — ${weekTitle(week.week, monday, sunday)}`;
  const head = heading(title, hasGroups);
  // At most 7 day blocks, far below the component limit; text decides.
  const { shown, rest } = takeFitting(
    lines,
    (l) => l.line.length + 1 + (l.first ? l.day.length + 5 : 0),
    MAX_TEXT -
      head.length -
      noteCost(hidden) -
      (weekEvents.length > 25 ? 30 : 0),
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
    button(encodeId('stu', 'plan', 'day', dayKey(dayTarget)), 'Day'),
    linkButton(webPlanUrl(webBaseUrl, week), 'Open on the website'),
  ];
  if (image && lines.length > 0) {
    return planView(
      head,
      [],
      0,
      nav,
      {
        png: image,
        name: `plan-${wanted}.png`,
        title,
        sessions: weekSessions,
        withDay: true,
        hasGroups,
      },
      hidden,
      weekEvents,
    );
  }
  return planView(head, blocks, rest, nav, null, hidden, weekEvents);
}

/* ---------- My groups ---------- */

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
        .setLabel('— none —')
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
 * labelled select per class with its groups and "— none —" (value 0).
 */
export function groupsView(
  options: MyGroupOption[],
  selectedSubject: string | null,
  my: MyGroups,
  rem: RemindersState = { dayBefore: false, hourBefore: false },
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
    : '-# Pick a subject, then your group for each class.';
  if (summaryText.length > 1000) {
    const { shown, rest } = takeFitting(
      summary,
      (l) => l.length + 1,
      1000,
      999,
    );
    summaryText = [...shown, `-# ${more(rest)}`].join('\n');
  }

  // The toggles carry the state they set (1 on / 0 off) and the selected
  // subject's index so it stays open.
  const subjIdx =
    selectedSubject === null ? -1 : subjects.indexOf(selectedSubject);
  const subjArgs = subjIdx >= 0 ? [subjIdx] : [];
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text('## My groups'), text(summaryText))
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
              ? `Choose a subject (${p + 1}/${subjectPages.length})`
              : 'Choose a subject',
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
    // still to come: overflow text, divider, reminders row + 2 buttons,
    // row + 2 buttons.
    const used = 1 + 2 + 1 + 2 * subjectPages.length + 1;
    const slots = MAX_COMPONENTS - used - 1 - 1 - 3 - 3;
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
          button(
            encodeId('stu', 'rem', 'day', rem.dayBefore ? 0 : 1, ...subjArgs),
            `Reminder 24 h: ${rem.dayBefore ? 'on' : 'off'}`,
            rem.dayBefore ? ButtonStyle.Success : ButtonStyle.Secondary,
          ),
          button(
            encodeId('stu', 'rem', 'hour', rem.hourBefore ? 0 : 1, ...subjArgs),
            `Reminder 1 h: ${rem.hourBefore ? 'on' : 'off'}`,
            rem.hourBefore ? ButtonStyle.Success : ButtonStyle.Secondary,
          ),
        ),
      )
      .addActionRowComponents(
        row(
          button(encodeId('stu', 'groups', 'clear'), 'Clear'),
          button(
            encodeId('stu', 'plan', 'day'),
            'Show my timetable',
            ButtonStyle.Primary,
          ),
        ),
      ),
  );
}

/* ---------- Entry quizzes ---------- */

export const QUIZ_HINT =
  'An entry quiz is shown on every session of the class until it is turned off.';
export const QUIZ_NO_CLASSES = 'No classes with sessions yet.';
/** "Not this week" offers this many upcoming session dates. */
export const QUIZ_SKIP_DATES = 5;
/** Skipped dates listed by name; the rest are counted. */
const QUIZ_SKIPS_SHOWN = 10;

export type QuizSubject = { id: number; name: string };
export type QuizClass = {
  classId: number;
  className: string;
  groups: { id: number; name: string }[];
};
export type QuizClassData = {
  subjectId: number;
  subjectName: string;
  classId: number;
  className: string;
  /** null: every group of the class. */
  groupId: number | null;
  groupName: string | null;
  /**
   * A group whose class has an active all-groups mark: that mark applies (it
   * takes precedence), so the view links the all-groups view instead.
   */
  allGroupsOn: boolean;
  /** The active mark, its skipped dates (`YYYY-MM-DD`, today on). */
  mark: { id: number; note: string | null; skips: string[] } | null;
  /** Upcoming session dates (`YYYY-MM-DD`) not skipped yet. */
  dates: string[];
};

/** `Wed 21 Oct` of a `YYYY-MM-DD` date. */
const dateLabel = (key: string) => dayLabel(new Date(`${key}T00:00:00Z`));

/** Subject select(s), 25 per select (at most 75 subjects). */
export function quizSubjectsView(subjects: QuizSubject[]): View {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text('## Entry quizzes'),
      text(`-# Pick a subject, then a class or one group. ${QUIZ_HINT}`),
    )
    .addSeparatorComponents(divider());
  if (subjects.length === 0) {
    container.addTextDisplayComponents(text(QUIZ_NO_CLASSES));
  }
  const pages = chunk(subjects.slice(0, MAX_OPTIONS * 3), MAX_OPTIONS);
  pages.forEach((page, p) => {
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            p === 0
              ? encodeId('stu', 'quiz', 'subj')
              : encodeId('stu', 'quiz', 'subj', p),
          )
          .setPlaceholder(
            pages.length > 1
              ? `Choose a subject (${p + 1}/${pages.length})`
              : 'Choose a subject',
          )
          .addOptions(
            page.map((x) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(clip(x.name))
                .setValue(String(x.id)),
            ),
          ),
      ),
    );
  });
  if (subjects.length > MAX_OPTIONS * 3) {
    container.addTextDisplayComponents(
      text(`-# ${more(subjects.length - MAX_OPTIONS * 3)}`),
    );
  }
  return view(container);
}

/**
 * Selects over the subject's classes, 25 options each (at most 75): "All
 * groups" and each group per class (values `<classId>_<groupId|0>`), marked
 * when an entry quiz is on. Later selects carry their page on the custom_id.
 */
export function quizClassesView(
  subject: QuizSubject,
  classes: QuizClass[],
  active: { classId: number; groupId: number | null }[],
): View {
  const isOn = (classId: number, groupId: number | null) =>
    active.some((m) => m.classId === classId && m.groupId === groupId);
  const options = classes.flatMap((c) => [
    { c, groupId: null as number | null, name: 'All groups' },
    ...c.groups.map((g) => ({
      c,
      groupId: g.id as number | null,
      name: g.name,
    })),
  ]);
  const shown = options.slice(0, MAX_OPTIONS * 3);
  const pages = chunk(shown, MAX_OPTIONS);
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text(clip(`## Entry quizzes — ${subject.name}`, 200)),
      text('-# Pick a class, or one group of it.'),
    )
    .addSeparatorComponents(divider());
  if (shown.length === 0) {
    container.addTextDisplayComponents(text(QUIZ_NO_CLASSES));
  }
  pages.forEach((page, p) => {
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            p === 0
              ? encodeId('stu', 'quiz', 'pick', subject.id)
              : encodeId('stu', 'quiz', 'pick', subject.id, p),
          )
          .setPlaceholder(
            pages.length > 1
              ? `Choose a class or group (${p + 1}/${pages.length})`
              : 'Choose a class or group',
          )
          .addOptions(
            page.map((o) => {
              const opt = new StringSelectMenuOptionBuilder()
                .setLabel(clip(`${o.c.className} · ${o.name}`))
                .setValue(`${o.c.classId}_${o.groupId ?? 0}`);
              if (isOn(o.c.classId, o.groupId)) {
                opt.setDescription('Entry quiz: on');
              }
              return opt;
            }),
          ),
      ),
    );
  });
  if (options.length > shown.length) {
    container.addTextDisplayComponents(
      text(`-# ${more(options.length - shown.length)}`),
    );
  }
  return view(
    container
      .addSeparatorComponents(divider())
      .addActionRowComponents(
        row(button(encodeId('stu', 'quiz', 'open'), 'Other subject')),
      ),
  );
}

/**
 * One class (or group): on/off, the note, the skipped dates, "Not this week"
 * over the next session dates and the toggle. A group under an active
 * all-groups mark says so and links the all-groups view instead (a leftover
 * group mark of its own can still be turned off). `message` (the last
 * action's answer) goes on top.
 */
export function quizClassView(d: QuizClassData, message?: string): View {
  const where = `${d.subjectName}, ${d.className} ${d.groupName ?? '(all groups)'}`;
  const container = new ContainerBuilder();
  if (message) container.addTextDisplayComponents(text(clip(message, 500)));
  container.addTextDisplayComponents(
    text('## Entry quiz'),
    text(clip(escapeUserText(where), 500)),
  );
  const m = d.mark;
  const underAll = d.groupId !== null && d.allGroupsOn;
  const state = underAll
    ? [
        '**Entry quiz: on for all groups**',
        '-# Skip a week or turn it off in the all-groups view.',
      ]
    : [`**Entry quiz: ${m ? 'on' : 'off'}**`];
  if (!underAll && m?.note) state.push(`Note: ${escapeUserText(m.note)}`);
  if (!underAll && m && m.skips.length > 0) {
    const named = m.skips.slice(0, QUIZ_SKIPS_SHOWN).map(dateLabel);
    const rest = m.skips.length - named.length;
    state.push(
      `-# Not this week: ${named.join(', ')}${rest > 0 ? ` …and ${rest} more` : ''}`,
    );
  }
  if (!m && !underAll) state.push(`-# ${QUIZ_HINT}`);
  container
    .addTextDisplayComponents(text(state.join('\n')))
    .addSeparatorComponents(divider());
  if (m && !underAll && d.dates.length > 0) {
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId('stu', 'quiz', 'skip', m.id))
          // An all-groups mark's skip applies to every group that day.
          .setPlaceholder(
            d.groupId === null ? 'Not this week (all groups)' : 'Not this week',
          )
          .addOptions(
            d.dates
              .slice(0, QUIZ_SKIP_DATES)
              .map((key) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(dateLabel(key))
                  .setValue(key.replaceAll('-', '')),
              ),
          ),
      ),
    );
  }
  const group = d.groupId ?? 0;
  const off = button(
    encodeId('stu', 'quiz', 'tog', d.classId, group, 0),
    'Turn off',
    ButtonStyle.Danger,
  );
  const toggles = underAll
    ? [
        button(encodeId('stu', 'quiz', 'all', d.classId), 'All groups'),
        ...(m ? [off] : []),
      ]
    : [
        m
          ? off
          : button(
              encodeId('stu', 'quiz', 'tog', d.classId, group, 1),
              'Turn on',
              ButtonStyle.Success,
            ),
      ];
  return view(
    container.addActionRowComponents(
      row(
        ...toggles,
        button(encodeId('stu', 'quiz', 'cls', d.subjectId), 'Other class'),
      ),
    ),
  );
}
