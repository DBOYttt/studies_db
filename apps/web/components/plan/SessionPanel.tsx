'use client';

import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  CalendarBlank,
  ChalkboardTeacher,
  PencilSimple,
  Plus,
  TerminalWindow,
  X,
} from '@phosphor-icons/react';
import { CLASS_NAMES } from '@studies/db/constants';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EventKindIcon } from '@/components/events/EventKindIcon';
import type { PlanBadge, PlanSession } from '@/lib/plan';
import { canAddTest, eventPageHref, newTestHref } from '@/lib/plan-events';
import {
  entryQuizEditHref,
  panelDescription,
  type SessionLinks,
  sessionPanelHeading,
  skipLabel,
  wallDateKey,
  wallLongDate,
  wallShortDate,
  wallTime,
} from '@/lib/plan-view';
import { useSkipMark, useUndoSkip } from './useSkipMark';

export type QuizBadge = Extract<PlanBadge, { kind: 'entry_quiz' }>;

// Touch screens get 44 px targets (the footer bars send taps here).
const btn =
  'inline-flex items-center gap-[5px] rounded border border-line-strong px-2.5 py-[5px] text-accent-ink hover:border-accent pointer-coarse:min-h-11';
const closeCls =
  'grid size-[26px] shrink-0 place-items-center rounded text-muted hover:bg-line hover:text-fg pointer-coarse:size-11';

/**
 * Details of one session, in the PreviewPanel look: a 340 px slide-over from lg
 * (the caller places it), full-screen sheet below. Closing (×, Escape outside
 * form fields) calls `onClose`; the heading takes focus on open. An exam
 * merged with an egzamin event links that event ("Open event"). After
 * "Not this week" (here or on the bar) `skipped` holds the quiz and the panel
 * shows "Entry quiz skipped … Undo" in its place.
 */
/** Meta rows holding Polish content (class names, lecturer, description). */
const PL_ROWS = new Set(['Class', 'Lecturer', 'Description']);

export function SessionPanel({
  id,
  session: s,
  onClose,
  simple = false,
  skipped = null,
  onSkipped,
  onUndone,
}: {
  id?: string;
  session: PlanSession & { links: SessionLinks };
  onClose: () => void;
  /** Simple view: no SQL link. */
  simple?: boolean;
  /** The entry quiz just skipped on this session, if any. */
  skipped?: QuizBadge | null;
  onSkipped?: (badge: QuizBadge) => void;
  onUndone?: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState('');
  const dateLabel = wallShortDate(s.startsAt);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus per opened session
  useEffect(() => {
    // Opened by a skip on the bar: the Undo row takes focus instead.
    if (!skipped) headingRef.current?.focus();
  }, [s.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t.closest('input, textarea, select'))
      )
        return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cancelled = s.status === 'cancelled';
  const classLine = [s.className, s.groupName].filter(Boolean).join(' ');
  const description = panelDescription(s);
  const meta: [string, string][] = [
    ['Date', wallLongDate(s.startsAt)],
    ['Time', `${wallTime(s.startsAt)}–${wallTime(s.endsAt)}`],
    ['Room', s.room ?? '–'],
    [
      'Class',
      classLine ||
        (s.classKind ? CLASS_NAMES[s.classKind] : 'No class assigned'),
    ],
    ['Lecturer', s.lecturerName ?? '–'],
    ...(description ? [['Description', description] as [string, string]] : []),
  ];
  const badges = s.badges ?? [];
  const quiz = badges.find((b): b is QuizBadge => b.kind === 'entry_quiz');
  // The skipped quiz stays listed (with Undo) until the panel closes.
  const shownQuiz =
    skipped && (!quiz || quiz.markId === skipped.markId) ? null : quiz;

  return (
    <aside
      id={id}
      aria-label="Class details"
      className="panel-in fixed inset-0 z-40 flex flex-col overflow-y-auto bg-page lg:static lg:z-auto lg:max-h-[calc(100dvh-4rem)] lg:rounded-md lg:border lg:border-line-strong lg:shadow-lg"
    >
      <div className="sticky top-0 z-[1] flex min-h-[34px] shrink-0 items-center justify-between gap-2 border-b border-line-strong bg-surface py-1 pr-2 pl-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="m-0 flex min-w-0 items-center gap-1.5 text-[13px] font-semibold outline-none"
        >
          <CalendarBlank
            size={15}
            className="shrink-0 text-accent-ink"
            aria-hidden
          />
          <span className="min-w-0 break-words">{sessionPanelHeading(s)}</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          title="Close (Esc)"
          className={closeCls}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div>
          <div
            lang="pl"
            className={`text-sm font-semibold break-words ${cancelled ? 'line-through' : ''}`}
          >
            {s.subjectName}
          </div>
          <div className="font-mono text-xs text-muted">{s.subjectCode}</div>
        </div>
        <span
          className={`self-start rounded-full border px-2 py-px text-xs ${
            cancelled
              ? 'border-err-fg text-err-fg'
              : 'border-ok-line bg-ok-bg text-ok-fg'
          }`}
        >
          {cancelled ? 'Cancelled' : 'Scheduled'}
        </span>
        <table className="w-full border-collapse text-xs">
          <tbody>
            {meta.map(([k, v]) => (
              <tr key={k}>
                <th
                  scope="row"
                  className="w-24 py-[3px] align-top text-left font-normal text-muted"
                >
                  {k}
                </th>
                <td
                  lang={
                    PL_ROWS.has(k) && v !== 'No class assigned'
                      ? 'pl'
                      : undefined
                  }
                  className="py-[3px] break-words"
                >
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(badges.length > 0 || skipped) && (
          <section
            aria-labelledby="session-assessments"
            className="flex flex-col gap-2"
          >
            <h3
              id="session-assessments"
              className="m-0 text-xs font-semibold text-muted"
            >
              On this session
            </h3>
            {badges.map((b) =>
              b.kind === 'test' ? (
                <TestLinks key="test" badge={b} simple={simple} />
              ) : null,
            )}
            {shownQuiz && (
              <EntryQuizRow
                key={`quiz-${shownQuiz.markId}`}
                badge={shownQuiz}
                onDate={wallDateKey(s.startsAt)}
                editHref={entryQuizEditHref(s.links)}
                onSkipped={() => {
                  setStatus(`Entry quiz skipped on ${dateLabel}.`);
                  onSkipped?.(shownQuiz);
                }}
              />
            )}
            {skipped && (
              <SkippedQuizRow
                key={`skipped-${skipped.markId}`}
                badge={skipped}
                onDate={wallDateKey(s.startsAt)}
                dateLabel={dateLabel}
                onUndone={() => {
                  setStatus(`Entry quiz back on ${dateLabel}.`);
                  headingRef.current?.focus();
                  onUndone?.();
                }}
              />
            )}
          </section>
        )}
        <p role="status" className="sr-only">
          {status}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {s.linkedEventId !== undefined && (
            <Link href={eventPageHref(s.linkedEventId, simple)} className={btn}>
              <CalendarBlank size={14} aria-hidden />
              Open event
            </Link>
          )}
          {canAddTest(s) && (
            <Link
              href={newTestHref(s, simple)}
              title="Add a test on this session"
              className={btn}
            >
              <Plus size={14} weight="bold" aria-hidden />
              Add test
            </Link>
          )}
          <Link href={s.links.subject} className={btn}>
            <ArrowSquareOut size={14} aria-hidden />
            Subject
          </Link>
          {s.links.lecturer && (
            <Link href={s.links.lecturer} className={btn}>
              <ChalkboardTeacher size={14} aria-hidden />
              Lecturer
            </Link>
          )}
          {!simple && (
            <Link href={s.links.sql} className={btn}>
              <TerminalWindow size={14} aria-hidden />
              Show in SQL
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Every test of the session, one link each (the block shows "2 tests"). */
function TestLinks({
  badge,
  simple,
}: {
  badge: Extract<PlanBadge, { kind: 'test' }>;
  simple: boolean;
}) {
  return (
    <ul aria-label="Tests" className="m-0 flex list-none flex-col gap-1 p-0">
      {badge.eventIds.map((id, i) => (
        <li key={id}>
          <Link
            href={eventPageHref(id, simple)}
            className="link inline-flex items-baseline gap-1 break-words"
          >
            <EventKindIcon kind="kolokwium" size={13} className="self-center" />
            <span>{badge.titles[i] || 'Untitled'}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The entry quiz of the session: note, "Not this week" ("(all groups)" for
 * an all-groups mark), "Edit". A skip swaps in SkippedQuizRow.
 */
function EntryQuizRow({
  badge,
  onDate,
  editHref,
  onSkipped,
}: {
  badge: QuizBadge;
  onDate: string;
  editHref: string;
  onSkipped: () => void;
}) {
  const { skip, pending, error } = useSkipMark(badge.markId, onDate, onSkipped);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs">
        <span className="font-semibold">Entry quiz</span>
        {badge.note && (
          <span className="text-muted">
            {' · '}
            <span lang="pl">{badge.note}</span>
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-disabled={pending}
          onClick={skip}
          className={`${btn} aria-disabled:opacity-60`}
        >
          {skipLabel(badge)}
        </button>
        <Link href={editHref} className={btn}>
          <PencilSimple size={14} aria-hidden />
          Edit
        </Link>
      </div>
      {error && (
        <p role="alert" className="m-0 text-xs text-err-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A quiz skipped from the timetable: "Entry quiz skipped on Tue 27 Oct" and
 * "Undo" (unskips the date). The Undo takes focus when the row appears, so
 * the focus of the vanished "Not this week" lands on its undo.
 */
function SkippedQuizRow({
  badge,
  onDate,
  dateLabel,
  onUndone,
}: {
  badge: QuizBadge;
  onDate: string;
  dateLabel: string;
  onUndone: () => void;
}) {
  const undoRef = useRef<HTMLButtonElement>(null);
  const { undo, pending, error } = useUndoSkip(badge.markId, onDate, onUndone);
  useEffect(() => {
    undoRef.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs">
        <span className="font-semibold">Entry quiz skipped</span>
        <span className="text-muted">
          {badge.allGroups ? ' for all groups' : ''} on {dateLabel}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          ref={undoRef}
          type="button"
          aria-label={`Undo skip on ${dateLabel}`}
          aria-disabled={pending}
          onClick={undo}
          className={`${btn} aria-disabled:opacity-60`}
        >
          <ArrowCounterClockwise size={14} aria-hidden />
          Undo
        </button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-xs text-err-fg">
          {error}
        </p>
      )}
    </div>
  );
}
