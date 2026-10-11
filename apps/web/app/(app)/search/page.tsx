import { searchAll } from '@studies/db';
import Link from 'next/link';
import { Highlight } from '@/components/Highlight';
import { getDb } from '@/lib/db';
import { listAllTags, listSubjectOptions } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const posInt = (v: string | undefined) =>
  /^[1-9]\d{0,9}$/.test(v ?? '') ? Number(v) : undefined;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; subject?: string; tag?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? '').slice(0, 200).trim();
  const subjectId = posInt(sp.subject);
  const tagId = posInt(sp.tag);
  const db = getDb();
  const [subjects, tags, hits] = await Promise.all([
    listSubjectOptions(db),
    listAllTags(db),
    q ? searchAll(db, { q, subjectId, tagId }) : Promise.resolve([]),
  ]);
  const field =
    'rounded border border-[var(--border)] bg-transparent px-3 py-2 text-sm';
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Szukaj</h1>
      <form method="get" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Szukaj w materiałach i tematach…"
          aria-label="Szukana fraza"
          className={`${field} min-w-0 flex-1 basis-64`}
        />
        <select
          name="subject"
          defaultValue={subjectId ?? ''}
          aria-label="Przedmiot"
          className={field}
        >
          <option value="">Wszystkie przedmioty</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          name="tag"
          defaultValue={tagId ?? ''}
          aria-label="Tag"
          className={field}
        >
          <option value="">Wszystkie tagi</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.subjectCode})
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded bg-accent-fill px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-fill-hover"
        >
          Szukaj
        </button>
      </form>
      {q && hits.length === 0 && (
        <p className="text-[var(--muted)]">Brak wyników dla „{q}”.</p>
      )}
      <ul className="space-y-3">
        {hits.map((h) => (
          <li
            key={`${h.topicId}-${h.materialId ?? 't'}`}
            className="rounded-lg border border-[var(--border)] p-4"
          >
            <Link href={`/topics/${h.topicId}`} className="link font-semibold">
              {h.filename ?? h.topicTitle}
            </Link>
            <p className="text-xs text-[var(--muted)]">
              {h.subjectName} ({h.subjectCode}) ·{' '}
              {h.filename ? `temat: ${h.topicTitle}` : 'temat'}
            </p>
            <p className="mt-2 text-sm">
              <Highlight text={h.snippet} />
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
