'use client';

import { FloppyDisk, UsersThree, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import type { MyGroups } from '@/lib/plan';
import type { MyGroupOption } from '@/lib/plan-queries';
import { saveMyGroups, useMyGroups } from './useMyGroups';

const primaryBtn =
  'inline-flex items-center gap-[5px] rounded bg-accent-fill px-3 py-[5px] font-semibold text-on-accent hover:bg-accent-fill-hover';
const btn =
  'inline-flex items-center gap-[5px] rounded border border-line-strong bg-panel px-2.5 py-[5px] text-accent-ink hover:border-accent';
const selectCls =
  'h-7 w-full rounded border border-line-strong bg-panel px-1.5 text-fg sm:w-56';

/**
 * "Moje grupy": one select per class with groups (Wszystkie = no choice).
 * Zapisz stores the choice in localStorage and returns to the week view;
 * Wyczyść forgets it. Entries for classes not listed here are kept.
 */
export function MyGroupsForm({
  options,
  weekHref,
}: {
  options: MyGroupOption[];
  weekHref: string;
}) {
  const router = useRouter();
  const stored = useMyGroups();
  // Edits on top of the stored choice; null = untouched (shows `stored`).
  const [draft, setDraft] = useState<MyGroups | null>(null);
  const current = draft ?? stored;

  const set = (classId: number, value: string) => {
    const next = { ...current };
    if (value) next[String(classId)] = Number(value);
    else delete next[String(classId)];
    setDraft(next);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMyGroups(current);
    router.push(weekHref);
  };

  const onClear = () => {
    saveMyGroups({});
    setDraft(null);
  };

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="my-groups-title"
      className="max-w-3xl overflow-hidden rounded-md border border-line-strong"
    >
      <div className="flex items-center gap-1.5 border-b border-line-strong bg-box-head px-3 py-[7px]">
        <UsersThree size={15} className="text-accent-ink" aria-hidden />
        <h2 id="my-groups-title" className="m-0 text-[13px] font-semibold">
          Moje grupy
        </h2>
      </div>
      <p className="m-0 border-b border-line px-3 py-2 text-muted">
        Wybierz swoją grupę w zajęciach z podziałem na grupy. Tydzień pokaże
        tylko te grupy; wykłady i zajęcia bez wyboru zostają widoczne. Wybór
        jest zapisany w tej przeglądarce.
      </p>
      {options.length === 0 ? (
        <p className="m-0 px-3 py-6 text-center text-muted">
          Brak zajęć z podziałem na grupy.
        </p>
      ) : (
        <ul>
          {options.map((o, i) => {
            const id = `my-group-${o.classId}`;
            const value = current[String(o.classId)];
            const known = o.groups.some((g) => g.id === value);
            return (
              <li
                key={o.classId}
                className={`flex flex-col gap-1 border-b border-line px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
                  i % 2 ? 'bg-zebra' : ''
                }`}
              >
                <label htmlFor={id} className="min-w-0">
                  <span className="font-semibold">{o.subjectName}</span>
                  <span className="text-muted"> · {o.className}</span>
                </label>
                <select
                  id={id}
                  value={known ? String(value) : ''}
                  onChange={(e) => set(o.classId, e.target.value)}
                  className={selectCls}
                >
                  <option value="">Wszystkie</option>
                  {o.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5 bg-bar px-3 py-2">
        <button type="submit" className={primaryBtn}>
          <FloppyDisk size={14} aria-hidden />
          Zapisz
        </button>
        <button type="button" onClick={onClear} className={btn}>
          <X size={14} aria-hidden />
          Wyczyść
        </button>
      </div>
    </form>
  );
}
