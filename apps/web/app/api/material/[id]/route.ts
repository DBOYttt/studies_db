import { getDb } from '@/lib/db';
import { getMaterialFile } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

// Spec'd JSON API; the explorer UI itself renders the preview panel server-side.
/** A live file as `ExplorerFile` JSON; 404 for deleted, unknown or malformed ids. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser(); // redirects to /login-info (307)
  const { id } = await params;
  const n = /^[1-9]\d*$/.test(id) ? Number(id) : NaN;
  const file = Number.isSafeInteger(n)
    ? await getMaterialFile(getDb(), n)
    : null;
  if (!file)
    return Response.json({ error: 'not found' }, { status: 404, headers });
  return Response.json(file, { headers });
}
