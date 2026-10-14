import {
  BookOpenText,
  CalendarBlank,
  ChartBar,
  ClockCounterClockwise,
  Database,
  House,
  MagnifyingGlass,
  ShieldCheck,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export type SimpleScreen =
  | 'home'
  | 'plan'
  | 'recent'
  | 'reports'
  | 'search'
  | 'subject';

export type SimpleActive = { screen: SimpleScreen; code?: string; q?: string };

export type NavSubject = { code: string; name: string; count: number };

const NAV: {
  screen: SimpleScreen;
  href: string;
  label: string;
  icon: ReactNode;
}[] = [
  { screen: 'home', href: '/s', label: 'Start', icon: <House size={18} /> },
  {
    screen: 'plan',
    href: '/s/plan',
    label: 'Plan zajęć',
    icon: <CalendarBlank size={18} />,
  },
  {
    screen: 'recent',
    href: '/s/recent',
    label: 'Ostatnio dodane',
    icon: <ClockCounterClockwise size={18} />,
  },
  {
    screen: 'reports',
    href: '/s/reports',
    label: 'Gotowe zestawienia',
    icon: <ChartBar size={18} />,
  },
];

const row =
  'flex min-h-[38px] items-center gap-2.5 rounded-md px-2.5 transition-colors duration-100';
const idle = 'hover:bg-line';
const on = 'bg-selected font-semibold text-fg';

/** Simple-mode sidebar (design: 248px, logo, search, nav, PRZEDMIOTY list). */
export function SimpleSidebar({
  subjects,
  active,
  isAdmin = false,
}: {
  subjects: NavSubject[];
  active: SimpleActive;
  /** Shows "Panel admina" (switches to the advanced mode at /admin). */
  isAdmin?: boolean;
}) {
  return (
    <>
      <Link
        href="/s"
        className="flex shrink-0 items-center gap-1.5 px-4 pt-4 pb-3"
        aria-label="StudiesDB TP 4.0, Start"
      >
        <Database
          size={20}
          weight="fill"
          className="text-accent-ink"
          aria-hidden
        />
        <span className="text-[17px] font-bold tracking-[-0.02em] text-fg">
          Studies<span className="text-accent-ink">DB</span>
        </span>
        <span className="font-mono text-[11px] text-muted">TP 4.0</span>
      </Link>

      <search className="shrink-0 px-3 pb-3">
        <form action="/s/search" method="get">
          <label className="flex h-[38px] items-center gap-2 rounded-md border border-line-strong bg-page px-2.5 focus-within:border-accent">
            <MagnifyingGlass
              size={16}
              className="shrink-0 text-faint"
              aria-hidden
            />
            <input
              key={active.q ?? ''}
              type="search"
              name="q"
              defaultValue={active.q ?? ''}
              placeholder="Szukaj plików i tematów"
              aria-label="Szukaj plików i tematów"
              maxLength={200}
              className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-none placeholder:text-faint"
            />
          </label>
        </form>
      </search>

      <nav
        aria-label="Menu"
        className="flex shrink-0 flex-col gap-0.5 px-2 pb-3"
      >
        {NAV.map((n) => {
          const cur = active.screen === n.screen;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={cur ? 'page' : undefined}
              className={`${row} ${cur ? on : `font-medium text-accent-ink ${idle}`}`}
            >
              <span aria-hidden className="grid">
                {n.icon}
              </span>
              {n.label}
            </Link>
          );
        })}
        {isAdmin && (
          // The admin pages live in the advanced shell: switch the mode
          // cookie too, so "/" does not bounce back to /s afterwards.
          <a
            href="/mode?to=advanced&next=%2Fadmin"
            className={`${row} font-medium text-accent-ink ${idle}`}
          >
            <span aria-hidden className="grid">
              <ShieldCheck size={18} />
            </span>
            Panel admina
          </a>
        )}
      </nav>

      <h2 className="m-0 shrink-0 border-t border-line px-[18px] pt-3.5 pb-1.5 text-xs font-semibold tracking-[0.04em] text-muted uppercase">
        Przedmioty
      </h2>
      <nav
        aria-label="Przedmioty"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
      >
        {subjects.map((s) => {
          const cur = active.screen === 'subject' && active.code === s.code;
          return (
            <Link
              key={s.code}
              href={`/s/subjects/${encodeURIComponent(s.code)}`}
              aria-current={cur ? 'page' : undefined}
              className={`${row} py-1.5 ${cur ? on : `text-fg ${idle}`}`}
            >
              <BookOpenText
                size={17}
                className="shrink-0 text-accent-ink"
                aria-hidden
              />
              <span className="min-w-0 flex-1 leading-snug">{s.name}</span>
              <span className="text-xs font-normal text-faint tabular-nums">
                <span className="sr-only">plików: </span>
                {s.count}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
