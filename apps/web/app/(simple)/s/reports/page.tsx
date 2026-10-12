import { DownloadSimple, TerminalWindow } from '@phosphor-icons/react/dist/ssr';
import { ReportCards } from '@/components/simple/ReportCards';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { getDb, getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { EXAMPLE_QUERIES } from '@/lib/example-queries';
import { formatDate, pluralPl } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { parseReportIndex, REPORT_LABELS } from '@/lib/simple';
import { navSubjects } from '@/lib/simple-page';
import { listSubjectCards } from '@/lib/simple-queries';
import { runReadonlyQuery } from '@/lib/sql-console';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const MAX_ROWS = 1000;

/** Counts and ids (the DB driver sends COUNT() as a string, so go by name). */
const NUMERIC_COLUMNS = new Set(['materialy', 'liczba_plikow', 'id']);

const cellText = (col: string, v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (col === 'created_at' && (typeof v === 'string' || v instanceof Date))
    return formatDate(v);
  return String(v);
};

export default async function SimpleReports({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const r = parseReportIndex((await searchParams).r);
  const query = EXAMPLE_QUERIES[r];
  const [cards, result] = await Promise.all([
    listSubjectCards(getDb()),
    runReadonlyQuery(getRoPool(), query.sql, { maxRows: MAX_ROWS }).catch(
      (err: unknown) => ({ ok: false as const, error: roErrorMessage(err) }),
    ),
  ]);
  const sqlHref = `/mode?to=advanced&next=${encodeURIComponent(`/s/reports?r=${r}`)}`;
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'reports' }}
      crumbs={[
        { label: 'Start', href: '/s' },
        { label: 'Gotowe zestawienia', href: '/s/reports' },
      ]}
      user={user}
    >
      <div>
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">
          Gotowe zestawienia
        </h1>
        <p className="mt-1 mb-0 text-pretty text-muted">
          Odpowiedzi na częste pytania o bazę. Wybierz jedno, aby zobaczyć
          wynik.
        </p>
      </div>
      <ReportCards selected={r} />
      <section
        aria-label={query.name}
        className="overflow-hidden rounded-lg border border-line-strong bg-panel"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-strong bg-box-head px-3.5 py-2.5">
          <h2 className="m-0 text-base font-semibold">{query.name}</h2>
          {result.ok && (
            <span className="text-[13px] text-muted">
              {result.rows.length}{' '}
              {pluralPl(result.rows.length, 'wiersz', 'wiersze', 'wierszy')}
            </span>
          )}
          <span className="flex-1" />
          <a
            href={sqlHref}
            className="inline-flex items-center gap-1 text-[13px] text-accent-ink hover:underline"
          >
            <TerminalWindow size={15} aria-hidden />
            Zobacz zapytanie SQL
          </a>
          <a
            href={`/s/reports/csv?r=${r}`}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-fill px-3.5 font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-fill-hover active:translate-y-px"
          >
            <DownloadSimple size={15} aria-hidden />
            Pobierz CSV
          </a>
        </div>
        {result.ok ? (
          <ReportTable columns={result.columns} rows={result.rows} />
        ) : (
          <p
            role="alert"
            className="m-3 rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg"
          >
            Nie udało się wczytać zestawienia: {result.error}
          </p>
        )}
      </section>
    </SimpleShell>
  );
}

function ReportTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: unknown[][];
}) {
  const numeric = columns.map((c) => NUMERIC_COLUMNS.has(c));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={`border-b border-line-strong px-3.5 py-2 font-semibold text-muted ${
                  numeric[i] ? 'text-right' : 'text-left'
                }`}
              >
                {REPORT_LABELS[c] ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static result rows
            <tr key={ri} className="hover:bg-list-hover">
              {row.map((v, i) => (
                <td
                  key={columns[i]}
                  className={`border-b border-line px-3.5 py-2 ${
                    numeric[i] ? 'text-right tabular-nums' : ''
                  } ${v === null || v === undefined ? 'text-faint' : ''}`}
                >
                  {cellText(columns[i], v)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={Math.max(columns.length, 1)}
                className="px-3.5 py-6 text-center text-muted"
              >
                Brak wyników w tym zestawieniu.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
