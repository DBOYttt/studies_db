import { handleAdminSqlRequest } from '@/lib/admin-sql-handler';
import { getDb, getRwPool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireAdmin(); // 404 for non-admins
  return handleAdminSqlRequest(req, user, { db: getDb(), rw: getRwPool() });
}
