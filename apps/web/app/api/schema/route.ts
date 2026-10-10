import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { requireUser } from '@/lib/session';
import { listViewColumns } from '@/lib/tables';

export const dynamic = 'force-dynamic';

/** View -> column names, for SQL console autocomplete. */
export async function GET() {
  await requireUser(); // redirects to /login-info (307)
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    return Response.json(await listViewColumns(getRoPool()), { headers });
  } catch (err) {
    return Response.json(
      { error: roErrorMessage(err) },
      { status: 503, headers },
    );
  }
}
