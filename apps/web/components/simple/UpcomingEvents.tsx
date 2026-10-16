import { EVENT_KINDS } from '@studies/db/constants';
import Link from 'next/link';
import type { PlanSession } from '@/lib/plan';
import { eventPageHref, eventWhenShort } from '@/lib/plan-events';

/** Start page card: the next events matching Moje grupy. */
export function UpcomingEvents({ events }: { events: PlanSession[] }) {
  return (
    <section aria-labelledby="upcoming-events" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="upcoming-events" className="m-0 text-base font-semibold">
          Nadchodzące wydarzenia
        </h2>
        <Link
          href="/s/wydarzenia/nowe"
          className="text-accent-ink hover:text-accent-ink-hover hover:underline"
        >
          + Wydarzenie
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="m-0 rounded-md border border-line-strong bg-zebra px-4 py-3 text-muted">
          Brak nadchodzących wydarzeń.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-md border border-line-strong bg-panel p-0">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={eventPageHref(e.id, true)}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2 hover:bg-list-hover"
              >
                <span className="font-semibold text-fg">
                  <span aria-hidden>
                    {e.eventKind ? EVENT_KINDS[e.eventKind].symbol : ''}{' '}
                  </span>
                  {e.eventTitle ?? e.label}
                </span>
                <span className="font-mono text-xs text-accent-ink">
                  {eventWhenShort(e)}
                </span>
                {e.subjectCode && (
                  <span className="text-xs text-muted">{e.subjectCode}</span>
                )}
                {e.room && <span className="text-xs text-muted">{e.room}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
