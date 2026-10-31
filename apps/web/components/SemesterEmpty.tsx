/** `/semester?to=all` back to `path` (path + query). */
export const semesterAllHref = (path: string): string =>
  `/semester?to=all&next=${encodeURIComponent(path)}`;

/**
 * A plain link (not `next/link`): `/semester` is a route handler that sets a
 * cookie, so it must never be prefetched. 44 px tall on phones.
 */
export function SemesterAllLink({
  path,
  label = 'Show all semesters',
}: {
  path: string;
  label?: string;
}) {
  return (
    <a
      href={semesterAllHref(path)}
      className="link max-sm:inline-flex max-sm:min-h-11 max-sm:items-center"
    >
      {label}
    </a>
  );
}

/**
 * The empty state of a list a chosen semester emptied: what is empty and the
 * way back, for the caller's box. Nothing without a semester.
 */
export function SemesterEmpty({
  semester,
  path,
  text,
  label,
}: {
  semester: number | null;
  /** Current path with query: the link returns here. */
  path: string;
  /** Default: `No subjects in semester N.` */
  text?: string;
  label?: string;
}) {
  if (semester === null) return null;
  return (
    <p className="m-0">
      {text ?? `No subjects in semester ${semester}.`}{' '}
      <SemesterAllLink path={path} label={label} />
    </p>
  );
}
