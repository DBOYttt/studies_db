import { toCsv } from '@/lib/csv';
import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { EXAMPLE_QUERIES } from '@/lib/example-queries';
import { requireUser } from '@/lib/session';
import {
  MAX_ROWS,
  parseReportIndex,
  REPORT_LABELS,
  REPORT_SLUGS,
} from '@/lib/simple';
import { runReadonlyQuery } from '@/lib/sql-console';

export const dynamic = 'force-dynamic';

/** CSV of one ready-made report (`?r=0..2`), headed by the Polish labels. */
export async function GET(req: Request) {
  await requireUser();
  const r = parseReportIndex(new URL(req.url).searchParams.getAll('r'));
  let res: Awaited<ReturnType<typeof runReadonlyQuery>>;
  try {
    res = await runReadonlyQuery(getRoPool(), EXAMPLE_QUERIES[r].sql, {
      maxRows: MAX_ROWS,
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
  return new Response(toCsv(header, res.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${REPORT_SLUGS[r]}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
