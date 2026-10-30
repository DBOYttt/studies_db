import {
  ArrowRight,
  CalendarBlank,
  Database,
  House,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { currentMode } from '@/lib/mode';

export const metadata: Metadata = { title: 'Page not found | Studies DB' };

/**
 * The one 404 page, for unknown addresses and for every notFound() (a
 * missing subject, a deleted event, /admin for a non-admin). It is the same
 * page in every case and names nothing, so it never tells a resource that
 * exists but is hidden apart from one that doesn't. It sits outside the app
 * shell for the same reason (an (app)-level not-found would only show for
 * routes that exist). The links follow the mode cookie.
 */
export default async function NotFound() {
  const simple = (await currentMode()) === 'simple';
  const start = simple ? '/s' : '/';
  const timetable = simple ? '/s/plan' : '/plan';
  return (
    <div className="flex min-h-[100dvh] flex-col bg-page text-fg">
      <header className="flex h-12 shrink-0 items-center border-b border-line-strong bg-bar px-5 max-md:px-4">
        <Link
          href={start}
          aria-label="StudiesDB TP 4.0, Start"
          className="flex items-center gap-1.5 rounded"
        >
          <Database
            size={20}
            weight="fill"
            aria-hidden
            className="text-accent-ink"
          />
          <span className="text-[17px] font-bold tracking-[-0.02em]">
            Studies<span className="text-accent-ink">DB</span>
          </span>
          <span className="font-mono text-[11px] text-muted">TP 4.0</span>
        </Link>
      </header>
      <main className="flex flex-1 px-5 py-16 max-md:px-4 max-md:py-10">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
          <p className="m-0 font-mono text-xs tracking-[0.08em] text-muted">
            Error 404
          </p>
          <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-[-0.02em] text-balance">
            Page not found
          </h1>
          <p className="m-0 max-w-[60ch] text-pretty text-muted">
            This page doesn't exist or is no longer available. The address may
            be mistyped, or what it showed was removed.
          </p>
          <nav aria-label="Where to go" className="mt-2 flex flex-wrap gap-2">
            <Link
              href={start}
              className="inline-flex min-h-9 items-center gap-1.5 rounded bg-accent-fill px-3.5 font-semibold text-on-accent hover:bg-accent-fill-hover active:translate-y-px"
            >
              <House size={16} aria-hidden />
              Start
            </Link>
            <Link
              href={timetable}
              className="inline-flex min-h-9 items-center gap-1.5 rounded border border-line-strong bg-panel px-3.5 text-accent-ink hover:border-accent active:translate-y-px"
            >
              <CalendarBlank size={16} aria-hidden />
              Timetable
              <ArrowRight size={14} aria-hidden className="text-muted" />
            </Link>
          </nav>
        </div>
      </main>
    </div>
  );
}
