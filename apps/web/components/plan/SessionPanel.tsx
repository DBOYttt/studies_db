'use client';

import {
  ArrowSquareOut,
  CalendarBlank,
  ChalkboardTeacher,
  PencilSimple,
  Plus,
  TerminalWindow,
  X,
} from '@phosphor-icons/react';
import { CLASS_NAMES, EVENT_KINDS } from '@studies/db/constants';
import Link from 'next/link';
import { type RefObject, useEffect, useRef } from 'react';
import type { PlanBadge, PlanSession } from '@/lib/plan';
import { canAddTest, eventPageHref, newTestHref } from '@/lib/plan-events';
import {
  entryQuizEditHref,
  type SessionLinks,
  skipLabel,
  wallDateKey,
  wallLongDate,
  wallTime,
} from '@/lib/plan-view';
import { useSkipMark } from './useSkipMark';

const btn =
  'inline-flex items-center gap-[5px] rounded border border-line-strong px-2.5 py-[5px] text-accent-ink hover:border-accent';
const closeCls =
  'grid size-[26px] shrink-0 place-items-center rounded text-muted hover:bg-line hover:text-fg';

/**
 * Details of one session, in the PreviewPanel look: 360px column from lg
 * (the caller sizes it), full-screen sheet below. Closing (×, Escape outside
 * form fields) calls `onClose`; the heading takes focus on open. An exam
 * merged with an egzamin event links that event ("Open event").
 */
export function SessionPanel({
  session: s,
  onClose,
  simple = false,
}: {
  session: PlanSession & { links: SessionLinks };
  onClose: () => void;
  /** Simple view: no SQL link. */
  simple?: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus per opened session
  useEffect(() => {
    headingRef.current?.focus();
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
    ['Description', s.label || '–'],
  ];

  return (
    <aside
      aria-label="Class details"
      className="panel-in fixed inset-0 z-40 flex flex-col overflow-y-auto bg-page lg:static lg:z-auto lg:max-h-[calc(100dvh-4rem)] lg:rounded-md lg:border lg:border-line-strong"
    >
      <div className="sticky top-0 z-[1] flex h-[34px] shrink-0 items-center justify-between border-b border-line-strong bg-surface pr-2 pl-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="m-0 flex items-center gap-1.5 text-[13px] font-semibold outline-none"
        >
          <CalendarBlank size={15} className="text-accent-ink" aria-hidden />
          Class
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
                <td className="py-[3px] break-words">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(s.badges?.length ?? 0) > 0 && (
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
            {s.badges?.map((b) =>
              b.kind === 'test' ? (
                <TestLinks key="test" badge={b} simple={simple} />
              ) : (
                <EntryQuizRow
                  key="quiz"
                  badge={b}
                  onDate={wallDateKey(s.startsAt)}
                  editHref={entryQuizEditHref(s.links)}
                  headingRef={headingRef}
                />
              ),
            )}
          </section>
        )}
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
              aria-label="Add test"
              title="Add a test on this session"
              className={btn}
            >
              <Plus size={14} weight="bold" aria-hidden />
              Test
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
            <span aria-hidden>{EVENT_KINDS.kolokwium.symbol}</span>
            <span>Test: {badge.titles[i] || 'Untitled'}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The entry quiz of the session: note, "Not this week" ("(all groups)" for
 * an all-groups mark), "Edit".
 */
function EntryQuizRow({
  badge,
  onDate,
  editHref,
  headingRef,
}: {
  badge: Extract<PlanBadge, { kind: 'entry_quiz' }>;
  onDate: string;
  editHref: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  // The row goes away with the refresh: focus the panel heading first.
  const { skip, pending, error } = useSkipMark(badge.markId, onDate, () =>
    headingRef.current?.focus(),
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs">
        <span className="font-semibold">Entry quiz</span>
        {badge.note && <span className="text-muted"> · {badge.note}</span>}
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
