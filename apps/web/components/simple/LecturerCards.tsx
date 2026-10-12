import { ChalkboardTeacher } from '@phosphor-icons/react/dist/ssr';
import type { SubjectLecturer } from '@/lib/queries';

/** "Prowadzący" cards: one per class assignment (name is plain text in simple mode). */
export function LecturerCards({ lecturers }: { lecturers: SubjectLecturer[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 p-0">
      {lecturers.map((l, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: one lecturer can teach several classes
          key={i}
          className="flex gap-3 rounded-lg border border-line-strong bg-panel px-3.5 py-3"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-box-head text-accent-ink">
            <ChalkboardTeacher size={19} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold">
              {[l.title, l.name].filter(Boolean).join(' ')}
            </span>
            <span className="text-[13px] text-muted">
              {l.className} · {l.groupName ?? 'wszystkie grupy'}
            </span>
            {l.email ? (
              <a
                href={`mailto:${l.email}`}
                className="text-[13px] break-all text-accent-ink hover:text-accent-ink-hover hover:underline"
              >
                {l.email}
              </a>
            ) : (
              <span className="text-[13px] text-faint">brak e-maila</span>
            )}
            {(l.officeHours || l.room) && (
              <dl className="m-0 mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 text-[13px]">
                {l.officeHours && (
                  <>
                    <dt className="text-faint">Konsultacje</dt>
                    <dd className="m-0 break-words whitespace-pre-line">
                      {l.officeHours}
                    </dd>
                  </>
                )}
                {l.room && (
                  <>
                    <dt className="text-faint">Pokój</dt>
                    <dd className="m-0 break-words">{l.room}</dd>
                  </>
                )}
              </dl>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
