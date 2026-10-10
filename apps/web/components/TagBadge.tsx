export function TagBadge({ name }: { name: string }) {
  return (
    <span className="inline-block rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs">
      {name}
    </span>
  );
}
