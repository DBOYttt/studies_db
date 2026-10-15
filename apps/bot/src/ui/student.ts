/**
 * Student panel actions: parsing a decoded `stu` id into an action, and
 * running it once the interaction is acknowledged.
 */
import { clearMyGroups, getMyGroups, setMyGroup } from '@studies/db';
import {
  filterMyGroups,
  hiddenByMyGroups,
  type IsoWeek,
  isoWeekOf,
  listMyGroupOptions,
  listWeekSessionRows,
  nowWall,
  parseIsoWeek,
  sanitizeMyGroups,
} from '@studies/db/plan';
import type { APIInteractionGuildMember, GuildMember, User } from 'discord.js';
import type { RouterDeps } from '../commands/router.js';
import {
  LINK_BANNED,
  LINK_DM_CLOSED,
  LINK_SENT,
  linkFor,
  sendLoginDm,
} from '../commands/student.js';
import { toDiscordUser } from '../discord/map.js';
import { renderDayImage, renderWeekImage } from './plan-image.js';
import {
  groupSubjects,
  groupsView,
  notice,
  planDay,
  planWeek,
  type View,
} from './views/student.js';

export type StudentAction =
  | { kind: 'planDay'; day: Date | null }
  | { kind: 'planWeek'; week: IsoWeek | null }
  | { kind: 'groupsOpen' }
  | { kind: 'groupsSubject'; index: number }
  | { kind: 'groupsSet'; classId: number; groupId: number | null }
  | { kind: 'groupsClear' }
  | { kind: 'login' };

/** `yyyy-mm-dd` → wall midnight, or null when malformed or not a real date. */
function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s ? d : null;
}

const ID_RE = /^[1-9]\d*$/;
const INDEX_RE = /^\d+$/;

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
  if (action === 'groups') {
    if (sub === 'open') return { kind: 'groupsOpen' };
    if (sub === 'clear') return { kind: 'groupsClear' };
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

export interface StudentContext {
  deps: RouterDeps;
  user: User;
  member: GuildMember | APIInteractionGuildMember | null;
  /** users.id of the caller. */
  userId: number;
  /** Shows a view as the interaction's (already acknowledged) response. */
  show: (v: View) => Promise<void>;
}

/**
 * Week sessions, narrowed to the caller's groups when any are saved. Like the
 * web, saved groups that are no longer groups of their class are ignored.
 */
async function planData(ctx: StudentContext, week: IsoWeek, day?: Date) {
  const [sessions, stored, options] = await Promise.all([
    listWeekSessionRows(ctx.deps.pool, week),
    getMyGroups(ctx.deps.ingest.db, ctx.userId),
    listMyGroupOptions(ctx.deps.pool),
  ]);
  const valid = Object.fromEntries(
    options.map((o) => [String(o.classId), o.groups.map((g) => g.id)]),
  );
  const my = sanitizeMyGroups(stored, valid);
  const hasGroups = Object.keys(my).length > 0;
  return {
    sessions: filterMyGroups(sessions, my),
    hasGroups,
    /** Sessions (of `day` when given, else of the week) that Moje grupy hides. */
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
  ) => string | null,
): Promise<void> {
  const [options, my] = await Promise.all([
    listMyGroupOptions(ctx.deps.pool),
    getMyGroups(ctx.deps.ingest.db, ctx.userId),
  ]);
  await ctx.show(groupsView(options, pick(options), my));
}

/** Runs an action after the interaction was acknowledged. */
export async function runStudentAction(
  ctx: StudentContext,
  a: StudentAction,
): Promise<void> {
  const { db } = ctx.deps.ingest;
  const base = ctx.deps.config.webBaseUrl;
  switch (a.kind) {
    case 'planDay': {
      const day = a.day ?? nowWall();
      const { sessions, hasGroups, hidden } = await planData(
        ctx,
        isoWeekOf(day),
        day,
      );
      const image = await tryRender('day', () => renderDayImage(sessions, day));
      await ctx.show(planDay(sessions, day, hasGroups, base, image, hidden));
      return;
    }
    case 'planWeek': {
      const today = nowWall();
      const week = a.week ?? isoWeekOf(today);
      const { sessions, hasGroups, hidden } = await planData(ctx, week);
      const image = await tryRender('week', () =>
        renderWeekImage(sessions, week, today),
      );
      await ctx.show(
        planWeek(sessions, week, hasGroups, base, today, image, hidden),
      );
      return;
    }
    case 'groupsOpen':
      return showGroups(ctx, () => null);
    case 'groupsSubject':
      // An index past the list (options changed since) selects nothing.
      return showGroups(ctx, (o) => groupSubjects(o)[a.index] ?? null);
    case 'groupsSet':
      // A group not of this class is refused by setMyGroup; the re-render
      // then shows what is actually saved.
      await setMyGroup(db, ctx.userId, a.classId, a.groupId);
      return showGroups(
        ctx,
        (o) => o.find((x) => x.classId === a.classId)?.subjectName ?? null,
      );
    case 'groupsClear':
      await clearMyGroups(db, ctx.userId);
      return showGroups(ctx, () => null);
    case 'login': {
      const res = await linkFor(db, base, toDiscordUser(ctx.user, ctx.member));
      if (!res.ok) return ctx.show(notice(LINK_BANNED));
      const sent = await sendLoginDm(ctx.user, res.url);
      await ctx.show(notice(sent ? LINK_SENT : LINK_DM_CLOSED));
      return;
    }
  }
}
