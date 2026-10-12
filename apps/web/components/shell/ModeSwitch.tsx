'use client';

import { Sparkle, TerminalWindow } from '@phosphor-icons/react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import type { UiMode } from '@/lib/mode';

function Segments({ mode }: { mode: UiMode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const next = encodeURIComponent(search ? `${pathname}?${search}` : pathname);
  const base =
    'flex items-center gap-1 rounded px-2 py-0.5 text-[12px] font-medium';
  const item = (
    to: UiMode,
    label: string,
    icon: React.ReactNode,
    title?: string,
  ) => {
    const active = mode === to;
    return (
      <a
        href={`/mode?to=${to}&next=${next}`}
        aria-current={active ? 'true' : undefined}
        title={title}
        className={`${base} ${
          active
            ? 'bg-accent-fill text-on-accent'
            : 'text-accent-ink hover:bg-list-hover'
        }`}
      >
        {icon}
        <span className="max-md:sr-only">{label}</span>
      </a>
    );
  };
  return (
    <nav
      aria-label="Tryb widoku"
      className="flex items-center gap-0.5 rounded-md border border-line p-0.5"
    >
      {item('simple', 'Prosty', <Sparkle aria-hidden />)}
      {item(
        'advanced',
        'Zaawansowany',
        <TerminalWindow aria-hidden />,
        'Pokaż SQL, widoki i strukturę bazy',
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
