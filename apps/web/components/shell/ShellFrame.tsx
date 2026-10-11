'use client';

import { List } from '@phosphor-icons/react';
import { usePathname } from 'next/navigation';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * Outer grid of the app (design: 264px navigation panel + main column).
 * Below 768px the navigation panel is an off-canvas drawer opened from the
 * top bar's menu button; Escape, the backdrop and following a link close it.
 *
 * Layers: page content 0, ScreenHeader crumbs/tabs 1, top-bar controls 2,
 * drawer backdrop 40, drawer 50 (the mobile preview panel uses 40 as well,
 * but the drawer is closed whenever a link is followed).
 */
export function ShellFrame({
  nav,
  topbarEnd,
  footer,
  children,
}: {
  nav: ReactNode;
  topbarEnd: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) menuRef.current?.focus();
  }, []);

  // A new route always starts with the drawer closed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const first = drawerRef.current?.querySelector<HTMLElement>(
      'input, a[href], button:not([disabled])',
    );
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Following a link inside the drawer closes it (also for same-URL links).
  useEffect(() => {
    const el = drawerRef.current;
    if (!open || !el) return;
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element).closest('a[href]')) close(false);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [open, close]);

  return (
    <div className="grid h-[100dvh] grid-cols-[minmax(0,1fr)] overflow-hidden md:grid-cols-[264px_minmax(0,1fr)]">
      {open && (
        <div
          aria-hidden="true"
          onClick={() => close(true)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}
      <aside
        ref={drawerRef}
        id="shell-nav"
        aria-label="Panel nawigacji"
        className={`flex min-h-0 flex-col border-r border-line-strong bg-surface max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[264px] max-md:max-w-[85vw] max-md:transition-transform max-md:duration-150 motion-reduce:transition-none ${
          open
            ? 'max-md:translate-x-0'
            : 'max-md:invisible max-md:-translate-x-full'
        }`}
      >
        {nav}
      </aside>

      <div className="relative flex min-h-0 min-w-0 flex-col">
        <header className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-bar px-4 max-md:px-2">
          <button
            ref={menuRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Otwórz panel nawigacji"
            aria-expanded={open}
            aria-controls="shell-nav"
            className="relative z-[2] grid h-[26px] w-[28px] place-items-center rounded text-accent-ink hover:bg-line md:hidden"
          >
            <List size={18} />
          </button>
          <div className="flex-1" />
          <div className="relative z-[2] flex items-center gap-2 bg-bar pl-2 text-muted">
            {topbarEnd}
          </div>
        </header>
        <main
          id="content"
          className="min-h-0 flex-1 overflow-auto px-[var(--content-px)] pt-[var(--content-pt)] pb-7 [--content-pt:16px] [--content-px:12px] md:[--content-px:18px]"
        >
          {children}
        </main>
        {footer}
      </div>
    </div>
  );
}
