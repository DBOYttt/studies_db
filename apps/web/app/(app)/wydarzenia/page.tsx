import { CalendarBlank } from '@phosphor-icons/react/dist/ssr';
import { EventsIndex } from '@/components/events/EventsIndex';
import { Notice } from '@/components/Notice';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getViewsPool } from '@/lib/db';
import { parseEventsPage, upcomingEventsPage } from '@/lib/events-index';
import { noticeFromSearchParams } from '@/lib/notices';
import { nowWall } from '@/lib/plan';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

/** Every upcoming event, 25 per page, from now. */
export default async function EventsIndexPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireUser();
  const sp = await searchParams;
  const data = await upcomingEventsPage(
    getViewsPool(),
    nowWall(),
    parseEventsPage(sp),
  ).catch(() => null);
  return (
    <>
      <ScreenHeader
        crumbs={[
          { icon: CalendarBlank, label: 'Timetable', href: '/plan' },
          { label: 'Events', href: '/wydarzenia' },
        ]}
        tabs={dbTabs('plan')}
      />
      <div className="flex flex-col gap-3.5">
        <Notice text={noticeFromSearchParams(sp)} />
        <EventsIndex data={data} simple={false} />
      </div>
    </>
  );
}
