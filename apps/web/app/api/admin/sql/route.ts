import { handleAdminSqlRequest } from '@/lib/admin-sql-handler';
import { getDb, getRwPool } from '@/lib/db';
import { requireAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await requireAdmin(); // 404 for non-admins
  return handleAdminSqlRequest(req, user, { db: getDb(), rw: getRwPool() });
}

/** Only POST is served; other methods stay hidden from non-admins too. */
async function notAllowed() {
  await requireAdmin();
  return new Response(null, {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'private, no-store' },
  });
}

export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
