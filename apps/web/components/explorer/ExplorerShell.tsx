import { CaretRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ExplorerTab } from '@/lib/explorer';

export type Crumb = { label: string; href: string };

const TAB_LABELS: { tab: ExplorerTab; label: string }[] = [
  { tab: 'explorer', label: 'Explorer' },
  { tab: 'map', label: 'Mapa danych' },
  { tab: 'schema', label: 'Schemat bazy' },
];

export function ExplorerShell({
  title,
  meta,
  crumbs,
  tab,
  tabHref,
  children,
}: {
  title: string;
  meta: string;
  crumbs: Crumb[];
  tab: ExplorerTab;
  tabHref: (t: ExplorerTab) => string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header className="space-y-3">
        <nav aria-label="Ścieżka" className="text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="rounded-lg hover:text-fg">
                Przedmioty
              </Link>
            </li>
            {crumbs.map((c, i) => (
              <li key={c.href} className="flex items-center gap-1">
                <CaretRight size={12} aria-hidden="true" />
                {i === crumbs.length - 1 ? (
                  <span aria-current="page" className="text-fg">
                    {c.label}
                  </span>
                ) : (
                  <Link href={c.href} className="hover:text-fg">
                    {c.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="font-mono text-xs text-muted">{meta}</p>
          </div>
          <nav
            aria-label="Widok"
            className="flex gap-1 rounded-xl border border-line bg-panel p-1 text-sm"
          >
            {TAB_LABELS.map((t) => (
              <Link
                key={t.tab}
                href={tabHref(t.tab)}
                aria-current={t.tab === tab ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 ${
                  t.tab === tab
                    ? 'bg-accent/10 font-medium text-accent-ink'
                    : 'text-muted hover:text-fg'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
