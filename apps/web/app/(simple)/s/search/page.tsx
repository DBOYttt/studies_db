import type { Metadata } from 'next';
import { FileList } from '@/components/simple/FileList';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb } from '@/lib/db';
import { searchCountText } from '@/lib/search-count';
import { requireUser } from '@/lib/session';
import { advancedSearchHref, parseSearchQuery } from '@/lib/simple';
import { isoFiles, loadSimplePreview, navSubjects } from '@/lib/simple-page';
import { searchSimpleFiles } from '@/lib/simple-queries';

export const metadata: Metadata = { title: 'Search' };

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
  const cardsP = cachedSubjectCards();
  const [cards, { files: hits, topics }, preview] = await Promise.all([
    cardsP,
    q
      ? searchSimpleFiles(db, q, SEARCH_LIMIT)
      : Promise.resolve({ files: [], topics: 0 }),
    loadSimplePreview(db, sp, cardsP),
  ]);
  const baseHref = q ? `/s/search?q=${encodeURIComponent(q)}` : '/s/search';
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'search', q }}
      crumbs={[{ label: 'Start', href: '/s' }, { label: 'Search' }]}
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
          {q ? `Results for “${q}”` : 'Search'}
        </h1>
        <p className="mt-1 mb-0 text-pretty text-muted">
          {q ? (
            <>
              {searchCountText(
                hits.length,
                topics,
                hits.length >= SEARCH_LIMIT ? SEARCH_LIMIT : undefined,
              )}
              {topics > 0 && (
                <>
                  {' '}
                  <a href={advancedSearchHref(q)} className="link">
                    Show topics in Advanced
                  </a>
                </>
              )}
            </>
          ) : (
            'Type a word in the search box and press Enter.'
          )}
        </p>
      </div>
      {q && (
        <FileList
          files={isoFiles(hits)}
          withSubject
          selectedId={preview?.file.id ?? null}
          baseHref={baseHref}
          q={q}
          emptyText="Nothing found. Try another word."
        />
      )}
    </SimpleShell>
  );
}
