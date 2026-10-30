import type { Metadata } from 'next';
import { EventForm } from '@/components/events/EventForm';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb } from '@/lib/db';
import { loadNewEventForm, newEventHeading } from '@/lib/event-form-page';
import { listEventSubjectOptions } from '@/lib/event-queries';
import { requireUser } from '@/lib/session';
import { navSubjects } from '@/lib/simple-page';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  return { title: newEventHeading(await searchParams) };
}

export default async function SimpleNewEvent({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const [cards, options, form] = await Promise.all([
    cachedSubjectCards(),
    listEventSubjectOptions(db),
    loadNewEventForm(sp),
  ]);
  const heading = newEventHeading(sp);
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'plan' }}
      crumbs={[
        { label: 'Start', href: '/s' },
        { label: 'Timetable', href: '/s/plan' },
        { label: heading },
      ]}
      user={user}
      adminEntry={user.isAdmin ? <SimpleAdminEntry /> : null}
    >
      <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">
        {heading}
      </h1>
      <EventForm
        options={options}
        base="simple"
        initial={form.initial}
        sessions={form.sessions}
        cancelHref="/s/plan"
      />
    </SimpleShell>
  );
}
