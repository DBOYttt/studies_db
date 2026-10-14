'use client';

import { ShieldCheck } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { toolBtn } from './tool-button';

/**
 * Toolbar entry of the admin panel. Its own client module, rendered only by
 * the server layout for admins, so other users' bundles never contain it.
 */
export function AdminNavLink() {
  return (
    <Suspense fallback={<AdminNavLinkBody active={false} />}>
      <LocatedAdminNavLink />
    </Suspense>
  );
}

function LocatedAdminNavLink() {
  const pathname = usePathname();
  return (
    <AdminNavLinkBody
      active={pathname === '/admin' || pathname.startsWith('/admin/')}
    />
  );
}

function AdminNavLinkBody({ active }: { active: boolean }) {
  return (
    <Link
      href="/admin"
      title="Admin"
      aria-label="Admin"
      aria-current={active ? 'page' : undefined}
      className={`${toolBtn} ${active ? 'bg-selected text-fg' : ''}`}
    >
      <ShieldCheck size={16} weight={active ? 'fill' : 'regular'} />
    </Link>
  );
}
