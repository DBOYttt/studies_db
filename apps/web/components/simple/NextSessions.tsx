import { CalendarBlank } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { PlanSession } from '@/lib/plan';
import { dayHeader, wallTime } from '@/lib/plan-view';

/**
 * "Next classes": the subject's next sessions (wall times, UTC getters).
 * The page passes confirmed ones only; a cancelled one would still render
 * struck through and marked "Cancelled".
 */
export function NextSessions({ sessions }: { sessions: PlanSession[] }) {
  return (
    <section aria-labelledby="next-sessions" className="flex flex-col gap-2">
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="next-sessions" className="m-0 text-base font-semibold">
          Next classes
        </h2>
        <Link
          href="/s/plan"
          className="flex items-center gap-1 text-[13px] text-accent-ink hover:text-accent-ink-hover hover:underline"
        >
          <CalendarBlank size={15} aria-hidden />
          Full timetable
        </Link>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 p-0">
        {sessions.map((s) => {
          const d = dayHeader(s.startsAt);
          const cancelled = s.status === 'cancelled';
          const what = [s.className ?? s.label, s.groupName]
            .filter(Boolean)
            .join(', ');
          return (
            <li
              key={s.id}
              className="flex flex-col gap-0.5 rounded-lg border border-line-strong bg-panel px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                <span>
                  {d.name} {d.date}
                </span>
                {cancelled && (
                  <span className="rounded-full border border-err-fg px-2 text-xs text-err-fg">
                    Cancelled
                  </span>
                )}
              </div>
              <div className={cancelled ? 'text-faint line-through' : ''}>
                <span className="text-[15px] font-semibold tabular-nums">
                  {wallTime(s.startsAt)}–{wallTime(s.endsAt)}
                </span>
                <div className="break-words">{what}</div>
              </div>
              {s.room && (
                <div className="text-xs text-faint">room {s.room}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
