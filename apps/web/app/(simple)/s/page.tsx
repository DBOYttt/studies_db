import { FileList } from '@/components/simple/FileList';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { SubjectCards } from '@/components/simple/SubjectCards';
import { UpcomingEvents } from '@/components/simple/UpcomingEvents';
import { getDb, getRoPool } from '@/lib/db';
import { nowWall } from '@/lib/plan';
import { requireUser } from '@/lib/session';
import { isoFiles, loadSimplePreview, navSubjects } from '@/lib/simple-page';
import { listSimpleFiles, listSubjectCards } from '@/lib/simple-queries';
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
  const cardsP = listSubjectCards(db);
  const [cards, recent, preview, upcoming] = await Promise.all([
    cardsP,
    listSimpleFiles(db, { limit: 5 }),
    loadSimplePreview(db, sp, cardsP),
    // Events are optional on the start page: a failure leaves the card empty.
    upcomingForUser(db, getRoPool(), user.id, nowWall()).catch(() => []),
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
      <div>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">
          Subjects
        </h1>
        <p className="mt-1 mb-0 text-pretty text-muted">
          Pick a subject to see its class materials.
        </p>
      </div>
      <SubjectCards cards={cards} />
      <UpcomingEvents events={upcoming} />
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
