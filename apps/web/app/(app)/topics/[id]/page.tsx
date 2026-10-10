import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FilePreview } from '@/components/FilePreview';
import { StatusBadge } from '@/components/StatusBadge';
import { TagBadge } from '@/components/TagBadge';
import { getDb } from '@/lib/db';
import { formatDate, formatSize } from '@/lib/format';
import { getTopicWithMaterials } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function TopicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) notFound();
  const data = await getTopicWithMaterials(getDb(), Number(id));
  if (!data) notFound();
  const { topic, subject, materials, tags } = data;
  const firstPreviewable = materials.find(
    (m) => m.status === 'ready' && m.previewKind !== 'none',
  );
  const btn =
    'rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--accent)]';
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <nav className="text-sm text-[var(--muted)]">
        <Link href="/" className="link">
          Przedmioty
        </Link>{' '}
        /{' '}
        <Link
          href={`/subjects/${encodeURIComponent(subject.code)}`}
          className="link"
        >
          {subject.name}
        </Link>
      </nav>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{topic.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span>Dodano {formatDate(topic.createdAt)}</span>
          {tags.map((t) => (
            <TagBadge key={t.id} name={t.name} />
          ))}
        </p>
      </header>
      {materials.length === 0 && (
        <p className="text-[var(--muted)]">Brak plików w tym temacie.</p>
      )}
      <ul className="space-y-4">
        {materials.map((m) => (
          <li
            key={m.id}
            className="space-y-3 rounded-lg border border-[var(--border)] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-all font-semibold">{m.originalFilename}</h2>
              {m.status !== 'ready' && <StatusBadge status={m.status} />}
            </div>
            <p className="text-xs text-[var(--muted)]">
              {formatSize(m.sizeBytes)} · {m.uploaderName} ·{' '}
              {formatDate(m.createdAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={`/files/${m.id}/original`} className={btn}>
                Pobierz
              </a>
              {m.discordUrl && (
                <a
                  href={m.discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={btn}
                >
                  Otwórz w Discordzie
                </a>
              )}
            </div>
            {m.status === 'ready' && (
              <FilePreview
                id={m.id}
                kind={m.previewKind}
                filename={m.originalFilename}
                defaultOpen={m.id === firstPreviewable?.id}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
