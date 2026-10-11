'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

const cell = 'px-3 py-[5px]';
const head = 'border-b border-line px-3 py-1.5 font-semibold';

/**
 * Per-column search of a view (design lines 233-260). Wykonaj opens the browse
 * tab with the non-empty values as the table page's `f_<col>` filters (LIKE
 * %…%); without JS the form is a plain GET to the same URL. Wyczyść empties
 * the inputs and drops the applied filters.
 */
export function ViewSearchForm({
  view,
  columns,
  values,
  perPage,
  sort,
  dir,
}: {
  view: string;
  columns: { name: string; type: string }[];
  /** Currently applied filters (prefill). */
  values: Record<string, string>;
  /** Non-default page size to keep (`per`), if any. */
  perPage?: number;
  /** Current sort to keep. */
  sort?: string;
  dir?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, string>>(values);
  const base = `/tables/${view}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const c of columns) {
      const v = state[c.name]?.trim();
      if (v) p.set(`f_${c.name}`, v);
    }
    if (perPage) p.set('per', String(perPage));
    if (sort) p.set('sort', sort);
    if (dir) p.set('dir', dir);
    router.push(p.size ? `${base}?${p}` : base);
  };

  const clear = () => {
    setState({});
    if (Object.keys(values).length) {
      router.replace(`${base}?tab=search${perPage ? `&per=${perPage}` : ''}`);
    }
  };

  return (
    <form method="get" action={base} onSubmit={submit}>
      <fieldset className="m-0 rounded-md border border-line-strong bg-page p-0">
        <legend className="ml-2.5 px-1.5 font-semibold">
          Szukaj w widoku{' '}
          <span className="font-mono text-accent-ink">{view}</span>
        </legend>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-muted">
                <th className={head}>Kolumna</th>
                <th className={head}>Typ</th>
                <th className={head}>Operator</th>
                <th className={head}>Wartość</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c, i) => {
                const id = `search-${c.name}`;
                return (
                  <tr key={c.name} className={i % 2 ? 'bg-zebra' : ''}>
                    <td className={`${cell} font-mono`}>
                      <label htmlFor={id}>{c.name}</label>
                    </td>
                    <td
                      className={`${cell} font-mono text-xs text-sql-keyword`}
                    >
                      {c.type}
                    </td>
                    <td className={cell}>
                      <select
                        aria-label={`Operator dla ${c.name}`}
                        className="rounded border border-line-strong bg-page px-1.5 py-[3px]"
                        defaultValue="like"
                      >
                        <option value="like">LIKE %…%</option>
                      </select>
                    </td>
                    <td className={cell}>
                      <input
                        id={id}
                        name={`f_${c.name}`}
                        value={state[c.name] ?? ''}
                        onChange={(e) =>
                          setState((s) => ({ ...s, [c.name]: e.target.value }))
                        }
                        maxLength={200}
                        className="w-full min-w-40 max-w-[320px] rounded border border-line-strong bg-page px-2 py-1"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {perPage ? <input type="hidden" name="per" value={perPage} /> : null}
        {sort ? <input type="hidden" name="sort" value={sort} /> : null}
        {dir ? <input type="hidden" name="dir" value={dir} /> : null}
        <div className="flex justify-end gap-2 rounded-b-md border-t border-line bg-bar px-3 py-2.5">
          <button
            type="button"
            onClick={clear}
            className="rounded border border-line-strong bg-page px-3 py-1.5 hover:border-accent"
          >
            Wyczyść
          </button>
          <button
            type="submit"
            className="rounded bg-accent-fill px-[18px] py-1.5 font-semibold text-on-accent hover:bg-accent-fill-hover"
          >
            Wykonaj
          </button>
        </div>
      </fieldset>
    </form>
  );
}
