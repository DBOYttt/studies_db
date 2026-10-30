import { CalendarBlank } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import { EventForm } from '@/components/events/EventForm';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getDb } from '@/lib/db';
import { loadEventForm } from '@/lib/event-form-page';
import { parseEventId } from '@/lib/event-page';
import { listEventSubjectOptions } from '@/lib/event-queries';
import { eventMetadata } from '@/lib/page-meta';
import { requireUser } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return eventMetadata((await params).id, true);
}

export const dynamic = 'force-dynamic';

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const id = parseEventId((await params).id);
  const [{ values: initial, deleted }, options] = await Promise.all([
    loadEventForm(id),
    listEventSubjectOptions(getDb()),
  ]);
  return (
    <>
      <ScreenHeader
        crumbs={[
          { icon: CalendarBlank, label: 'Timetable', href: '/plan' },
          { label: initial.title, href: `/wydarzenia/${id}` },
          { label: 'Edit', href: `/wydarzenia/${id}/edytuj` },
        ]}
        tabs={dbTabs('plan')}
      />
      <h1 className="m-0 mb-3 text-lg font-semibold">Edit event</h1>
      <EventForm
        options={options}
        base="advanced"
        initial={initial}
        eventId={id}
        cancelHref={`/wydarzenia/${id}`}
        deleted={deleted}
        isAdmin={user.isAdmin}
        planHref="/plan"
      />
    </>
  );
}
