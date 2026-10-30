import Link from 'next/link';
import { EventKindIcon } from '@/components/events/EventKindIcon';
import type { PlanSession } from '@/lib/plan';
import { eventPageHref, eventWhenShort } from '@/lib/plan-events';

/**
 * One upcoming event as a link to its page: kind and title, when, subject
 * code and room. Used by the start page card and the events index.
 */
export function EventRow({ e, simple }: { e: PlanSession; simple: boolean }) {
  return (
    <Link
      href={eventPageHref(e.id, simple)}
      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3.5 py-2 hover:bg-list-hover"
    >
      <span className="font-semibold text-fg">
        {e.eventKind && (
          <>
            <EventKindIcon kind={e.eventKind} label />{' '}
          </>
        )}
        <span lang="pl">{e.eventTitle ?? e.label}</span>
      </span>
      <span className="font-mono text-xs text-accent-ink">
        {eventWhenShort(e)}
      </span>
      {e.subjectCode && (
        <span className="text-xs text-muted">{e.subjectCode}</span>
      )}
      {e.room && <span className="text-xs text-muted">{e.room}</span>}
    </Link>
  );
}
