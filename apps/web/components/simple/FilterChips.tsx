import Link from 'next/link';

export type Chip = { label: string; href: string; active: boolean };
export type ChipRow = { label: string; chips: Chip[] };

/**
 * Subject chip panel (Class / Group / Type): every chip is a link to the
 * filtered URL; the active one is filled. Label column beside the chips from
 * sm up, stacked above them on phones.
 */
export function FilterChips({ rows }: { rows: ChipRow[] }) {
  return (
    <div className="grid grid-cols-1 items-center gap-x-4 gap-y-2.5 rounded-lg border border-line bg-bar px-4 py-3.5 sm:grid-cols-[max-content_minmax(0,1fr)]">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <span id={`chips-${r.label}`} className="text-muted max-sm:mt-1">
            {r.label}
          </span>
          <ul
            aria-labelledby={`chips-${r.label}`}
            className="m-0 flex list-none flex-wrap gap-1.5 p-0"
          >
            {r.chips.map((c) => (
              <li key={c.href} className="flex">
                <Link
                  href={c.href}
                  scroll={false}
                  aria-current={c.active ? 'true' : undefined}
                  className={`inline-flex min-h-8 items-center rounded-full border px-3 font-medium transition-colors duration-100 active:translate-y-px motion-reduce:transition-none ${
                    c.active
                      ? 'border-accent-fill bg-accent-fill text-on-accent hover:bg-accent-fill-hover'
                      : 'border-line-strong bg-page text-fg hover:border-accent'
                  }`}
                >
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
