'use client';

import { Code, ListBullets } from '@phosphor-icons/react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import type { UiMode } from '@/lib/mode';

function Segments({ mode }: { mode: UiMode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const next = encodeURIComponent(search ? `${pathname}?${search}` : pathname);
  const base =
    'flex items-center gap-1 rounded px-2 py-0.5 text-[12px] font-medium max-md:px-1.5 max-md:text-[11px]';
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
      <a href={`/mode?to=${to}&next=${next}`} title={title} className={cls}>
        {icon}
        {label}
      </a>
    );
  };
  return (
    <nav
      aria-label="View mode"
      className="flex items-center gap-0.5 rounded-md border border-line p-0.5"
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
