import Link from 'next/link';
import { EventRow } from '@/components/events/EventRow';
import { Bone, SkeletonRegion } from '@/components/Skeleton';
import type { PlanSession } from '@/lib/plan';

const link = 'text-accent-ink hover:text-accent-ink-hover hover:underline';

/**
 * Start page card: the next events matching My groups. `null` while they
 * load: the heading and link stay, the list is a placeholder.
 */
export function UpcomingEvents({ events }: { events: PlanSession[] | null }) {
  return (
    <section aria-labelledby="upcoming-events" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="upcoming-events" className="m-0 text-base font-semibold">
          Upcoming events
        </h2>
        <div className="flex flex-wrap items-baseline justify-end gap-x-4">
          <Link href="/s/wydarzenia" className={link}>
            See all events
          </Link>
          <Link href="/s/wydarzenia/nowe" className={link}>
            + Add event
          </Link>
        </div>
      </div>
      {events === null ? (
        <SkeletonRegion className="flex flex-col divide-y divide-line rounded-md border border-line-strong bg-panel">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
              <Bone className="h-4 w-48 max-w-[60%]" />
              <Bone className="h-3 w-20" />
            </div>
          ))}
        </SkeletonRegion>
      ) : events.length === 0 ? (
        <p className="m-0 rounded-md border border-line-strong bg-zebra px-4 py-3 text-muted">
          No upcoming events.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-md border border-line-strong bg-panel p-0">
          {events.map((e) => (
            <li key={e.id}>
              <EventRow e={e} simple />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
