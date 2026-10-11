import type { Icon } from '@phosphor-icons/react';
import { Database, HardDrives } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

export type Crumb = {
  /** Phosphor icon component, e.g. `BookOpenText` from '@phosphor-icons/react/dist/ssr'. */
  icon?: Icon;
  /** Grey prefix such as 'Przedmiot:' or 'Widok:'. */
  kind?: string;
  label: string;
  href: string;
};

export type Tab = {
  label: string;
  icon: Icon;
  href: string;
  active: boolean;
  /** File download (e.g. CSV export): a plain `<a download>`, never prefetched. */
  download?: boolean;
};

const BASE_CRUMBS: Crumb[] = [
  { icon: HardDrives, kind: 'Serwer:', label: 'MariaDB', href: '/' },
  {
    icon: Database,
    kind: 'Baza danych:',
    label: 'studies_db',
    href: '/structure',
  },
];

/**
 * Page header inside the app shell: breadcrumbs (drawn into the top bar next
 * to the user block) and the tab strip. Render it first in a page; `crumbs`
 * are the page-specific ones, "Serwer: MariaDB" and "Baza danych: studies_db"
 * are always prepended.
 *
 * Layout contract (components/shell/ShellFrame.tsx): the crumbs are absolutely
 * positioned over the 38px top bar of the main column and end before the
 * user block (ShellFrame measures it into --topbar-end-w); long labels
 * ellipsize. The tab strip cancels the content padding
 * (--content-px / --content-pt) and sticks to the top of the scroll area.
 */
export function ScreenHeader({
  crumbs = [],
  tabs = [],
}: {
  crumbs?: Crumb[];
  tabs?: Tab[];
}) {
  const all = [...BASE_CRUMBS, ...crumbs];
  return (
    <>
      <nav
        aria-label="Ścieżka"
        className="absolute top-0 right-[var(--topbar-end-w,220px)] left-12 z-[1] flex h-[38px] items-center overflow-hidden whitespace-nowrap md:left-4"
      >
        <ol className="flex min-w-0 flex-1 items-center gap-1.5">
          {all.map((c, i) => {
            const I = c.icon;
            return (
              <li
                key={`${c.href}|${c.label}`}
                // Serwer/Baza stay whole, page crumbs shrink and ellipsize; the
                // server crumb is dropped on phones to leave room for the page.
                className={`flex items-center gap-[5px] ${
                  i < BASE_CRUMBS.length ? 'shrink-0' : 'min-w-0'
                } ${i === 0 ? 'max-md:hidden' : ''}`}
              >
                {i > 0 && (
                  <span
                    className={`shrink-0 text-subtle ${i === 1 ? 'max-md:hidden' : ''}`}
                    aria-hidden
                  >
                    »
                  </span>
                )}
                {I && (
                  <I size={14} className="shrink-0 text-muted" aria-hidden />
                )}
                {c.kind && (
                  <span className="shrink-0 text-muted max-md:sr-only">
                    {c.kind}
                  </span>
                )}
                <Link
                  href={c.href}
                  aria-current={i === all.length - 1 ? 'page' : undefined}
                  title={c.label}
                  className="min-w-0 truncate font-semibold text-accent-ink hover:text-accent-ink-hover hover:underline"
                >
                  {c.label}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      {tabs.length > 0 && (
        <nav
          aria-label="Zakładki"
          className="sticky top-[calc(var(--content-pt)*-1)] z-[1] -mx-[var(--content-px)] -mt-[var(--content-pt)] mb-4 flex items-end gap-0.5 overflow-x-auto border-b border-line-strong bg-bar px-4 pt-2 max-md:px-3"
        >
          {tabs.map((t) => {
            const I = t.icon;
            const cls = `-mb-px flex items-center gap-1.5 whitespace-nowrap rounded-t-md border px-[13px] py-[7px] hover:underline ${
              t.active
                ? 'border-line-strong border-b-page bg-page font-semibold text-fg'
                : 'border-transparent text-accent-ink'
            }`;
            return t.download ? (
              <a key={t.href} href={t.href} download className={cls}>
                <I size={15} aria-hidden />
                {t.label}
              </a>
            ) : (
              <Link
                key={t.href}
                href={t.href}
                aria-current={t.active ? 'page' : undefined}
                className={cls}
              >
                <I size={15} aria-hidden />
                {t.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
