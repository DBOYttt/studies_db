import Link from 'next/link';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { listSubjectsOverview } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const subjects = await listSubjectsOverview(getDb());
  const semesters = [...new Set(subjects.map((s) => s.semester))].sort();
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <h1 className="text-2xl font-semibold">Przedmioty</h1>
      {subjects.length === 0 && (
        <p className="text-[var(--muted)]">
          Brak przedmiotów. Uruchom synchronizację bota.
        </p>
      )}
      {semesters.map((sem) => (
        <section key={sem} className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--muted)]">
            Semestr {sem}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects
              .filter((s) => s.semester === sem)
              .map((s) => (
                <Link
                  key={s.code}
                  href={`/subjects/${encodeURIComponent(s.code)}`}
                  className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--accent)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{s.name}</h3>
                    <span className="shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                      {s.ects} ECTS
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)]">{s.code}</p>
                  {s.lecturers.length > 0 && (
                    <p className="text-sm text-[var(--muted)]">
                      {[...new Set(s.lecturers.map((l) => l.name))].join(', ')}
                    </p>
                  )}
                  <p className="mt-auto pt-2 text-sm">
                    {s.materialCount}{' '}
                    {s.materialCount === 1 ? 'plik' : 'plików'}
                    {s.lastUploadAt && (
                      <span className="text-[var(--muted)]">
                        {' '}
                        · ostatnio {formatDate(s.lastUploadAt)}
                      </span>
                    )}
                  </p>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
