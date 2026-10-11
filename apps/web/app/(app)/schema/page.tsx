import { SchemaDiagram } from '@/components/SchemaDiagram';
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
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Schemat bazy</h1>
        <p className="max-w-[65ch] text-sm text-muted">
          Widoki dostępne w konsoli SQL i ich kolumny. Linie łączą kolumny, po
          których możesz robić JOIN. Kliknij tabelę, aby zobaczyć jej wiersze.
        </p>
      </header>
      {columns ? (
        <SchemaDiagram columns={columns} highlight={[]} caption={null} />
      ) : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
