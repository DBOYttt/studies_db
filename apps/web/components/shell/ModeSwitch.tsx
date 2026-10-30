'use client';

import { Code, ListBullets } from '@phosphor-icons/react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useLayoutEffect, useRef } from 'react';
import type { UiMode } from '@/lib/mode';

/**
 * The link's `next` is the URL at hydration (Next reads `window.location`),
 * which can differ from the URL the server rendered: a Back to a pushState
 * entry of the same document before the JS has run changes the URL under
 * the old HTML (chaos F3). React keeps a server attribute that differs at
 * hydration, so the href is written once more after hydration; the warning is
 * expected here and silenced for this element only.
 */
function ModeLink({
  href,
  title,
  cls,
  children,
}: {
  href: string;
  title?: string;
  cls: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useLayoutEffect(() => {
    const a = ref.current;
    if (a && a.getAttribute('href') !== href) a.setAttribute('href', href);
  }, [href]);
  return (
    <a
      ref={ref}
      href={href}
      title={title}
      className={cls}
      suppressHydrationWarning
    >
      {children}
    </a>
  );
}

function Segments({ mode }: { mode: UiMode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const next = encodeURIComponent(search ? `${pathname}?${search}` : pathname);
  const base =
    'flex items-center gap-1 rounded px-2 py-0.5 text-[12px] font-medium max-md:px-1.5 max-md:text-[11px] max-sm:min-h-11';
  const item = (
    to: UiMode,
    label: string,
    icon: React.ReactNode,
    title?: string,
  ) => {
    const active = mode === to;
    const cls = `${base} ${
      active
        ? 'bg-accent-fill text-on-accent'
        : 'text-accent-ink hover:bg-list-hover'
    }`;
    if (active)
      return (
        <span aria-current="true" title={title} className={cls}>
          {icon}
          {label}
        </span>
      );
    return (
      <ModeLink href={`/mode?to=${to}&next=${next}`} title={title} cls={cls}>
        {icon}
        {label}
      </ModeLink>
    );
  };
  return (
    <nav
      aria-label="View mode"
      className="flex items-center gap-0.5 rounded-md border border-line p-0.5 max-sm:p-0"
    >
      {item(
        'simple',
        'Simple',
        <ListBullets aria-hidden className="max-[380px]:hidden" />,
        'Lists of subjects, files and the timetable',
      )}
      {item(
        'advanced',
        'Advanced',
        <Code aria-hidden className="max-[380px]:hidden" />,
        'Show SQL, views and the database structure',
      )}
    </nav>
  );
}

export function ModeSwitch({ mode }: { mode: UiMode }) {
  return (
    <Suspense fallback={null}>
      <Segments mode={mode} />
    </Suspense>
  );
}
