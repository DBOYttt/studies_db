'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, type ReactNode, Suspense, useContext } from 'react';
import { ModeLink } from '@/components/shell/ModeSwitch';
import {
  type Semester,
  semesterFromRequest,
  semesterOptions,
  unlistedSemester,
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
  // Admin pages are never filtered: no switcher there.
  const admin = pathname === '/admin' || pathname.startsWith('/admin/');
  const options = admin ? [] : semesterOptions(present, current, path);
  return {
    path,
    options,
    unlisted: options.length ? unlistedSemester(present, current) : null,
  };
}

/** Visible `All` / `3`, named `All semesters` / `Semester 3`. */
function OptionText({ label }: { label: string }) {
  return label === 'All' ? (
    <>
      All<span className="sr-only"> semesters</span>
    </>
  ) : (
    <>
      <span className="sr-only">Semester </span>
      {label}
    </>
  );
}

/** Segmented links for the top bar (tablet and desktop). */
function Segments() {
  const { options, unlisted } = useOptions();
  if (options.length === 0) return null;
  // At least 24 px square (WCAG 2.5.8); every entry is styled alike, only the
  // current one is filled.
  const base =
    'flex min-h-6 min-w-6 items-center justify-center rounded px-2 text-[12px] font-medium tabular-nums';
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
            aria-current="true"
            className={`${base} bg-accent-fill text-on-accent`}
          >
            <OptionText label={o.label} />
          </span>
        ) : (
          <ModeLink
            key={o.label}
            href={o.href}
            cls={`${base} text-accent-ink transition-colors hover:bg-list-hover`}
          >
            <OptionText label={o.label} />
          </ModeLink>
        ),
      )}
      {unlisted !== null && (
        <span aria-current="true" className="px-1.5 text-[12px] text-muted">
          Semester {unlisted} (no subjects)
        </span>
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
  const { path, options, unlisted } = useOptions();
  if (options.length === 0) return null;
  const val = (label: string) => (label === 'All' ? 'all' : label);
  const current =
    unlisted !== null
      ? String(unlisted)
      : val(options.find((o) => o.current)?.label ?? 'All');
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
        value={current}
        onChange={(e) => {
          const o = options.find((x) => val(x.label) === e.target.value);
          if (o) window.location.assign(o.href);
        }}
        className="min-h-11 min-w-11 rounded border-0 bg-transparent px-2 text-[13px] font-medium text-fg"
      >
        {options.map((o) => (
          <option key={o.label} value={val(o.label)}>
            {o.label}
          </option>
        ))}
        {unlisted !== null && (
          <option value={String(unlisted)}>{unlisted} (no subjects)</option>
        )}
      </select>
      <noscript>
        <button
          type="submit"
          className="min-h-11 min-w-11 px-1 text-accent-ink"
        >
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
