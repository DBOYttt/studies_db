import { toCsv } from '@/lib/csv';
import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { requireUser } from '@/lib/session';
import { runReadonlyQuery } from '@/lib/sql-console';
import { buildViewSql, isPublicView, parseViewParams } from '@/lib/tables';

export const dynamic = 'force-dynamic';

const MAX_EXPORT_ROWS = 50_000;

/** Same rows as the table page: honours its sort/dir/f_<col> params. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ view: string }> },
) {
  await requireUser();
  const { view } = await params;
  if (!isPublicView(view)) return new Response('Not found', { status: 404 });
  const pool = getRoPool();
  let r: Awaited<ReturnType<typeof runReadonlyQuery>>;
  try {
    const q = parseViewParams(new URL(req.url).searchParams);
    // `view` and every identifier in `from`/`orderBy` are whitelisted;
    // filter values are `?` params.
    const { from, orderBy, params: values } = await buildViewSql(pool, view, q);
    r = await runReadonlyQuery(pool, `SELECT *${from}${orderBy}`, {
      maxRows: MAX_EXPORT_ROWS,
      values,
    });
  } catch (err) {
    r = { ok: false, error: roErrorMessage(err) };
  }
  if (!r.ok) {
    return new Response(r.error, {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
  return new Response(toCsv(r.columns, r.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${view}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
