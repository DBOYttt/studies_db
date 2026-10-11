import { DesignerDiagram } from '@/components/DesignerDiagram';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { requireUser } from '@/lib/session';
import { listViewColumns } from '@/lib/tables';

export const dynamic = 'force-dynamic';

export default async function SchemaPage() {
  await requireUser();
  let columns: Awaited<ReturnType<typeof listViewColumns>> | null = null;
  let error: string | null = null;
  try {
    columns = await listViewColumns(getRoPool());
  } catch (err) {
    error = roErrorMessage(err);
  }
  return (
    <>
      <ScreenHeader tabs={dbTabs('designer')} />
      <div className="flex flex-col gap-3">
        <h1 className="sr-only">Projektant</h1>
        <p className="m-0 max-w-[75ch] text-muted">
          Widoki dostępne w konsoli SQL i ich kolumny. Linie łączą kolumny, po
          których możesz robić JOIN. Kliknij tabelę, aby zobaczyć jej wiersze.
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
