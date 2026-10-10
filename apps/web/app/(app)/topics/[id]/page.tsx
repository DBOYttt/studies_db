import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { explorerHref } from '@/lib/explorer';
import { getTopicSubjectCode } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Topics live in the subject explorer now; keep the old URL working. */
export default async function TopicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  if (!/^[1-9]\d{0,8}$/.test(id)) notFound();
  const code = await getTopicSubjectCode(getDb(), Number(id));
  if (!code) notFound();
  redirect(explorerHref(code, { topic: Number(id) }));
}
