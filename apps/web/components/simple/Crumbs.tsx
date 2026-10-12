import Link from 'next/link';

export type Crumb = { label: string; href?: string };

/** Top-bar breadcrumbs (Start › subject › class › group); the last one is the current page. */
export function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Ścieżka" className="min-w-0 flex-1">
      <ol className="m-0 flex min-w-0 list-none items-center gap-2 overflow-hidden p-0 whitespace-nowrap">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: crumbs are positional
              key={i}
              className={`flex items-center gap-2 ${last ? 'min-w-0' : 'shrink-0'}`}
            >
              {i > 0 && (
                <span aria-hidden className="text-subtle">
                  ›
                </span>
              )}
              {c.href && !last ? (
                <Link
                  href={c.href}
                  className="text-accent-ink hover:text-accent-ink-hover hover:underline"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={`truncate ${last ? 'font-semibold text-fg' : 'text-muted'}`}
                >
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
