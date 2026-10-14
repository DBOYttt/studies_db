import { FileList } from '@/components/simple/FileList';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { SubjectCards } from '@/components/simple/SubjectCards';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { isoFiles, loadSimplePreview, navSubjects } from '@/lib/simple-page';
import { listSimpleFiles, listSubjectCards } from '@/lib/simple-queries';

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
  const [cards, recent, preview] = await Promise.all([
    cardsP,
    listSimpleFiles(db, { limit: 5 }),
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
      <div>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">
          Przedmioty
        </h1>
        <p className="mt-1 mb-0 text-pretty text-muted">
          Wybierz przedmiot, aby zobaczyć materiały z zajęć.
        </p>
      </div>
      <SubjectCards cards={cards} />
      <h2 className="mt-3 mb-0 text-base font-semibold">Ostatnio dodane</h2>
      <FileList
        files={isoFiles(recent.rows)}
        withSubject
        selectedId={preview?.file.id ?? null}
        baseHref="/s"
        emptyText="Nie dodano jeszcze żadnych plików."
      />
    </SimpleShell>
  );
}
