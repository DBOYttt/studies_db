import { getEvent, listEventUploads } from '@studies/db';
import { EVENT_NOT_FOUND } from '@studies/db/text';
import { getDb } from '@/lib/db';
import { handleEventUpload } from '@/lib/event-upload';
import { requireUser } from '@/lib/session';
import { storageDir } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const NO_STORE = { 'Cache-Control': 'private, no-store' };

function storageRoot(): string | null {
  if (!process.env.STORAGE_DIR) return null;
  try {
    return storageDir();
  } catch {
    return null;
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const user = await requireUser();
  const { id } = await ctx.params;
  return handleEventUpload(req, user, id, {
    db: getDb(),
    storageRoot: storageRoot(),
  });
}

/** Status of the event's recent uploads (polled by the event page). */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  const { id } = await ctx.params;
  if (!/^[1-9]\d{0,9}$/.test(id)) {
    return Response.json({ error: EVENT_NOT_FOUND }, { status: 404 });
  }
  const db = getDb();
  const ev = await getEvent(db, Number(id));
  if (!ev || (ev.deletedAt !== null && !user.isAdmin)) {
    return Response.json(
      { error: EVENT_NOT_FOUND },
      { status: 404, headers: NO_STORE },
    );
  }
  const uploads = await listEventUploads(db, Number(id));
  return Response.json({ uploads }, { headers: NO_STORE });
}
