import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataGrid } from '@/components/DataGrid';
import { TagBadge } from '@/components/TagBadge';
import { getDb } from '@/lib/db';
import { formatDate, ROLE_LABELS } from '@/lib/format';
import { getSubject, listSubjectTags, listTopics } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  await requireUser();
  const { code } = await params;
  const { tag } = await searchParams;
  const db = getDb();
  const subject = await getSubject(db, decodeURIComponent(code));
  if (!subject) notFound();
  const tagId = /^\d{1,9}$/.test(tag ?? '') ? Number(tag) : undefined;
  const [tags, topics] = await Promise.all([
    listSubjectTags(db, subject.id),
    listTopics(db, subject.id, { tagId }),
  ]);
  const byRole = new Map<string, string[]>();
  for (const l of subject.lecturers) {
    const list = byRole.get(l.role) ?? [];
    list.push([l.title, l.name].filter(Boolean).join(' '));
    byRole.set(l.role, list);
  }
  const base = `/subjects/${encodeURIComponent(subject.code)}`;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <nav className="text-sm text-[var(--muted)]">
        <Link href="/" className="link">
          Przedmioty
        </Link>{' '}
        / {subject.name}
      </nav>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{subject.name}</h1>
        <p className="text-sm text-[var(--muted)]">
          {subject.code} · semestr {subject.semester} · {subject.ects} ECTS
        </p>
        {subject.description && (
          <p className="max-w-3xl">{subject.description}</p>
        )}
        {byRole.size > 0 && (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            {[...byRole].map(([role, names]) => (
              <div key={role} className="contents">
                <dt className="text-[var(--muted)]">
                  {ROLE_LABELS[role] ?? role}
                </dt>
                <dd>{names.join(', ')}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--muted)]">Tag:</span>
          <Link href={base} className={tagId ? 'link' : 'font-semibold'}>
            Wszystkie
          </Link>
          {tags.map((t) => (
            <Link
              key={t.id}
              href={`${base}?tag=${t.id}`}
              className={t.id === tagId ? 'font-semibold' : ''}
            >
              <TagBadge name={t.name} />
            </Link>
          ))}
        </div>
      )}
      <DataGrid
        columns={['Temat', 'Tagi', 'Pliki', 'Autor', 'Dodano']}
        empty="Brak tematów."
        rows={topics.map((t) => [
          { text: t.title, href: `/topics/${t.id}` },
          { text: t.tags.map((x) => x.name).join(', '), badges: t.tags },
          t.fileCount,
          t.author ?? '—',
          { text: formatDate(t.createdAt), sort: t.createdAt.toISOString() },
        ])}
      />
    </div>
  );
}
