'use client';

import { useRouter } from 'next/navigation';

/**
 * "Tag:" select of the subject header (design 97-103). Options map to
 * server-built hrefs (value '' = Wszystkie), so the URL stays the source of truth.
 */
export function TagSelect({
  value,
  options,
}: {
  value: string;
  options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2">
      <span className="text-muted">Tag:</span>
      <select
        value={value}
        onChange={(e) => {
          const o = options.find((x) => x.value === e.target.value);
          if (o) router.push(o.href, { scroll: false });
        }}
        className="max-w-[16rem] rounded border border-line-strong bg-page px-1.5 py-1"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
