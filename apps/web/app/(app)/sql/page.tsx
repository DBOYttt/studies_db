import type { Metadata } from 'next';
import { SqlConsole } from '@/components/SqlConsole';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getViewsPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { requireUser } from '@/lib/session';
import { listViewColumns } from '@/lib/tables';

export const metadata: Metadata = { title: 'SQL' };

export const dynamic = 'force-dynamic';

const MAX_PREFILL = 4000;

export default async function SqlPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requireUser();
  const { q } = await searchParams;
  // Prefill only: the editor shows it, the user runs it.
  const initialQuery =
    typeof q === 'string' && q.trim() ? q.slice(0, MAX_PREFILL) : undefined;
  let schema: Record<string, string[]> | undefined;
  let error: string | null = null;
  try {
    schema = await listViewColumns(getViewsPool());
  } catch (err) {
    error = roErrorMessage(err);
  }
  return (
    <>
      <ScreenHeader tabs={dbTabs('sql')} />
      <div className="flex flex-col gap-3">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
          >
            Could not load the column list: {error}
          </div>
        )}
        <SqlConsole
          key={initialQuery ?? ''}
          initialQuery={initialQuery}
          schema={schema ?? {}}
        />
      </div>
    </>
  );
}
