import { ChatsCircle, Files, Tag } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  EntityFilesGrid,
  EntityTopicsGrid,
} from '@/components/EntityFilesGrid';
import { ScreenHeader, type Tab } from '@/components/shell/ScreenHeader';
import { TagBadge } from '@/components/TagBadge';
import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import {
  parseEntityGrid,
  parseEntityId,
  parseEntityTab,
} from '@/lib/entity-page';
import { getTag, tagFiles, tagTopics } from '@/lib/entity-queries';
import { explorerHref } from '@/lib/explorer';
import { requireUser } from '@/lib/session';
import { tagHref } from '@/lib/view-links';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const TABS = ['topics', 'files'] as const;

const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';

/** Tag page (spec section 2): Topics, Files. */
export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  await requireUser();
  const id = parseEntityId((await params).id);
  if (id === null) notFound();
  const sp = await searchParams;
  const pool = getRoPool();
  const base = tagHref(id);

  let tag: Awaited<ReturnType<typeof getTag>> = null;
  try {
    tag = await getTag(pool, id);
  } catch (err) {
    return (
      <>
        <ScreenHeader
          crumbs={[{ icon: Tag, kind: 'Tag:', label: `#${id}`, href: base }]}
        />
        <div role="alert" className={errBox}>
          Could not load the tag: {roErrorMessage(err)}
        </div>
      </>
    );
  }
  if (!tag) notFound();

  const tab = parseEntityTab(sp, TABS);
  const grid = parseEntityGrid(sp);
  const tabs: Tab[] = [
    {
      label: 'Topics',
      icon: ChatsCircle,
      href: base,
      active: tab === 'topics',
    },
    {
      label: 'Files',
      icon: Files,
      href: `${base}?tab=files`,
      active: tab === 'files',
    },
  ];

  return (
    <>
      <ScreenHeader
        crumbs={[{ icon: Tag, kind: 'Tag:', label: tag.name, href: base }]}
        tabs={tabs}
      />
      <div className="flex flex-col gap-3.5">
        <div className="min-w-0">
          <h1 className="m-0 flex items-center gap-2 text-xl font-semibold tracking-[-0.01em]">
            <span className="sr-only">Tag </span>
            <TagBadge name={tag.name} size="lg" />
          </h1>
          <p className="mt-1 font-mono text-xs text-muted">
            id {tag.id}, subject{' '}
            <Link
              href={explorerHref(tag.subject_code, {})}
              className="text-accent-ink hover:text-accent-ink-hover hover:underline"
            >
              {tag.subject_name}
            </Link>
          </p>
        </div>
        {tab === 'topics' && (
          <EntityTopicsGrid
            basePath={base}
            tab={null}
            grid={grid}
            load={() => tagTopics(pool, id, grid)}
            name={`tag-${id}-tematy`}
          />
        )}
        {tab === 'files' && (
          <EntityFilesGrid
            basePath={base}
            tab="files"
            grid={grid}
            load={() => tagFiles(pool, id, grid)}
            name={`tag-${id}-pliki`}
          />
        )}
      </div>
    </>
  );
}
