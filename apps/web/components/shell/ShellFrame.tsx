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
  const columnRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const restoreFocusRef = useRef(false);

  const close = useCallback((restoreFocus: boolean) => {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
  }, []);

  // Focus goes back to the menu button only after the close has rendered:
  // until then the main column (and the button) is still inert.
  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    menuRef.current?.focus();
  }, [open]);

  // A new route always starts with the drawer closed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change
  useEffect(() => setOpen(false), [pathname]);

  // The drawer only exists below 768px: widening the window closes it
  // (otherwise the inert main column would stay unusable on desktop).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Width of the user block, so ScreenHeader's crumbs ellipsize before it.
  useEffect(() => {
    const end = endRef.current;
    const col = columnRef.current;
    if (!end || !col) return;
    const ro = new ResizeObserver(() => {
      col.style.setProperty('--topbar-end-w', `${end.offsetWidth + 16}px`);
    });
    ro.observe(end);
    return () => ro.disconnect();
  }, []);

  // Modal drawer: focus moves in, Tab cycles inside, Escape closes. The main
  // column is `inert` meanwhile, so nothing behind the drawer is reachable.
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!open || !drawer) return;
    const focusables = () =>
      Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'input, a[href], button:not([disabled])',
        ),
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close(true);
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || !drawer.contains(cur))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (cur === last || !drawer.contains(cur))) {
        e.preventDefault();
        first.focus();
      }
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
      <div
        aria-hidden="true"
        onClick={() => close(true)}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-150 motion-reduce:transition-none md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-modal is only set together with role="dialog" (drawer open) */}
      <aside
        ref={drawerRef}
        id="shell-nav"
        aria-label="Panel nawigacji"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        className={`flex min-h-0 flex-col border-r border-line-strong bg-surface max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[264px] max-md:max-w-[85vw] max-md:duration-150 motion-reduce:transition-none ${
          open
            ? // visibility flips at once on open (so focus can move in) ...
              'max-md:translate-x-0 max-md:transition-[translate]'
            : // ... and only after the slide on close
              'max-md:invisible max-md:-translate-x-full max-md:transition-[translate,visibility]'
        }`}
      >
        {nav}
      </aside>

      <div
        ref={columnRef}
        inert={open}
        className="relative flex min-h-0 min-w-0 flex-col [--topbar-end-w:220px] max-md:[--topbar-end-w:72px]"
      >
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
          <div
            ref={endRef}
            className="relative z-[2] flex items-center gap-2 bg-bar pl-2 text-muted"
          >
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
