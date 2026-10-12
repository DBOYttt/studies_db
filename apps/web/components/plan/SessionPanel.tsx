'use client';

import {
  ArrowSquareOut,
  CalendarBlank,
  ChalkboardTeacher,
  TerminalWindow,
  X,
} from '@phosphor-icons/react';
import { CLASS_NAMES } from '@studies/db/constants';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { PlanSession } from '@/lib/plan';
import { type SessionLinks, wallLongDate, wallTime } from '@/lib/plan-view';

const btn =
  'inline-flex items-center gap-[5px] rounded border border-line-strong px-2.5 py-[5px] text-accent-ink hover:border-accent';
const closeCls =
  'grid size-[26px] shrink-0 place-items-center rounded text-muted hover:bg-line hover:text-fg';

/**
 * Details of one session, in the PreviewPanel look: 360px column from lg
 * (the caller sizes it), full-screen sheet below. Closing (×, Escape outside
 * form fields) calls `onClose`; the heading takes focus on open.
 */
export function SessionPanel({
  session: s,
  onClose,
}: {
  session: PlanSession & { links: SessionLinks };
  onClose: () => void;
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
    ['Data', wallLongDate(s.startsAt)],
    ['Godzina', `${wallTime(s.startsAt)}–${wallTime(s.endsAt)}`],
    ['Sala', s.room ?? '–'],
    [
      'Zajęcia',
      classLine ||
        (s.classKind ? CLASS_NAMES[s.classKind] : 'Bez przypisanych zajęć'),
    ],
    ['Prowadzący', s.lecturerName ?? '–'],
    ['Opis', s.label || '–'],
  ];

  return (
    <aside
      aria-label="Szczegóły zajęć"
      className="panel-in fixed inset-0 z-40 flex flex-col overflow-y-auto bg-page lg:static lg:z-auto lg:max-h-[calc(100dvh-4rem)] lg:rounded-md lg:border lg:border-line-strong"
    >
      <div className="sticky top-0 z-[1] flex h-[34px] shrink-0 items-center justify-between border-b border-line-strong bg-surface pr-2 pl-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="m-0 flex items-center gap-1.5 text-[13px] font-semibold outline-none"
        >
          <CalendarBlank size={15} className="text-accent-ink" aria-hidden />
          Zajęcia
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zamknij szczegóły"
          title="Zamknij (Esc)"
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
          {cancelled ? 'Odwołane' : 'Zaplanowane'}
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
        <div className="flex flex-wrap gap-1.5">
          <Link href={s.links.subject} className={btn}>
            <ArrowSquareOut size={14} aria-hidden />
            Przedmiot
          </Link>
          {s.links.lecturer && (
            <Link href={s.links.lecturer} className={btn}>
              <ChalkboardTeacher size={14} aria-hidden />
              Prowadzący
            </Link>
          )}
          <Link href={s.links.sql} className={btn}>
            <TerminalWindow size={14} aria-hidden />
            Pokaż w SQL
          </Link>
        </div>
      </div>
    </aside>
  );
}
