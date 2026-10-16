import { CalendarBlank, Plus } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { EventDetails } from '@/components/events/EventDetails';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { getDb } from '@/lib/db';
import { loadEventPage, parseEventId } from '@/lib/event-page';
import { requireUser } from '@/lib/session';
import { loadSimplePreview } from '@/lib/simple-page';
import { listSubjectCards } from '@/lib/simple-queries';

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
  const preview = await loadSimplePreview(db, sp, listSubjectCards(db));
  const baseHref = `/wydarzenia/${id}`;
  return (
    <>
      <ScreenHeader
        crumbs={[
          { icon: CalendarBlank, label: 'Plan zajęć', href: '/plan' },
          { label: e.title, href: baseHref },
        ]}
        tabs={dbTabs('plan')}
      />
      <div className="flex max-w-4xl flex-col gap-3.5">
        <Link
          href="/wydarzenia/nowe"
          className="link inline-flex items-center gap-1 self-start text-[13px]"
        >
          <Plus size={13} aria-hidden />
          Wydarzenie
        </Link>
        <EventDetails
          e={e}
          base="advanced"
          baseHref={baseHref}
          editHref={`${baseHref}/edytuj`}
          selectedFileId={preview?.file.id ?? null}
          canRestore={user.isAdmin}
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
