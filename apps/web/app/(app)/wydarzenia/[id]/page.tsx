import { CalendarBlank } from '@phosphor-icons/react/dist/ssr';
import { EventDetails } from '@/components/events/EventDetails';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb } from '@/lib/db';
import { loadEventPage, parseEventId } from '@/lib/event-page';
import { noticeFromSearchParams } from '@/lib/notices';
import { requireUser } from '@/lib/session';
import { loadSimplePreview } from '@/lib/simple-page';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export default async function EventPage({
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
  const e = await loadEventPage(id, user);
  const preview = await loadSimplePreview(db, sp, cachedSubjectCards());
  const baseHref = `/wydarzenia/${id}`;
  return (
    <>
      <ScreenHeader
        crumbs={[
          { icon: CalendarBlank, label: 'Timetable', href: '/plan' },
          { label: e.title, href: baseHref },
        ]}
        tabs={dbTabs('plan')}
      />
      <div className="flex max-w-4xl flex-col gap-3.5">
        <EventDetails
          e={e}
          base="advanced"
          baseHref={baseHref}
          editHref={`${baseHref}/edytuj`}
          selectedFileId={preview?.file.id ?? null}
          canRestore={user.isAdmin}
          notice={noticeFromSearchParams(sp)}
        />
        {preview && (
          <div className="rounded-lg border border-line-strong">
            <SimplePreview
              file={preview.file}
              closeHref={baseHref}
              meta={{ subjectName: preview.subjectName }}
            />
          </div>
        )}
      </div>
    </>
  );
}
