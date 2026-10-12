import { Books, Exam, Medal } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { EXAMPLE_QUERIES } from '@/lib/example-queries';
import { REPORT_META } from '@/lib/simple';

const ICONS = { Books, Medal, Exam };

/** Gotowe zestawienia: one card per ready-made report, `selected` tinted. */
export function ReportCards({ selected }: { selected: number }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 p-0">
      {EXAMPLE_QUERIES.map((q, i) => {
        const meta = REPORT_META[i];
        const Icon = ICONS[meta.icon];
        const on = i === selected;
        return (
          <li key={q.name} className="flex">
            <Link
              href={`/s/reports?r=${i}`}
              aria-current={on ? 'true' : undefined}
              scroll={false}
              className={`flex flex-1 gap-3 rounded-lg border px-4 py-3.5 transition-[border-color,box-shadow] duration-150 hover:border-accent active:translate-y-px motion-reduce:transition-none ${
                on ? 'border-accent bg-selected' : 'border-line-strong bg-panel'
              }`}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-box-head text-accent-ink">
                <Icon size={19} aria-hidden />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-fg">{q.name}</span>
                <span className="text-pretty text-[13px] text-muted">
                  {meta.desc}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
