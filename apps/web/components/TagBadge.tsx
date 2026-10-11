export function TagBadge({
  name,
  size = 'sm',
}: {
  name: string;
  /** `lg`: page title size (tag page header). */
  size?: 'sm' | 'lg';
}) {
  const cls =
    size === 'lg' ? 'px-3 py-0.5 text-lg font-semibold' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-block rounded-full border border-[var(--border)] bg-[var(--surface)] ${cls}`}
    >
      {name}
    </span>
  );
}
