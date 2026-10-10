import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/session';

const NAV = [
  { href: '/', label: 'Przedmioty' },
  { href: '/search', label: 'Szukaj' },
  { href: '/tables/v_subjects', label: 'Tabele' },
  { href: '/sql', label: 'SQL' },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-panel px-4 py-3 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Studies DB{' '}
          <span className="font-mono text-xs text-muted">TP 4.0</span>
        </Link>
        <nav className="flex flex-1 gap-1 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-lg px-2.5 py-1.5 text-muted hover:bg-surface hover:text-fg"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          {user.avatarUrl && (
            // biome-ignore lint/performance/noImgElement: external Discord CDN avatar
            <img
              src={user.avatarUrl}
              alt=""
              width={28}
              height={28}
              className="rounded-full"
            />
          )}
          <span>{user.displayName}</span>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-muted hover:bg-surface hover:text-fg"
            >
              Wyloguj
            </button>
          </form>
        </div>
      </header>
      <main className="p-4 sm:p-6">{children}</main>
    </>
  );
}
