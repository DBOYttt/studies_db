/**
 * Week annotation (spec "Timetable assessments" §1–2): turns the class
 * sessions and events of a week plus the entry-quiz marks into what the
 * timetable draws. Pure, no I/O and no runtime imports, so client bundles can
 * use it through `@studies/db/plan`. Times are wall Dates (see plan.ts).
 *
 * - A `kolokwium` event inside a confirmed class session of the same subject
 *   and class (and the session's group, or no group) becomes a Test badge on
 *   that session and is not drawn as a block.
 * - A confirmed class session whose class (and group, or every group) has an
 *   entry-quiz mark gets an Entry quiz badge, except on the mark's skipped
 *   dates.
 * - An `egzamin` event of the same subject starting within 60 minutes of a
 *   confirmed exam session is shown once, as the exam session with
 *   `linkedEventId` (a cancelled exam leaves the event a normal block).
 */
import type { PlanSession } from './plan.js';

export type PlanBadge =
  | { kind: 'test'; eventIds: number[]; titles: string[] }
  | { kind: 'entry_quiz'; markId: number; note: string | null };

/** An active entry-quiz mark; `skips` are `YYYY-MM-DD` dates. */
export type WeekMark = {
  id: number;
  classId: number;
  groupId: number | null;
  note: string | null;
  skips: string[];
};

const EXAM_DEDUP_MS = 60 * 60_000;

/** `YYYY-MM-DD` of a wall Date. */
const wallDay = (d: Date) => d.toISOString().slice(0, 10);

/** A confirmed class session that can carry badges (not an exam). */
const isBadgeable = (s: PlanSession) =>
  s.type === 'class' && s.sessionKind !== 'exam' && s.status === 'confirmed';

const isTestEvent = (e: PlanSession) =>
  e.type === 'event' && e.eventKind === 'kolokwium' && !e.allDay;

/**
 * Test events (kolokwium, not all-day) matched to sessions by time. Only the
 * sessions that can carry badges are considered; `badges` maps a session id
 * to its event ids (in the order of `events`), `matched` holds every event id
 * that landed on at least one session.
 */
export function matchEventsToSessions(
  sessions: PlanSession[],
  events: PlanSession[],
): { badges: Map<number, number[]>; matched: Set<number> } {
  const badges = new Map<number, number[]>();
  const matched = new Set<number>();
  const targets = sessions.filter(isBadgeable);
  for (const e of events) {
    if (!isTestEvent(e)) continue;
    const t = e.startsAt.getTime();
    for (const s of targets) {
      if (
        s.subjectId === e.subjectId &&
        s.classId !== null &&
        s.classId === e.classId &&
        (e.groupId === null || e.groupId === s.groupId) &&
        t >= s.startsAt.getTime() &&
        t < s.endsAt.getTime() &&
        wallDay(e.startsAt) === wallDay(s.startsAt)
      ) {
        const ids = badges.get(s.id) ?? [];
        ids.push(e.id);
        badges.set(s.id, ids);
        matched.add(e.id);
      }
    }
  }
  return { badges, matched };
}

/** The mark that applies to a session: its group's first, then all groups. */
function entryQuizFor(s: PlanSession, marks: WeekMark[]): WeekMark | null {
  if (!isBadgeable(s) || s.classId === null) return null;
  const day = wallDay(s.startsAt);
  const applies = (m: WeekMark) =>
    m.classId === s.classId && !m.skips.includes(day);
  return (
    marks.find(
      (m) => applies(m) && m.groupId !== null && m.groupId === s.groupId,
    ) ??
    marks.find((m) => applies(m) && m.groupId === null) ??
    null
  );
}

/**
 * Annotates one week (class sessions and events mixed, in any order). Returns
 * copies in input order: class sessions with `badges` (Test first, then
 * Entry quiz; left out when none), exam sessions with `linkedEventId` when an
 * `egzamin` event duplicates them, and the events that were neither turned
 * into a badge nor merged into an exam. The input is not changed.
 */
export function annotateWeek(
  sessions: PlanSession[],
  marks: WeekMark[],
): PlanSession[] {
  const classes = sessions.filter((s) => s.type === 'class');
  const events = sessions.filter((s) => s.type === 'event');
  const { badges, matched } = matchEventsToSessions(classes, events);
  const eventById = new Map(events.map((e) => [e.id, e]));

  // Exam dedup: each exam session links its closest egzamin event; every
  // egzamin event that duplicates some exam session is dropped.
  const merged = new Set<number>();
  const linked = new Map<number, number>();
  for (const x of classes) {
    if (x.sessionKind !== 'exam' || x.status !== 'confirmed') continue;
    let best: PlanSession | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const e of events) {
      if (e.eventKind !== 'egzamin' || e.subjectId !== x.subjectId) continue;
      const diff = Math.abs(e.startsAt.getTime() - x.startsAt.getTime());
      if (diff > EXAM_DEDUP_MS) continue;
      merged.add(e.id);
      if (diff < bestDiff) {
        best = e;
        bestDiff = diff;
      }
    }
    if (best) linked.set(x.id, best.id);
  }

  const out: PlanSession[] = [];
  for (const s of sessions) {
    if (s.type === 'event') {
      if (!matched.has(s.id) && !merged.has(s.id)) out.push({ ...s });
      continue;
    }
    const list: PlanBadge[] = [];
    const testIds = badges.get(s.id);
    if (testIds) {
      list.push({
        kind: 'test',
        eventIds: testIds,
        titles: testIds.map((id) => {
          const e = eventById.get(id);
          return e?.eventTitle ?? e?.label ?? '';
        }),
      });
    }
    const quiz = entryQuizFor(s, marks);
    if (quiz)
      list.push({ kind: 'entry_quiz', markId: quiz.id, note: quiz.note });
    // Annotations of a previous run are replaced, never kept.
    const { badges: _stale, linkedEventId: _staleLink, ...rest } = s;
    const copy: PlanSession = rest;
    if (list.length > 0) copy.badges = list;
    const link = linked.get(s.id);
    if (link !== undefined) copy.linkedEventId = link;
    out.push(copy);
  }
  return out;
}
