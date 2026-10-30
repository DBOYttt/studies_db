import type { Metadata } from 'next';
import { EventsIndex } from '@/components/events/EventsIndex';
import { Notice } from '@/components/Notice';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getViewsPool } from '@/lib/db';
import { parseEventsPage, upcomingEventsPage } from '@/lib/events-index';
import { noticeFromSearchParams } from '@/lib/notices';
import { nowWall } from '@/lib/plan';
import { requireUser } from '@/lib/session';
import { navSubjects } from '@/lib/simple-page';

export const metadata: Metadata = { title: 'Events' };

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

/** Every upcoming event, 25 per page, from now. */
export default async function SimpleEventsIndex({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [cards, data] = await Promise.all([
    cachedSubjectCards(),
    upcomingEventsPage(getViewsPool(), nowWall(), parseEventsPage(sp)).catch(
      () => null,
    ),
  ]);
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'home' }}
      crumbs={[{ label: 'Start', href: '/s' }, { label: 'Events' }]}
      user={user}
      adminEntry={user.isAdmin ? <SimpleAdminEntry /> : null}
    >
      <Notice text={noticeFromSearchParams(sp)} />
      <EventsIndex data={data} simple />
    </SimpleShell>
  );
}
