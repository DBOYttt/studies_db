import { Files } from '@phosphor-icons/react/dist/ssr';
import { CLASS_NAMES } from '@studies/db/constants';
import Link from 'next/link';
import { formatDate, pluralPl } from '@/lib/format';
import type { SubjectCard } from '@/lib/simple-queries';

/** Start page grid: one card per subject (auto-fill, min 240px). */
export function SubjectCards({ cards }: { cards: SubjectCard[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 p-0">
      {cards.map((c) => (
        <li key={c.id} className="flex">
          <Link
            href={`/s/subjects/${encodeURIComponent(c.code)}`}
            className="group flex flex-1 flex-col gap-2.5 rounded-lg border border-line-strong bg-panel px-4 py-3.5 transition-[border-color,box-shadow] duration-150 hover:border-accent hover:shadow-[0_1px_3px_rgb(24_24_27/0.08)] active:translate-y-px motion-reduce:transition-none"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="rounded bg-box-head px-1.5 py-0.5 font-mono text-xs font-semibold text-accent-ink">
                {c.code}
              </span>
              <span className="text-xs text-faint">
                Semestr {c.semester} · {c.ects} ECTS
              </span>
            </div>
            <div className="text-base leading-[1.3] font-semibold text-fg">
              {c.name}
            </div>
            {c.kinds.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {c.kinds.map((k) => (
                  <li
                    key={k}
                    className="rounded-full border border-line px-2 py-px text-xs text-muted"
                  >
                    {CLASS_NAMES[k]}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto flex justify-between gap-2 border-t border-line pt-2.5 text-[13px] text-muted">
              <span className="flex items-center gap-1.5">
                <Files size={15} aria-hidden />
                {c.fileCount} {pluralPl(c.fileCount, 'plik', 'pliki', 'plików')}
              </span>
              <span>
                {c.lastUpload
                  ? `ostatnio ${formatDate(c.lastUpload)}`
                  : 'brak plików'}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
