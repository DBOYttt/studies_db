import { getRoPool } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { handleSqlRequest } from '@/lib/sql-console';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireUser(); // redirects to /login-info (307)
  return handleSqlRequest(req, user, getRoPool());
}
