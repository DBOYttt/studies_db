import { CalendarBlank } from '@phosphor-icons/react/dist/ssr';
import { EventForm } from '@/components/events/EventForm';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getDb } from '@/lib/db';
import { loadNewEventForm, newEventHeading } from '@/lib/event-form-page';
import { listEventSubjectOptions } from '@/lib/event-queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireUser();
  const sp = await searchParams;
  const [options, form] = await Promise.all([
    listEventSubjectOptions(getDb()),
    loadNewEventForm(sp),
  ]);
  const heading = newEventHeading(sp);
  return (
    <>
      <ScreenHeader
        crumbs={[
          { icon: CalendarBlank, label: 'Timetable', href: '/plan' },
          { label: heading, href: '/wydarzenia/nowe' },
        ]}
        tabs={dbTabs('plan')}
      />
      <h1 className="m-0 mb-3 text-lg font-semibold">{heading}</h1>
      <EventForm
        options={options}
        base="advanced"
        initial={form.initial}
        sessions={form.sessions}
        cancelHref="/plan"
      />
    </>
  );
}
