'use client';

import { useRouter } from 'next/navigation';

export type TreeOption = { href: string; label: string; depth: number };

/** Mobile replacement for the tree: one select that navigates on change. */
export function TreeSelect({
  options,
  value,
}: {
  options: TreeOption[];
  value: string;
}) {
  const router = useRouter();
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">Lokalizacja</span>
      <select
        value={value}
        onChange={(e) => router.push(e.target.value)}
        className="w-full rounded-lg border border-line bg-panel px-3 py-2"
      >
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {`${'  '.repeat(o.depth)}${o.label}`}
          </option>
        ))}
      </select>
    </label>
  );
}
