import { toCsv } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { parseExplorerFilters, parseExplorerParams } from '@/lib/explorer';
import {
  getSubject,
  getSubjectTree,
  listExplorerFiles,
  listSubjectClasses,
  listSubjectTags,
  resolveSubjectSelection,
} from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Same rows as the explorer table: honours class/group/topic/tag/q/sort/dir. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  await requireUser();
  const { code } = await params;
  const db = getDb();
  const subject = await getSubject(db, decodeURIComponent(code));
  if (!subject) return new Response('Not found', { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const filters = parseExplorerFilters(sp);
  const [tree, tags, classList] = await Promise.all([
    getSubjectTree(db, subject.id),
    listSubjectTags(db, subject.id),
    listSubjectClasses(db, subject.id),
  ]);
  // Same selection rules as the Files grid (an empty group exports no rows).
  const sel = resolveSubjectSelection(classList, tree, parseExplorerParams(sp));
  const files = await listExplorerFiles(db, subject.id, sel, {
    tagId: tags.some((t) => t.id === filters.tag)
      ? (filters.tag ?? undefined)
      : undefined,
    q: filters.q,
    sort: filters.sort ?? undefined,
    dir: filters.dir ?? undefined,
  });
  const body = toCsv(
    [
      'topic',
      'class',
      'group',
      'file',
      'type',
      'size_bytes',
      'author',
      'added',
    ],
    files.map((f) => [
      f.topicTitle,
      f.className,
      f.groupName,
      f.filename,
      f.previewKind,
      f.sizeBytes,
      f.uploader,
      f.createdAt.toISOString(),
    ]),
  );
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${subject.code.replace(/[^\w.-]/g, '_')}-files.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
