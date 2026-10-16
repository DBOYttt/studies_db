import { Plus } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { EventDetails } from '@/components/events/EventDetails';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { getDb } from '@/lib/db';
import { loadEventPage, parseEventId } from '@/lib/event-page';
import { requireUser } from '@/lib/session';
import { loadSimplePreview, navSubjects } from '@/lib/simple-page';
import { listSubjectCards } from '@/lib/simple-queries';

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
    listSubjectCards(db),
  ]);
  const preview = await loadSimplePreview(db, sp, cards);
  const baseHref = `/s/wydarzenia/${id}`;
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'plan' }}
      crumbs={[
        { label: 'Start', href: '/s' },
        { label: 'Plan zajęć', href: '/s/plan' },
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
      <Link
        href="/s/wydarzenia/nowe"
        className="link inline-flex items-center gap-1 self-start text-[13px]"
      >
        <Plus size={13} aria-hidden />
        Wydarzenie
      </Link>
      <EventDetails
        e={e}
        base="simple"
        baseHref={baseHref}
        editHref={`${baseHref}/edytuj`}
        selectedFileId={preview?.file.id ?? null}
        canRestore={user.isAdmin}
      />
    </SimpleShell>
  );
}
