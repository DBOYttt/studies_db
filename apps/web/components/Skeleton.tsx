import type { ReactNode } from 'react';

/**
 * Loading placeholders: neutral blocks in the border colour, no spinner. The
 * soft pulse runs only without prefers-reduced-motion. Fetches nothing, so a
 * loading.tsx can render it before the page's own gates run.
 */
export function Bone({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block rounded bg-line motion-safe:animate-pulse ${className}`}
    />
  );
}

/**
 * Busy region (role=status is polite): screen readers hear one "Loading…";
 * the blocks are aria-hidden and the wrappers carry no text.
 */
export function SkeletonRegion({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

/** Week timetable placeholder: week nav plus a five-day grid. */
export function PlanWeekSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Bone className="h-7 w-24" />
        <Bone className="h-7 w-40" />
        <Bone className="h-7 w-24" />
      </div>
      <div className="grid grid-cols-5 gap-px overflow-hidden rounded-md border border-line-strong bg-line max-md:grid-cols-1">
        {[0, 1, 2, 3, 4].map((d) => (
          <div key={d} className="flex flex-col gap-2 bg-panel p-2.5">
            <Bone className="h-4 w-16" />
            <Bone className="h-14 w-full" />
            {d % 2 === 0 && <Bone className="h-14 w-full" />}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * Advanced content pane while a page loads (the layout draws the shell
 * around it): screen header tabs, a title and a result grid.
 */
export function AppPaneSkeleton() {
  return (
    <SkeletonRegion className="flex flex-col gap-3.5">
      <div className="-mx-[var(--content-px)] -mt-[var(--content-pt)] mb-0.5 flex h-[37px] items-end gap-2 border-b border-line-strong bg-bar px-4 pb-1.5">
        <Bone className="h-4 w-20" />
        <Bone className="h-4 w-20" />
        <Bone className="h-4 w-16" />
      </div>
      <Bone className="h-7 w-56" />
      <div className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line-strong bg-panel">
        <div className="bg-box-head px-3 py-2">
          <Bone className="h-4 w-1/3" />
        </div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-4 px-3 py-2">
            <Bone className="h-4 w-12" />
            <Bone className="h-4 flex-1" />
            <Bone className="h-4 w-24 max-md:hidden" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * Simple view while a page loads. Each simple page renders its own
 * SimpleShell, so this draws the same frame (sidebar, top bar, content) with
 * neutral blocks; it knows no user and no subjects.
 */
export function SimplePageSkeleton() {
  return (
    <div className="grid h-[100dvh] grid-cols-[minmax(0,1fr)] overflow-hidden text-[14px] md:grid-cols-[248px_minmax(0,1fr)]">
      <div
        aria-hidden
        className="flex flex-col gap-3 border-r border-line-strong bg-surface p-4 max-md:hidden"
      >
        <Bone className="h-6 w-32" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Bone key={i} className="h-4 w-full" />
        ))}
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div
          aria-hidden
          className="flex h-12 shrink-0 items-center gap-3 border-b border-line-strong bg-bar px-5 max-md:px-2"
        >
          <Bone className="h-4 w-40" />
          <span className="flex-1" />
          <Bone className="h-4 w-24" />
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto px-7 pt-6 pb-10 max-md:px-4 max-md:pt-5">
          <SkeletonRegion className="grid max-w-[1080px] grid-cols-[minmax(0,1fr)] gap-4">
            <Bone className="h-7 w-48" />
            <Bone className="h-4 w-80 max-w-full" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-md border border-line-strong bg-panel p-3.5"
                >
                  <Bone className="h-4 w-2/3" />
                  <Bone className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          </SkeletonRegion>
        </main>
      </div>
    </div>
  );
}
