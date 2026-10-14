'use client';

import { List, SignOut } from '@phosphor-icons/react';
import { usePathname } from 'next/navigation';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ModeSwitch } from '@/components/shell/ModeSwitch';
import type { SessionUser } from '@/lib/session';
import { type Crumb, Crumbs } from './Crumbs';
import {
  type NavSubject,
  type SimpleActive,
  SimpleSidebar,
} from './SimpleSidebar';

export type { Crumb } from './Crumbs';
export type { NavSubject, SimpleActive } from './SimpleSidebar';

/**
 * Simple (Prosty) shell: 248px sidebar + 48px top bar + content, and an
 * optional `aside` (the preview panel) to the right of the content.
 * Below 768px the sidebar is an off-canvas drawer (same behaviour as the
 * advanced ShellFrame): Escape, the backdrop and following a link close it.
 *
 * Layers: preview sheet 40 (phones), drawer backdrop 40, drawer 50.
 */
export function SimpleShell({
  subjects,
  active,
  crumbs,
  user,
  aside,
  children,
}: {
  subjects: NavSubject[];
  active: SimpleActive;
  crumbs: Crumb[];
  user: SessionUser;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const pathname = usePathname();

  const close = useCallback((restoreFocus: boolean) => {
    restoreFocusRef.current = restoreFocus;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    menuRef.current?.focus();
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
        e.preventDefault(); // keeps an open preview panel from closing too
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
    window.addEventListener('keydown', onKey, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, close]);

  useEffect(() => {
    const el = drawerRef.current;
    if (!open || !el) return;
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element).closest('a[href]')) close(false);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [open, close]);

  const initial = ([...user.displayName.trim()][0] ?? '?').toLocaleUpperCase(
    'pl',
  );

  return (
    <div className="grid h-[100dvh] grid-cols-[minmax(0,1fr)] overflow-hidden text-[14px] md:grid-cols-[248px_minmax(0,1fr)]">
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
        id="simple-nav"
        aria-label="Panel nawigacji"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        className={`flex min-h-0 flex-col border-r border-line-strong bg-surface max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[280px] max-md:max-w-[85vw] max-md:duration-150 motion-reduce:transition-none ${
          open
            ? 'max-md:translate-x-0 max-md:transition-[translate]'
            : 'max-md:invisible max-md:-translate-x-full max-md:transition-[translate,visibility]'
        }`}
      >
        <SimpleSidebar
          subjects={subjects}
          active={active}
          isAdmin={user.isAdmin}
        />
      </aside>

      <div inert={open} className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-strong bg-bar px-5 max-md:gap-2 max-md:px-2">
          <button
            ref={menuRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Otwórz panel nawigacji"
            aria-expanded={open}
            aria-controls="simple-nav"
            className="grid size-8 shrink-0 place-items-center rounded-md text-accent-ink hover:bg-line md:hidden"
          >
            <List size={20} />
          </button>
          <Crumbs crumbs={crumbs} />
          <div className="flex shrink-0 items-center gap-2 text-[13px] text-muted">
            <ModeSwitch mode="simple" />
            {user.avatarUrl ? (
              // biome-ignore lint/performance/noImgElement: external Discord CDN avatar
              <img
                src={user.avatarUrl}
                alt=""
                width={24}
                height={24}
                className="ml-1 size-6 rounded-full"
              />
            ) : (
              <span
                aria-hidden
                className="ml-1 grid size-6 place-items-center rounded-full bg-discord text-[11px] font-semibold text-white"
              >
                {initial}
              </span>
            )}
            <span className="max-w-[160px] truncate text-fg max-lg:sr-only">
              {user.displayName}
            </span>
            <span className="text-subtle max-lg:hidden" aria-hidden>
              |
            </span>
            <form action="/auth/logout" method="post" className="flex">
              <button
                type="submit"
                className="flex items-center gap-1 rounded px-0.5 text-accent-ink hover:text-accent-ink-hover hover:underline"
              >
                <SignOut size={15} aria-hidden />
                <span className="max-lg:sr-only">Wyloguj</span>
              </button>
            </form>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <main
            id="content"
            className="min-w-0 flex-1 overflow-y-auto px-7 pt-6 pb-10 max-md:px-4 max-md:pt-5"
          >
            <div className="grid max-w-[1080px] grid-cols-[minmax(0,1fr)] gap-4">
              {children}
            </div>
          </main>
          {aside}
        </div>
      </div>
    </div>
  );
}
