import type { Metadata } from 'next';
import { EventForm } from '@/components/events/EventForm';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb } from '@/lib/db';
import { loadEventForm } from '@/lib/event-form-page';
import { parseEventId } from '@/lib/event-page';
import { listEventSubjectOptions } from '@/lib/event-queries';
import { eventMetadata } from '@/lib/page-meta';
import { requireUser } from '@/lib/session';
import { navSubjects } from '@/lib/simple-page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return eventMetadata((await params).id, true);
}

export const dynamic = 'force-dynamic';

export default async function SimpleEditEvent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const id = parseEventId((await params).id);
  const db = getDb();
  const [{ values: initial, deleted }, cards, options] = await Promise.all([
    loadEventForm(id),
    cachedSubjectCards(),
    listEventSubjectOptions(db),
  ]);
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'plan' }}
      crumbs={[
        { label: 'Start', href: '/s' },
        { label: 'Timetable', href: '/s/plan' },
        { label: initial.title, href: `/s/wydarzenia/${id}` },
        { label: 'Edit' },
      ]}
      user={user}
      adminEntry={user.isAdmin ? <SimpleAdminEntry /> : null}
    >
      <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">
        Edit event
      </h1>
      <EventForm
        options={options}
        base="simple"
        initial={initial}
        eventId={id}
        cancelHref={`/s/wydarzenia/${id}`}
        deleted={deleted}
        isAdmin={user.isAdmin}
        planHref="/s/plan"
      />
    </SimpleShell>
  );
}
