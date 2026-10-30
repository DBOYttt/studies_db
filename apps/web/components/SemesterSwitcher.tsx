'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, type ReactNode, Suspense, useContext } from 'react';
import { ModeLink } from '@/components/shell/ModeSwitch';
import {
  type Semester,
  semesterFromRequest,
  semesterOptions,
} from '@/lib/semester-pure';

type Ctx = { present: number[]; cookie: string | undefined };

const SemesterContext = createContext<Ctx>({ present: [], cookie: undefined });

/**
 * Hands the semesters that have subjects and the cookie value to the shells'
 * switcher (a layout cannot pass props into a page's shell). Rendered by the
 * two layouts; a full navigation (the /semester redirect) re-renders it.
 */
export function SemesterProvider({
  present,
  current,
  children,
}: {
  present: number[];
  current: Semester | null;
  children: ReactNode;
}) {
  return (
    <SemesterContext.Provider
      value={{
        present,
        cookie: current === null ? undefined : String(current),
      }}
    >
      {children}
    </SemesterContext.Provider>
  );
}

function useOptions() {
  const { present, cookie } = useContext(SemesterContext);
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const path = search ? `${pathname}?${search}` : pathname;
  const current = semesterFromRequest(
    { sem: params.get('sem') ?? undefined },
    cookie,
  );
  return { path, options: semesterOptions(present, current, path) };
}

/** Segmented links for the top bar (tablet and desktop). */
function Segments() {
  const { options } = useOptions();
  if (options.length === 0) return null;
  const base =
    'flex items-center justify-center rounded px-2 py-0.5 text-[12px] font-medium tabular-nums';
  return (
    <nav
      aria-label="Semester"
      className="flex items-center gap-0.5 rounded-md border border-line p-0.5 max-sm:hidden"
    >
      <span className="px-1 text-[12px] text-muted max-lg:sr-only">
        Semester
      </span>
      {options.map((o) =>
        o.current ? (
          <span
            key={o.label}
            aria-current="page"
            className={`${base} bg-accent-fill text-on-accent`}
          >
            {o.label}
          </span>
        ) : (
          <ModeLink
            key={o.label}
            href={o.href}
            cls={`${base} text-accent-ink hover:bg-list-hover`}
          >
            {o.label}
          </ModeLink>
        ),
      )}
    </nav>
  );
}

/**
 * Phones: a slim row under the top bar (the bar itself has no room left for
 * the crumbs, the mode labels and a select). Changing it navigates; without
 * JS the noscript button submits the form to the same route.
 */
function PhoneRow() {
  const { path, options } = useOptions();
  if (options.length === 0) return null;
  const val = (label: string) => (label === 'All' ? 'all' : label);
  return (
    <form
      action="/semester"
      method="get"
      className="flex shrink-0 items-center gap-2 border-b border-line-strong bg-bar px-3 text-[13px] text-muted sm:hidden"
    >
      <input type="hidden" name="next" value={path} />
      <label htmlFor="semester-select">Semester</label>
      <select
        id="semester-select"
        name="to"
        value={val(options.find((o) => o.current)?.label ?? 'All')}
        onChange={(e) => {
          const o = options.find((x) => val(x.label) === e.target.value);
          if (o) window.location.assign(o.href);
        }}
        className="min-h-11 rounded border-0 bg-transparent px-1 text-[13px] font-medium text-fg"
      >
        {options.map((o) => (
          <option key={o.label} value={val(o.label)}>
            {o.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="min-h-11 px-1 text-accent-ink">
          Go
        </button>
      </noscript>
    </form>
  );
}

export function SemesterSwitcher() {
  return (
    <Suspense fallback={null}>
      <Segments />
    </Suspense>
  );
}

export function SemesterBar() {
  return (
    <Suspense fallback={null}>
      <PhoneRow />
    </Suspense>
  );
}
