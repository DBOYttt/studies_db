import { ChatsCircle, Files, User } from '@phosphor-icons/react/dist/ssr';
import { notFound } from 'next/navigation';
import {
  EntityFilesGrid,
  EntityTopicsGrid,
} from '@/components/EntityFilesGrid';
import { ScreenHeader, type Tab } from '@/components/shell/ScreenHeader';
import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import {
  parseEntityGrid,
  parseEntityId,
  parseEntityTab,
} from '@/lib/entity-page';
import { getUser, userFiles, userTopics } from '@/lib/entity-queries';
import { formatDate } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { userHref } from '@/lib/view-links';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const TABS = ['files', 'topics'] as const;

const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';

function joined(v: unknown): string | null {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : formatDate(d);
}

/** User page (spec section 2): Uploaded files, Topics. */
export default async function UserPage({
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
  const base = userHref(id);

  let user: Awaited<ReturnType<typeof getUser>> = null;
  try {
    user = await getUser(pool, id);
  } catch (err) {
    return (
      <>
        <ScreenHeader
          crumbs={[{ icon: User, kind: 'User:', label: `#${id}`, href: base }]}
        />
        <div role="alert" className={errBox}>
          Could not load the user: {roErrorMessage(err)}
        </div>
      </>
    );
  }
  if (!user) notFound();

  const tab = parseEntityTab(sp, TABS);
  const grid = parseEntityGrid(sp);
  const since = joined(user.created_at);
  const tabs: Tab[] = [
    {
      label: 'Uploaded files',
      icon: Files,
      href: base,
      active: tab === 'files',
    },
    {
      label: 'Topics',
      icon: ChatsCircle,
      href: `${base}?tab=topics`,
      active: tab === 'topics',
    },
  ];

  return (
    <>
      <ScreenHeader
        crumbs={[
          {
            icon: User,
            kind: 'User:',
            label: user.display_name,
            href: base,
          },
        ]}
        tabs={tabs}
      />
      <div className="flex flex-col gap-3.5">
        <div className="min-w-0">
          <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">
            {user.display_name}
          </h1>
          <p className="mt-0.5 font-mono text-xs text-muted">
            id {user.id}
            {since && `, joined ${since}`}
          </p>
        </div>
        {tab === 'files' && (
          <EntityFilesGrid
            basePath={base}
            tab={null}
            grid={grid}
            load={() => userFiles(pool, id, grid)}
            name={`uzytkownik-${id}-pliki`}
          />
        )}
        {tab === 'topics' && (
          <EntityTopicsGrid
            basePath={base}
            tab="topics"
            grid={grid}
            load={() => userTopics(pool, id, grid)}
            name={`uzytkownik-${id}-tematy`}
          />
        )}
      </div>
    </>
  );
}
