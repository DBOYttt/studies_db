import { SqlConsole } from '@/components/SqlConsole';
import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { listViewColumns } from '@/lib/tables';

export const dynamic = 'force-dynamic';

export default async function SqlPage() {
  let schema: Record<string, string[]> = {};
  let error: string | null = null;
  try {
    schema = await listViewColumns(getRoPool());
  } catch (err) {
    error = roErrorMessage(err);
  }
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row">
      <aside className="shrink-0 lg:w-64">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">
          Schemat
        </h2>
        {error && (
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        )}
        <div className="space-y-1">
          {Object.entries(schema).map(([view, cols]) => (
            <details
              key={view}
              className="rounded border border-[var(--border)] px-2 py-1 text-sm"
            >
              <summary className="cursor-pointer font-mono">{view}</summary>
              <ul className="mt-1 space-y-0.5 pl-3 font-mono text-xs text-[var(--muted)]">
                {cols.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </aside>
      <section className="min-w-0 flex-1 space-y-3">
        <h1 className="text-2xl font-semibold">Konsola SQL</h1>
        <p className="text-sm text-[var(--muted)]">
          Tylko odczyt (SELECT) na widokach v_*. Limit 1000 wierszy i 5 sekund.
        </p>
        <SqlConsole />
      </section>
    </div>
  );
}
