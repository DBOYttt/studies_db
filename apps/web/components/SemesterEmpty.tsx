/** Empty-state line shown while a semester is chosen and a list came back empty. */
export function SemesterEmpty({
  semester,
  path,
}: {
  semester: number | null;
  /** Current path with query: the link returns here. */
  path: string;
}) {
  if (semester === null) return null;
  return (
    <p className="m-0 text-muted">
      Showing semester {semester} only.{' '}
      <a
        href={`/semester?to=all&next=${encodeURIComponent(path)}`}
        className="link"
      >
        Show all semesters
      </a>
    </p>
  );
}
