/**
 * Timetable assessment wording shared by the plan image and the text views:
 * Test / Entry quiz badges of a class session (`annotateWeek`) and exam
 * sessions. Same words as the web (apps/web/lib/plan-view.ts).
 */
import type { PlanBadge, PlanSession } from '@studies/db/plan';

export const EXAM_LABEL = 'Exam';

/** "Test", "2 tests", "Entry quiz". */
export function badgeLabel(b: PlanBadge): string {
  if (b.kind === 'entry_quiz') return 'Entry quiz';
  const n = b.eventIds.length;
  return n > 1 ? `${n} tests` : 'Test';
}

/** "Test: <titles>" / "Entry quiz": the label with the test titles. */
export function badgeDetail(b: PlanBadge): string {
  const label = badgeLabel(b);
  if (b.kind === 'entry_quiz') return label;
  const titles = b.titles.filter(Boolean);
  return titles.length > 0 ? `${label}: ${titles.join(', ')}` : label;
}

export const badgesOf = (s: PlanSession): PlanBadge[] => s.badges ?? [];

export const isExamSession = (s: PlanSession) =>
  s.type === 'class' && s.sessionKind === 'exam';

/** Drawn as an exam block: exam sessions and timed `egzamin` events. */
export const isExamBlock = (s: PlanSession) =>
  isExamSession(s) ||
  (s.type === 'event' && s.eventKind === 'egzamin' && !s.allDay);
