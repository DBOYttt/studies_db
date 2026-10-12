import type { ReactNode } from 'react';
import { requireUser } from '@/lib/session';

/**
 * Simple (Prosty) view. Outside the (app) group on purpose: no phpMyAdmin
 * nav panel or SQL console. Each page renders its own SimpleShell (it needs
 * the page's crumbs and active item) and calls requireUser() itself too.
 */
export default async function SimpleLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireUser();
  return children;
}
