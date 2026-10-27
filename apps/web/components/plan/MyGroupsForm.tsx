'use client';

import { FloppyDisk, UsersThree, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import {
  clearMyGroupsAction,
  saveMyGroupAction,
} from '@/lib/my-groups-actions';
import { type MyGroups, sanitizeMyGroups } from '@/lib/plan';
import type { MyGroupOption } from '@/lib/plan-queries';
import { STATUS } from '@/lib/status-text';

const primaryBtn =
  'inline-flex items-center gap-[5px] rounded bg-accent-fill px-3 py-[5px] font-semibold text-on-accent hover:bg-accent-fill-hover';
const btn =
  'inline-flex items-center gap-[5px] rounded border border-line-strong bg-panel px-2.5 py-[5px] text-accent-ink hover:border-accent';
const selectCls =
  'h-7 w-full rounded border border-line-strong bg-panel px-1.5 text-fg sm:w-56';

/**
 * "My groups": one select per class with groups (All = no choice).
 * Each pick shows at once and is saved to the account in the background (a
 * rejected save reverts that one choice); Save waits for pending saves and
 * returns to the week view; Clear forgets all choices. A save that lands
 * says so in the polite status line ("Group saved.").
 */
export function MyGroupsForm({
  options,
  initialGroups,
  weekHref,
}: {
  options: MyGroupOption[];
  initialGroups: MyGroups;
  weekHref: string;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<MyGroups>(initialGroups);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState('');
  const pending = useRef(new Set<Promise<unknown>>());
  // Latest save per class: a superseded save never reverts the newer choice.
  const seq = useRef(new Map<string, number>());
  // Stale entries (group no longer in its class) are not shown.
  const current = useMemo(
    () =>
      sanitizeMyGroups(
        chosen,
        Object.fromEntries(
          options.map((o) => [String(o.classId), o.groups.map((g) => g.id)]),
        ),
      ),
    [chosen, options],
  );

  const track = (p: Promise<unknown>) => {
    pending.current.add(p);
    p.finally(() => pending.current.delete(p));
  };

  const set = (classId: number, value: string) => {
    const key = String(classId);
    const groupId = value ? Number(value) : null;
    const before = chosen[key];
    const mine = (seq.current.get(key) ?? 0) + 1;
    seq.current.set(key, mine);
    const apply = (id: number | undefined) =>
      setChosen((c) => {
        const next = { ...c };
        if (id === undefined) delete next[key];
        else next[key] = id;
        return next;
      });
    setFailed(false);
    setStatus('');
    apply(groupId ?? undefined);
    const revert = () => {
      if (seq.current.get(key) !== mine) return;
      apply(before);
      setFailed(true);
    };
    track(
      saveMyGroupAction(classId, groupId).then((r) => {
        if (!r.ok) revert();
        else if (seq.current.get(key) === mine) setStatus(STATUS.groupSaved);
      }, revert),
    );
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await Promise.allSettled([...pending.current]);
    router.push(weekHref);
  };

  const onClear = () => {
    const before = chosen;
    setFailed(false);
    setStatus('');
    setChosen({});
    track(
      clearMyGroupsAction().then(
        () => setStatus(STATUS.groupsCleared),
        () => {
          setChosen(before);
          setFailed(true);
        },
      ),
    );
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
          My groups
        </h2>
      </div>
      <p className="m-0 border-b border-line px-3 py-2 text-muted">
        Pick your group in each class that is split into groups. The week view
        then shows only those groups. Lectures and classes you haven&apos;t
        picked a group for stay visible. Your choice is saved to your account.
      </p>
      {options.length === 0 ? (
        <p className="m-0 px-3 py-6 text-center text-muted">
          No classes are split into groups.
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
                <label htmlFor={id} lang="pl" className="min-w-0">
                  <span className="font-semibold">{o.subjectName}</span>
                  <span className="text-muted"> · {o.className}</span>
                </label>
                <select
                  id={id}
                  value={known ? String(value) : ''}
                  onChange={(e) => set(o.classId, e.target.value)}
                  className={selectCls}
                >
                  <option value="">All</option>
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
      {failed && (
        <p
          role="alert"
          className="m-0 border-b border-line px-3 py-2 text-err-fg"
        >
          Could not save your choice. Try again.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 bg-bar px-3 py-2">
        <button type="submit" className={primaryBtn}>
          <FloppyDisk size={14} aria-hidden />
          Save
        </button>
        <button type="button" onClick={onClear} className={btn}>
          <X size={14} aria-hidden />
          Clear
        </button>
        <p role="status" className="m-0 ml-1 text-ok-fg">
          {status}
        </p>
      </div>
    </form>
  );
}
