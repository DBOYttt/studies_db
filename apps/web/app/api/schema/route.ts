import { getViewsPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { SCHEMA_RELATIONS } from '@/lib/schema-relations';
import { requireUser } from '@/lib/session';
import { listViewColumns } from '@/lib/tables';

export const dynamic = 'force-dynamic';

/** Columns per view (SQL console autocomplete) and the relations between views. */
export async function GET() {
  await requireUser(); // redirects to /login-info (307)
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    return Response.json(
      {
        columns: await listViewColumns(getViewsPool()),
        relations: SCHEMA_RELATIONS,
      },
      { headers },
    );
  } catch (err) {
    return Response.json(
      { error: roErrorMessage(err) },
      { status: 503, headers },
    );
  }
}
