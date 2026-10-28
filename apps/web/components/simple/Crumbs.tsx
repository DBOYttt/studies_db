import { CaretLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

export type Crumb = { label: string; href?: string };

/**
 * Top-bar breadcrumbs (Start › subject › class › group); the last one is the
 * current page. Below `md` only the current page shows, after a back chevron
 * to the nearest crumb with a link, so it isn't cut to "Add e…".
 */
export function Crumbs({ crumbs }: { crumbs: Crumb[] }) {
  const back = crumbs
    .slice(0, -1)
    .reverse()
    .find((c) => c.href);
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-1"
    >
      {back?.href && (
        <Link
          href={back.href}
          aria-label={`Back to ${back.label}`}
          className="grid size-7 shrink-0 place-items-center rounded-md text-accent-ink hover:bg-line md:hidden"
        >
          <CaretLeft size={16} aria-hidden />
        </Link>
      )}
      <ol className="m-0 flex min-w-0 list-none items-center gap-2 overflow-hidden p-0 whitespace-nowrap">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: crumbs are positional
              key={i}
              className={`flex items-center gap-2 ${last ? 'min-w-0' : 'shrink-0 max-md:hidden'}`}
            >
              {i > 0 && (
                <span aria-hidden className="text-subtle max-md:hidden">
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
