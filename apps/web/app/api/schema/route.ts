import { getRoPool } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { listViewColumns } from '@/lib/tables';

export const dynamic = 'force-dynamic';

/** View -> column names, for SQL console autocomplete. */
export async function GET() {
  await requireUser(); // redirects to /login-info (307)
  return Response.json(await listViewColumns(getRoPool()), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
