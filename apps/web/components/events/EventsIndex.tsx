import { Plus } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { EventRow } from '@/components/events/EventRow';
import { type EventsPage, eventsIndexHref } from '@/lib/events-index';

const navBtn =
  'inline-flex items-center gap-1 rounded border border-line-strong bg-panel px-2.5 py-[5px] text-accent-ink hover:border-accent hover:text-accent-ink-hover';

/**
 * The events index body: every upcoming event (all groups) from now, with
 * "Add event" and Previous/Next pages. `data` is null when loading failed.
 */
export function EventsIndex({
  data,
  simple,
}: {
  data: EventsPage | null;
  simple: boolean;
}) {
  const base = simple ? '/s/wydarzenia' : '/wydarzenia';
  return (
    <section aria-labelledby="events-index" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-0.5">
          <h1
            id="events-index"
            className={
              simple
                ? 'm-0 text-[22px] font-semibold tracking-[-0.01em]'
                : 'm-0 text-lg font-semibold'
            }
          >
            Events
          </h1>
          <p className="m-0 text-pretty text-muted">
            Upcoming tests, exams, trips and other events of every group, from
            now on.
          </p>
        </div>
        <Link
          href={`${base}/nowe`}
          className="inline-flex items-center gap-1 rounded bg-accent-fill px-2.5 py-[5px] font-semibold text-on-accent hover:bg-accent-fill-hover active:translate-y-px"
        >
          <Plus size={13} weight="bold" aria-hidden />
          Add event
        </Link>
      </div>
      {data === null ? (
        <p
          role="alert"
          className="m-0 rounded-md border border-err-fg px-4 py-3 text-err-fg"
        >
          Could not load the events. Try again.
        </p>
      ) : data.events.length === 0 ? (
        <p className="m-0 rounded-md border border-line-strong bg-zebra px-4 py-3 text-muted">
          {data.page > 1 ? 'No more upcoming events.' : 'No upcoming events.'}
        </p>
      ) : (
        <ul
          aria-label="Upcoming events"
          className="m-0 flex list-none flex-col divide-y divide-line rounded-md border border-line-strong bg-panel p-0"
        >
          {data.events.map((e) => (
            <li key={e.id}>
              <EventRow e={e} simple={simple} />
            </li>
          ))}
        </ul>
      )}
      {data && (data.page > 1 || data.hasNext) && (
        <nav
          aria-label="Pages"
          className="flex flex-wrap items-center gap-1.5 text-muted"
        >
          {data.page > 1 && (
            <Link
              href={eventsIndexHref(simple, data.page - 1)}
              className={navBtn}
            >
              ‹ Previous
            </Link>
          )}
          <span className="px-1.5 font-mono text-xs">Page {data.page}</span>
          {data.hasNext && (
            <Link
              href={eventsIndexHref(simple, data.page + 1)}
              className={navBtn}
            >
              Next ›
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
