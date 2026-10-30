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
 * Busy placeholder: `aria-busy` on the blocks' container, and a separate
 * polite status (outside it, so busy does not hold it back) saying
 * "Loading…". It is visually hidden and positioned out of the layout flow.
 * The blocks are aria-hidden and the wrappers carry no text.
 */
export function SkeletonRegion({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      <span role="status" className="sr-only">
        Loading…
      </span>
      <div aria-busy="true" className={className}>
        {children}
      </div>
    </>
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
