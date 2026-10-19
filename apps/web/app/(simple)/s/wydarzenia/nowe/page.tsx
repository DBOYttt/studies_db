import { EventForm } from '@/components/events/EventForm';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { getDb } from '@/lib/db';
import { newEventDefaults } from '@/lib/event-form-page';
import { listEventSubjectOptions } from '@/lib/event-queries';
import { requireUser } from '@/lib/session';
import { navSubjects } from '@/lib/simple-page';
import { listSubjectCards } from '@/lib/simple-queries';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export default async function SimpleNewEvent({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const [cards, options] = await Promise.all([
    listSubjectCards(db),
    listEventSubjectOptions(db),
  ]);
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'plan' }}
      crumbs={[
        { label: 'Start', href: '/s' },
        { label: 'Timetable', href: '/s/plan' },
        { label: 'Add event' },
      ]}
      user={user}
      adminEntry={user.isAdmin ? <SimpleAdminEntry /> : null}
    >
      <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">
        Add event
      </h1>
      <EventForm
        options={options}
        base="simple"
        initial={newEventDefaults(sp)}
        cancelHref="/s/plan"
      />
    </SimpleShell>
  );
}
