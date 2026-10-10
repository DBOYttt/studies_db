import { toCsv } from '@/lib/csv';
import { getRoPool } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { runReadonlyQuery } from '@/lib/sql-console';
import { isPublicView } from '@/lib/tables';

export const dynamic = 'force-dynamic';

const MAX_EXPORT_ROWS = 50_000;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ view: string }> },
) {
  await requireUser();
  const { view } = await params;
  if (!isPublicView(view)) return new Response('Not found', { status: 404 });
  // `view` is whitelisted above, so interpolating it is safe.
  const r = await runReadonlyQuery(getRoPool(), `SELECT * FROM \`${view}\``, {
    maxRows: MAX_EXPORT_ROWS,
  });
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
