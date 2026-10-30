import type { Metadata } from 'next';
import Link from 'next/link';
import { FileList } from '@/components/simple/FileList';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb } from '@/lib/db';
import { plural } from '@/lib/format';
import { currentSemester } from '@/lib/semester';
import { requireUser } from '@/lib/session';
import { parsePageParam } from '@/lib/simple';
import { isoFiles, loadSimplePreview, navSubjects } from '@/lib/simple-page';
import { listSimpleFiles } from '@/lib/simple-queries';

export const metadata: Metadata = { title: 'Recently added' };

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const PER_PAGE = 50;
/** "Show more" grows the list in place; cap the rows rendered at once. */
const MAX_PAGES = 40;

export default async function SimpleRecent({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const page = parsePageParam(sp, MAX_PAGES);
  const semester = await currentSemester(sp);
  const cardsP = cachedSubjectCards(semester);
  const [cards, list, preview] = await Promise.all([
    cardsP,
    listSimpleFiles(db, { limit: page * PER_PAGE }),
    loadSimplePreview(db, sp, cachedSubjectCards()),
  ]);
  const baseHref = page > 1 ? `/s/recent?page=${page}` : '/s/recent';
  const shown = list.rows.length;
  const more = shown < list.total && page < MAX_PAGES;
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'recent' }}
      crumbs={[
        { label: 'Start', href: '/s' },
        { label: 'Recently added', href: '/s/recent' },
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
      <div>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">
          Recently added
        </h1>
        <p className="mt-1 mb-0 text-pretty text-muted">
          All files, newest first.
        </p>
      </div>
      <FileList
        files={isoFiles(list.rows)}
        withSubject
        selectedId={preview?.file.id ?? null}
        baseHref={baseHref}
        emptyText="No files have been added yet."
      />
      {list.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
          <span>
            {shown} of {plural(list.total, 'file', 'files')}
          </span>
          {more && (
            <Link
              href={`/s/recent?page=${page + 1}`}
              scroll={false}
              className="inline-flex h-8 items-center rounded-md border border-line-strong bg-page px-3 text-accent-ink transition-colors duration-100 hover:border-accent active:translate-y-px"
            >
              Show more
            </Link>
          )}
        </div>
      )}
    </SimpleShell>
  );
}
