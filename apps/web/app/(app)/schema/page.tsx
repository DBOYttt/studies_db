import type { Metadata } from 'next';
import { DesignerDiagram } from '@/components/DesignerDiagram';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getViewsPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { requireUser } from '@/lib/session';
import { listViewColumns } from '@/lib/tables';

export const metadata: Metadata = { title: 'Designer' };

export const dynamic = 'force-dynamic';

export default async function SchemaPage() {
  await requireUser();
  let columns: Awaited<ReturnType<typeof listViewColumns>> | null = null;
  let error: string | null = null;
  try {
    columns = await listViewColumns(getViewsPool());
  } catch (err) {
    error = roErrorMessage(err);
  }
  return (
    <>
      <ScreenHeader tabs={dbTabs('designer')} />
      <div className="flex flex-col gap-3">
        <h1 className="sr-only">Designer</h1>
        <p className="m-0 max-w-[75ch] text-muted">
          Views available in the SQL console and their columns. Lines link
          columns you can JOIN on. Click a table to see its rows.
        </p>
        {columns ? (
          <DesignerDiagram columns={columns} />
        ) : (
          <div
            role="alert"
            className="rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg"
          >
            {error}
          </div>
        )}
      </div>
    </>
  );
}
