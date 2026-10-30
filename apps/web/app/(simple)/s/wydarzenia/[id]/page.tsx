import type { Metadata } from 'next';
import { EventDetails } from '@/components/events/EventDetails';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb } from '@/lib/db';
import { loadEventPage, parseEventId } from '@/lib/event-page';
import { noticeFromSearchParams } from '@/lib/notices';
import { eventMetadata } from '@/lib/page-meta';
import { currentSemester } from '@/lib/semester';
import { requireUser } from '@/lib/session';
import { loadSimplePreview, navSubjects } from '@/lib/simple-page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return eventMetadata((await params).id);
}

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export default async function SimpleEvent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const [{ id: raw }, sp] = await Promise.all([params, searchParams]);
  const id = parseEventId(raw);
  const db = getDb();
  const [e, cards] = await Promise.all([
    loadEventPage(id, user),
    cachedSubjectCards(await currentSemester(sp)),
  ]);
  const preview = await loadSimplePreview(db, sp, cachedSubjectCards());
  const baseHref = `/s/wydarzenia/${id}`;
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'plan' }}
      crumbs={[
        { label: 'Start', href: '/s' },
        { label: 'Timetable', href: '/s/plan' },
        { label: e.title },
      ]}
      user={user}
      adminEntry={user.isAdmin ? <SimpleAdminEntry /> : null}
      aside={
        preview && (
          <SimplePreview
            file={preview.file}
            closeHref={baseHref}
            meta={{ subjectName: preview.subjectName }}
          />
        )
      }
    >
      <EventDetails
        e={e}
        base="simple"
        baseHref={baseHref}
        editHref={`${baseHref}/edytuj`}
        selectedFileId={preview?.file.id ?? null}
        canRestore={user.isAdmin}
        notice={noticeFromSearchParams(sp)}
      />
    </SimpleShell>
  );
}
