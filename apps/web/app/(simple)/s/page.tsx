import { Suspense } from 'react';
import { FileList } from '@/components/simple/FileList';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { SubjectCards } from '@/components/simple/SubjectCards';
import { UpcomingEvents } from '@/components/simple/UpcomingEvents';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb, getViewsPool } from '@/lib/db';
import { nowWall, type PlanSession } from '@/lib/plan';
import { requireUser } from '@/lib/session';
import { isoFiles, loadSimplePreview, navSubjects } from '@/lib/simple-page';
import { listSimpleFiles } from '@/lib/simple-queries';
import { upcomingForUser } from '@/lib/upcoming-events';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export default async function SimpleStart({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const cardsP = cachedSubjectCards();
  // Started now, awaited in its own Suspense boundary so the rest of the
  // page does not wait for it. Events are optional on the start page: a
  // failure leaves the card empty.
  const upcoming = upcomingForUser(
    db,
    getViewsPool(),
    user.id,
    nowWall(),
  ).catch(() => []);
  const [cards, recent, preview] = await Promise.all([
    cardsP,
    listSimpleFiles(db, { limit: 5, withTotal: false }),
    loadSimplePreview(db, sp, cardsP),
  ]);
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'home' }}
      crumbs={[{ label: 'Start', href: '/s' }]}
      user={user}
      adminEntry={user.isAdmin ? <SimpleAdminEntry /> : null}
      aside={
        preview && (
          <SimplePreview
            file={preview.file}
            closeHref="/s"
            meta={{ subjectName: preview.subjectName }}
          />
        )
      }
    >
      <h1 className="sr-only">Start</h1>
      {/* What's next first: upcoming events above the subject grid. */}
      <Suspense fallback={<UpcomingEvents events={null} />}>
        <UpcomingSlot events={upcoming} />
      </Suspense>
      <div>
        <h2 className="mt-3 mb-0 text-base font-semibold">Subjects</h2>
        <p className="mt-1 mb-0 text-pretty text-muted">
          Pick a subject to see its class materials.
        </p>
      </div>
      <SubjectCards cards={cards} />
      <h2 className="mt-3 mb-0 text-base font-semibold">Recently added</h2>
      <FileList
        files={isoFiles(recent.rows)}
        withSubject
        selectedId={preview?.file.id ?? null}
        baseHref="/s"
        emptyText="No files have been added yet."
      />
    </SimpleShell>
  );
}

async function UpcomingSlot({ events }: { events: Promise<PlanSession[]> }) {
  return <UpcomingEvents events={await events} />;
}
