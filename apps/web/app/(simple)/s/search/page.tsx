import { FileList } from '@/components/simple/FileList';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { getDb } from '@/lib/db';
import { pluralPl } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { parseSearchQuery } from '@/lib/simple';
import { isoFiles, loadSimplePreview, navSubjects } from '@/lib/simple-page';
import { listSubjectCards, searchSimpleFiles } from '@/lib/simple-queries';

export const dynamic = 'force-dynamic';

/** Cap of the search (searchSimpleFiles' default limit). */
const SEARCH_LIMIT = 100;

type SP = Record<string, string | string[] | undefined>;

export default async function SimpleSearch({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const q = parseSearchQuery(sp);
  const cardsP = listSubjectCards(db);
  const [cards, hits, preview] = await Promise.all([
    cardsP,
    q ? searchSimpleFiles(db, q, SEARCH_LIMIT) : Promise.resolve([]),
    loadSimplePreview(db, sp, cardsP),
  ]);
  const baseHref = q ? `/s/search?q=${encodeURIComponent(q)}` : '/s/search';
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'search', q }}
      crumbs={[{ label: 'Start', href: '/s' }, { label: 'Wyszukiwanie' }]}
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
      <div>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] break-words">
          {q ? `Wyniki dla „${q}”` : 'Wyszukiwanie'}
        </h1>
        <p className="mt-1 mb-0 text-pretty text-muted">
          {q
            ? hits.length >= SEARCH_LIMIT
              ? `${SEARCH_LIMIT}+ plików — pokazuję pierwsze ${SEARCH_LIMIT}`
              : `${hits.length} ${pluralPl(hits.length, 'plik', 'pliki', 'plików')}`
            : 'Wpisz słowo w polu wyszukiwania i naciśnij Enter.'}
        </p>
      </div>
      {q && (
        <FileList
          files={isoFiles(hits)}
          withSubject
          selectedId={preview?.file.id ?? null}
          baseHref={baseHref}
          q={q}
          emptyText="Nic nie znaleziono. Spróbuj innego słowa."
        />
      )}
    </SimpleShell>
  );
}
