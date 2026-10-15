import { CalendarBlank } from '@phosphor-icons/react/dist/ssr';
import { EventForm } from '@/components/events/EventForm';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getDb } from '@/lib/db';
import { loadEventForm } from '@/lib/event-form-page';
import { parseEventId } from '@/lib/event-page';
import { listEventSubjectOptions } from '@/lib/event-queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const id = parseEventId((await params).id);
  const [initial, options] = await Promise.all([
    loadEventForm(id),
    listEventSubjectOptions(getDb()),
  ]);
  return (
    <>
      <ScreenHeader
        crumbs={[
          { icon: CalendarBlank, label: 'Plan zajęć', href: '/plan' },
          { label: initial.title, href: `/wydarzenia/${id}` },
          { label: 'Edytuj', href: `/wydarzenia/${id}/edytuj` },
        ]}
        tabs={dbTabs('plan')}
      />
      <h1 className="m-0 mb-3 text-lg font-semibold">Edytuj wydarzenie</h1>
      <EventForm
        options={options}
        base="advanced"
        initial={initial}
        eventId={id}
        cancelHref={`/wydarzenia/${id}`}
      />
    </>
  );
}
