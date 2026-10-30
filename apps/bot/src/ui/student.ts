/**
 * Student panel actions: parsing a decoded `stu` id into an action, and
 * running it once the interaction is acknowledged.
 */
import {
  addMark,
  applyGroupImport,
  changedPairs,
  classMarks,
  clearMyGroups,
  fetchImportCalendar,
  GROUP_IMPORT_MAX_PAIRS,
  GROUP_IMPORT_SAVE_FAILED,
  type GroupImportPreview,
  getMyGroups,
  getReminderPrefs,
  importAllowedHosts,
  importErrorMessage,
  listEventsInRange,
  listMarks,
  logGroupImportError,
  MARK_NOT_FOUND,
  normalizeImportUrl,
  planGroupImport,
  removeMark,
  setMyGroup,
  setReminderPrefs,
  skipDate,
  TOO_MANY_IMPORTS,
} from '@studies/db';
import {
  annotateWeek,
  filterMyGroups,
  hiddenByMyGroups,
  type IsoWeek,
  isoWeekOf,
  listMarkableClasses,
  listMyGroupOptions,
  listWeekMarks,
  listWeekSessionRows,
  type MarkableClass,
  nowWall,
  parseIsoWeek,
  sanitizeMyGroups,
  upcomingSessionDates,
  weekStart,
} from '@studies/db/plan';
import type { APIInteractionGuildMember, GuildMember, User } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { RouterDeps } from '../commands/router.js';
import {
  LINK_BANNED,
  LINK_DM_CLOSED,
  LINK_SENT,
  linkFor,
  sendLoginDm,
} from '../commands/student.js';
import { toDiscordUser } from '../discord/map.js';
import { groupImportLimiter, groupImportSummary } from './group-import.js';
import { renderDayImage, renderWeekImage } from './plan-image.js';
import { STALE_TEXT } from './respond.js';
import {
  groupSubjects,
  groupsView,
  notice,
  planDay,
  planWeek,
  QUIZ_SKIP_DATES,
  type QuizClassData,
  quizClassesView,
  quizClassView,
  quizSubjectsView,
  type View,
} from './views/student.js';

export type StudentAction =
  | { kind: 'planDay'; day: Date | null }
  | { kind: 'planWeek'; week: IsoWeek | null }
  | { kind: 'groupsOpen' }
  | { kind: 'groupsSubject'; index: number }
  | { kind: 'groupsSet'; classId: number; groupId: number | null }
  | { kind: 'groupsClear' }
  /** The "Import from UniTime" button: opens the link modal. */
  | { kind: 'groupsImport' }
  /** The link modal's submit; `url` is a secret (never stored or logged). */
  | { kind: 'groupsImportSubmit'; url: string }
  | {
      kind: 'remToggle';
      which: 'day' | 'hour';
      on: boolean;
      subject: number | null;
    }
  | { kind: 'login' }
  | { kind: 'quizOpen' }
  | { kind: 'quizSubject'; subjectId: number }
  | { kind: 'quizClass'; classId: number; groupId: number | null }
  | {
      kind: 'quizToggle';
      classId: number;
      groupId: number | null;
      on: boolean;
    }
  | { kind: 'quizSkip'; markId: number; date: string };

/** `yyyy-mm-dd` → wall midnight, or null when malformed or not a real date. */
function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s ? d : null;
}

const ID_RE = /^[1-9]\d*$/;
const INDEX_RE = /^\d+$/;
/** A class/group select value: `<classId>_<groupId|0>`. */
const CLASS_GROUP_RE = /^([1-9]\d*)_(0|[1-9]\d*)$/;
const GROUP_ARG_RE = /^(0|[1-9]\d*)$/;

/** `YYYYMMDD` → `YYYY-MM-DD`, or null when not a real date. */
function parseCompactDay(s: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const key = `${m[1]}-${m[2]}-${m[3]}`;
  return parseDay(key) ? key : null;
}

/**
 * The `quiz` actions: open, subj[:page], cls:<subject>, pick:<subject>[:page],
 * all:<class>, tog, skip.
 */
function parseQuizAction(
  args: string[],
  values: readonly string[],
): StudentAction | null {
  const [sub, a, b, c] = args;
  const value = values[0];
  switch (sub) {
    case 'open':
      return args.length === 1 ? { kind: 'quizOpen' } : null;
    case 'subj':
      // Subject values are ids, so the page arg is not needed.
      return value !== undefined && ID_RE.test(value)
        ? { kind: 'quizSubject', subjectId: Number(value) }
        : null;
    case 'cls':
      return a !== undefined && ID_RE.test(a) && values.length === 0
        ? { kind: 'quizSubject', subjectId: Number(a) }
        : null;
    case 'pick': {
      const m = CLASS_GROUP_RE.exec(value ?? '');
      if (!m || a === undefined || !ID_RE.test(a)) return null;
      // Option values are ids, so the page arg is only checked.
      if (b !== undefined && !INDEX_RE.test(b)) return null;
      if (c !== undefined) return null;
      const groupId = Number(m[2]);
      return {
        kind: 'quizClass',
        classId: Number(m[1]),
        groupId: groupId === 0 ? null : groupId,
      };
    }
    case 'all':
      return a !== undefined &&
        ID_RE.test(a) &&
        args.length === 2 &&
        values.length === 0
        ? { kind: 'quizClass', classId: Number(a), groupId: null }
        : null;
    case 'tog': {
      if (a === undefined || !ID_RE.test(a)) return null;
      if (b === undefined || !GROUP_ARG_RE.test(b)) return null;
      if (c !== '0' && c !== '1') return null;
      return {
        kind: 'quizToggle',
        classId: Number(a),
        groupId: b === '0' ? null : Number(b),
        on: c === '1',
      };
    }
    case 'skip': {
      const date = parseCompactDay(value);
      return a !== undefined && ID_RE.test(a) && date
        ? { kind: 'quizSkip', markId: Number(a), date }
        : null;
    }
  }
  return null;
}

/**
 * The action a `stu` id stands for; null when the id is not one this bot
 * builds (an old panel). `values` are a select's chosen values.
 */
export function parseStudentAction(
  action: string,
  args: string[],
  values: readonly string[],
): StudentAction | null {
  const [sub, arg] = args;
  if (action === 'login') return { kind: 'login' };
  if (action === 'quiz') return parseQuizAction(args, values);
  if (action === 'plan') {
    if (sub === 'day') {
      if (arg === undefined) return { kind: 'planDay', day: null };
      const day = parseDay(arg);
      return day ? { kind: 'planDay', day } : null;
    }
    if (sub === 'week') {
      if (arg === undefined) return { kind: 'planWeek', week: null };
      const week = parseIsoWeek(arg);
      return week ? { kind: 'planWeek', week } : null;
    }
    return null;
  }
  if (action === 'rem') {
    if (sub !== 'day' && sub !== 'hour') return null;
    const subj = args[2];
    if (arg !== '0' && arg !== '1') return null;
    if (subj !== undefined && !INDEX_RE.test(subj)) return null;
    return {
      kind: 'remToggle',
      which: sub,
      on: arg === '1',
      subject: subj === undefined ? null : Number(subj),
    };
  }
  if (action === 'groups') {
    if (sub === 'open') return { kind: 'groupsOpen' };
    if (sub === 'clear') return { kind: 'groupsClear' };
    if (sub === 'import')
      return args.length === 1 && values.length === 0
        ? { kind: 'groupsImport' }
        : null;
    const value = values[0];
    if (value === undefined || !INDEX_RE.test(value)) return null;
    // Subject values are global indexes, so the page arg is not needed.
    if (sub === 'subj') return { kind: 'groupsSubject', index: Number(value) };
    if (sub === 'set' && arg !== undefined && ID_RE.test(arg)) {
      const groupId = Number(value);
      return {
        kind: 'groupsSet',
        classId: Number(arg),
        groupId: groupId === 0 ? null : groupId,
      };
    }
  }
  return null;
}

/**
 * The action a `stu` modal submit stands for (only the import link modal);
 * null for anything else (stale). `url` is the submitted link field (or
 * reads it).
 */
export function parseStudentModal(
  action: string,
  args: string[],
  url: string | (() => string),
): StudentAction | null {
  // The field is read only for a known modal (reading a missing one throws).
  return action === 'groups' && args.length === 1 && args[0] === 'importsubmit'
    ? { kind: 'groupsImportSubmit', url: typeof url === 'string' ? url : url() }
    : null;
}

export interface StudentContext {
  deps: RouterDeps;
  user: User;
  member: GuildMember | APIInteractionGuildMember | null;
  /** users.id of the caller. */
  userId: number;
  /** Shows a view as the interaction's (already acknowledged) response. */
  show: (v: View) => Promise<void>;
  /** Sends a view as a further private message. */
  followUp: (v: View) => Promise<void>;
}

/**
 * Week sessions, narrowed to the caller's groups when any are saved. Like the
 * web, saved groups that are no longer groups of their class are ignored.
 */
async function planData(ctx: StudentContext, week: IsoWeek, day?: Date) {
  const from = weekStart(week);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const [classSessions, events, stored, options] = await Promise.all([
    listWeekSessionRows(ctx.deps.pool, week),
    listEventsInRange(ctx.deps.pool, from, to),
    getMyGroups(ctx.deps.ingest.db, ctx.userId),
    listMyGroupOptions(ctx.deps.pool),
  ]);
  const marks = await listWeekMarks(
    ctx.deps.pool,
    classSessions.flatMap((s) => (s.classId === null ? [] : [s.classId])),
  );
  const valid = Object.fromEntries(
    options.map((o) => [String(o.classId), o.groups.map((g) => g.id)]),
  );
  // Like the web: badges and exam merges from all the week's events first,
  // then My groups (which also drops the badges of hidden sessions).
  const sessions = annotateWeek([...classSessions, ...events], marks);
  const my = sanitizeMyGroups(stored, valid);
  const hasGroups = Object.keys(my).length > 0;
  const shown = filterMyGroups(sessions, my);
  // Events drawn as a badge or merged into an exam still open from the
  // plan's event select.
  const linkedIds = new Set(
    shown.flatMap((s) => [
      ...(s.badges ?? []).flatMap((b) => (b.kind === 'test' ? b.eventIds : [])),
      ...(s.linkedEventId === undefined ? [] : [s.linkedEventId]),
    ]),
  );
  return {
    sessions: shown,
    linked: events.filter((e) => linkedIds.has(e.id)),
    hasGroups,
    /** Sessions (of `day` when given, else of the week) that My groups hides. */
    hidden: hiddenByMyGroups(
      day
        ? sessions.filter(
            (s) =>
              s.startsAt.toISOString().slice(0, 10) ===
              day.toISOString().slice(0, 10),
          )
        : sessions,
      my,
    ),
  };
}

/** The rendered plan image; null (the text list) when rendering fails. */
async function tryRender(
  what: string,
  render: () => Promise<Buffer | null>,
): Promise<Buffer | null> {
  try {
    return await render();
  } catch (err) {
    console.error(`plan image (${what}) failed, sending text`, err);
    return null;
  }
}

async function showGroups(
  ctx: StudentContext,
  pick: (
    options: Awaited<ReturnType<typeof listMyGroupOptions>>,
  ) => number | null,
): Promise<void> {
  const [options, my, rem] = await Promise.all([
    listMyGroupOptions(ctx.deps.pool),
    getMyGroups(ctx.deps.ingest.db, ctx.userId),
    getReminderPrefs(ctx.deps.ingest.db, ctx.userId),
  ]);
  await ctx.show(groupsView(options, pick(options), my, rem));
}

/**
 * Imports My groups from a personal UniTime calendar link: link guard,
 * rate limit, fetch, plan, save the changed groups. Replies with the summary,
 * then the refreshed groups view. Errors are the web's safe messages; the
 * link is never logged or echoed.
 */
async function runGroupImport(ctx: StudentContext, url: string) {
  const o = ctx.deps.groupImport ?? {};
  // Like the web: a rejected link does not count towards the limit.
  const guard = normalizeImportUrl(url, importAllowedHosts(o.env));
  if (!guard.ok) return ctx.show(notice(guard.error));
  const limiter = o.limiter ?? groupImportLimiter;
  if (!limiter.check(`discord:${ctx.userId}`))
    return ctx.show(notice(TOO_MANY_IMPORTS));
  const { db } = ctx.deps.ingest;
  let preview: GroupImportPreview;
  try {
    const text = await fetchImportCalendar(guard.url, {
      fetchImpl: o.fetchImpl,
    });
    preview = await planGroupImport(db, ctx.userId, text);
  } catch (err) {
    // Only name/code/errno of an unexpected error: the message may embed
    // the link.
    logGroupImportError(err);
    return ctx.show(notice(importErrorMessage(err)));
  }
  const pairs = changedPairs(preview).slice(0, GROUP_IMPORT_MAX_PAIRS);
  let set = 0;
  if (pairs.length) {
    try {
      ({ set } = await applyGroupImport(db, ctx.userId, pairs));
    } catch (err) {
      logGroupImportError(err);
      return ctx.show(notice(GROUP_IMPORT_SAVE_FAILED));
    }
  }
  const summary = groupImportSummary(preview, {
    set,
    changed: new Set(pairs.map((p) => p.classId)),
  });
  await ctx.show(notice(summary));
  // The summary stays even when the refreshed view cannot be sent.
  try {
    const [options, my, rem] = await Promise.all([
      listMyGroupOptions(ctx.deps.pool),
      getMyGroups(db, ctx.userId),
      getReminderPrefs(db, ctx.userId),
    ]);
    await ctx.followUp(groupsView(options, null, my, rem));
  } catch {
    console.error('group import: could not send the groups view');
  }
}

/* ---------- entry quizzes ---------- */

const STALE_QUIZ = 'This class has no sessions any more.';

/** `YYYY-MM-DD` of a wall Date. */
const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10);

/** The class view's data; null when the class (or the group in it) is gone. */
async function quizClassData(
  ctx: StudentContext,
  classes: MarkableClass[],
  classId: number,
  groupId: number | null,
): Promise<QuizClassData | null> {
  const c = classes.find((x) => x.classId === classId);
  if (!c) return null;
  const group =
    groupId === null ? null : c.groups.find((g) => g.id === groupId);
  if (group === undefined) return null;
  const today = dayKeyOf(nowWall());
  const quizzes = (await listMarks(ctx.deps.ingest.db, [classId])).filter(
    (m) => m.kind === 'wejsciowka',
  );
  const mark = quizzes.find((m) => m.groupId === groupId);
  const allGroupsOn =
    groupId !== null && quizzes.some((m) => m.groupId === null);
  const skips = mark ? mark.skips.filter((d) => d >= today) : [];
  const dates = mark
    ? (
        await upcomingSessionDates(
          ctx.deps.pool,
          classId,
          groupId,
          new Date(`${today}T00:00:00Z`),
          QUIZ_SKIP_DATES + skips.length,
        )
      )
        .filter((d) => !skips.includes(d))
        .slice(0, QUIZ_SKIP_DATES)
    : [];
  return {
    subjectId: c.subjectId,
    subjectName: c.subjectName,
    classId,
    className: c.className,
    groupId,
    groupName: group?.name ?? null,
    allGroupsOn,
    mark: mark ? { id: mark.id, note: mark.note, skips } : null,
    dates,
  };
}

async function showQuizClass(
  ctx: StudentContext,
  classId: number,
  groupId: number | null,
  message?: string,
): Promise<void> {
  const classes = await listMarkableClasses(ctx.deps.pool);
  const d = await quizClassData(ctx, classes, classId, groupId);
  await ctx.show(d ? quizClassView(d, message) : notice(message ?? STALE_QUIZ));
}

async function runQuizAction(
  ctx: StudentContext,
  a: Extract<StudentAction, { kind: `quiz${string}` }>,
): Promise<void> {
  const { db } = ctx.deps.ingest;
  switch (a.kind) {
    case 'quizOpen': {
      const classes = await listMarkableClasses(ctx.deps.pool);
      const subjects: { id: number; name: string; semester: number }[] = [];
      for (const c of classes) {
        if (!subjects.some((x) => x.id === c.subjectId)) {
          subjects.push({
            id: c.subjectId,
            name: c.subjectName,
            semester: c.semester,
          });
        }
      }
      return ctx.show(quizSubjectsView(subjects));
    }
    case 'quizSubject': {
      const classes = (await listMarkableClasses(ctx.deps.pool)).filter(
        (c) => c.subjectId === a.subjectId,
      );
      const marks = await listMarks(
        db,
        classes.map((c) => c.classId),
      );
      // No classes: the subject is gone or has no sessions (an old panel).
      if (classes.length === 0) return ctx.show(notice(STALE_TEXT));
      const name = classes[0].subjectName;
      return ctx.show(
        quizClassesView(
          { id: a.subjectId, name, semester: classes[0].semester },
          classes,
          marks.filter((m) => m.kind === 'wejsciowka'),
        ),
      );
    }
    case 'quizClass':
      return showQuizClass(ctx, a.classId, a.groupId);
    case 'quizToggle': {
      let message: string;
      if (a.on) {
        const r = await addMark(
          db,
          ctx.userId,
          { classId: a.classId, groupId: a.groupId, kind: 'wejsciowka' },
          'discord',
        );
        message = r.message;
      } else {
        const mark = (await listMarks(db, [a.classId])).find(
          (m) => m.kind === 'wejsciowka' && m.groupId === a.groupId,
        );
        message = mark
          ? (await removeMark(db, ctx.userId, mark.id, {}, 'discord')).message
          : MARK_NOT_FOUND;
      }
      return showQuizClass(ctx, a.classId, a.groupId, message);
    }
    case 'quizSkip': {
      const [mark] = await db
        .select({ classId: classMarks.classId, groupId: classMarks.groupId })
        .from(classMarks)
        .where(eq(classMarks.id, a.markId));
      if (!mark) return ctx.show(notice(MARK_NOT_FOUND));
      const r = await skipDate(db, ctx.userId, a.markId, a.date, 'discord');
      return showQuizClass(ctx, mark.classId, mark.groupId, r.message);
    }
  }
}

/** Runs an action after the interaction was acknowledged. */
export async function runStudentAction(
  ctx: StudentContext,
  a: StudentAction,
): Promise<void> {
  const { db } = ctx.deps.ingest;
  const base = ctx.deps.config.webBaseUrl;
  switch (a.kind) {
    case 'quizOpen':
    case 'quizSubject':
    case 'quizClass':
    case 'quizToggle':
    case 'quizSkip':
      return runQuizAction(ctx, a);
    case 'planDay': {
      const day = a.day ?? nowWall();
      const { sessions, linked, hasGroups, hidden } = await planData(
        ctx,
        isoWeekOf(day),
        day,
      );
      const image = await tryRender('day', () => renderDayImage(sessions, day));
      await ctx.show(
        planDay(sessions, day, hasGroups, base, image, hidden, linked),
      );
      return;
    }
    case 'planWeek': {
      const today = nowWall();
      const week = a.week ?? isoWeekOf(today);
      const { sessions, linked, hasGroups, hidden } = await planData(ctx, week);
      const image = await tryRender('week', () =>
        renderWeekImage(sessions, week, today),
      );
      await ctx.show(
        planWeek(sessions, week, hasGroups, base, today, image, hidden, linked),
      );
      return;
    }
    case 'groupsOpen':
      return showGroups(ctx, () => null);
    case 'groupsSubject':
      // An index past the list (options changed since) selects nothing.
      return showGroups(ctx, (o) => groupSubjects(o)[a.index]?.id ?? null);
    case 'groupsSet':
      // A group not of this class is refused by setMyGroup; the re-render
      // then shows what is actually saved.
      await setMyGroup(db, ctx.userId, a.classId, a.groupId);
      return showGroups(
        ctx,
        (o) => o.find((x) => x.classId === a.classId)?.subjectId ?? null,
      );
    case 'groupsClear':
      await clearMyGroups(db, ctx.userId);
      return showGroups(ctx, () => null);
    case 'groupsImport':
      // Opened as a modal by the router before acknowledging.
      return;
    case 'groupsImportSubmit':
      return runGroupImport(ctx, a.url);
    case 'remToggle': {
      const cur = await getReminderPrefs(db, ctx.userId);
      await setReminderPrefs(
        db,
        ctx.userId,
        {
          dayBefore: a.which === 'day' ? a.on : cur.dayBefore,
          hourBefore: a.which === 'hour' ? a.on : cur.hourBefore,
        },
        'discord',
      );
      return showGroups(ctx, (o) =>
        a.subject === null ? null : (groupSubjects(o)[a.subject]?.id ?? null),
      );
    }
    case 'login': {
      const res = await linkFor(db, base, toDiscordUser(ctx.user, ctx.member));
      if (!res.ok) return ctx.show(notice(LINK_BANNED));
      const sent = await sendLoginDm(ctx.user, res.url);
      await ctx.show(notice(sent ? LINK_SENT : LINK_DM_CLOSED));
      return;
    }
  }
}
