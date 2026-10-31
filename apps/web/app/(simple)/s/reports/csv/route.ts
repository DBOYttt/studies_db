import { toCsv } from '@/lib/csv';
import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { reportQuery } from '@/lib/example-queries';
import { currentSemester } from '@/lib/semester';
import { requireUser } from '@/lib/session';
import {
  MAX_ROWS,
  parseReportIndex,
  REPORT_LABELS,
  REPORT_SLUGS,
  reportCsvCell,
} from '@/lib/simple';
import { runReadonlyQuery } from '@/lib/sql-console';

export const dynamic = 'force-dynamic';

/**
 * CSV of one ready-made report (`?r=0..2`), headed by the English labels,
 * for the chosen semester like the page.
 */
export async function GET(req: Request) {
  await requireUser();
  const params = new URL(req.url).searchParams;
  const r = parseReportIndex(params.getAll('r'));
  // The same semester as the page: `?sem=`, else the cookie.
  const q = reportQuery(
    r,
    await currentSemester({ sem: params.get('sem') ?? undefined }),
  );
  let res: Awaited<ReturnType<typeof runReadonlyQuery>>;
  try {
    res = await runReadonlyQuery(getRoPool(), q.sql, {
      maxRows: MAX_ROWS,
      values: q.values,
    });
  } catch (err) {
    res = { ok: false, error: roErrorMessage(err) };
  }
  if (!res.ok) {
    return new Response(res.error, {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
  const header = res.columns.map((c) => REPORT_LABELS[c] ?? c);
  return new Response(
    toCsv(
      header,
      res.rows.map((row) =>
        row.map((v, i) => reportCsvCell(res.columns[i], v)),
      ),
    ),
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${REPORT_SLUGS[r]}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
