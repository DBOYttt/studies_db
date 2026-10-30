'use client';

import { FloppyDisk, UsersThree, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import {
  clearMyGroupsAction,
  saveMyGroupAction,
  saveMyGroupsAction,
} from '@/lib/my-groups-actions';
import { type MyGroups, sanitizeMyGroups } from '@/lib/plan';
import type { MyGroupOption } from '@/lib/plan-queries';
import { MY_GROUPS_HELP } from '@/lib/plan-view';
import { STATUS } from '@/lib/status-text';

const primaryBtn =
  'inline-flex items-center gap-[5px] rounded bg-accent-fill px-3 py-[5px] font-semibold text-on-accent hover:bg-accent-fill-hover aria-disabled:opacity-60';
const btn =
  'inline-flex items-center gap-[5px] rounded border border-line-strong bg-panel px-2.5 py-[5px] text-accent-ink hover:border-accent';
const selectCls =
  'h-7 w-full rounded border border-line-strong bg-panel px-1.5 text-fg sm:w-56';

/**
 * "My groups": one select per class with groups (All = no choice).
 * Each pick shows at once and is saved to the account in the background (a
 * rejected save reverts that one choice), saying so in the polite status line
 * next to Save ("Group saved."). Save waits for those, then writes every
 * class as this page shows it, so the last Save wins even when another tab
 * changed the groups meanwhile, and opens the week view with "Groups saved."
 * (`savedHref`). Clear forgets all choices.
 */
export function MyGroupsForm({
  options,
  initialGroups,
  savedHref,
}: {
  options: MyGroupOption[];
  initialGroups: MyGroups;
  /** The week view with the "Groups saved." notice. */
  savedHref: string;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<MyGroups>(initialGroups);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  // A double click must not run Save twice (state lags one render).
  const busy = useRef(false);
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
  // Read by Save after awaiting the background saves (a revert may land).
  const latest = useRef(current);
  latest.current = current;

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
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setFailed(false);
    await Promise.allSettled([...pending.current]);
    // Every shown class, "All groups" as null: the page's choice is what stays.
    const choice = Object.fromEntries(
      options.map((o) => [
        String(o.classId),
        latest.current[String(o.classId)] ?? null,
      ]),
    );
    let ok = false;
    try {
      ok = (await saveMyGroupsAction(choice)).ok;
    } catch {
      ok = false;
    }
    if (ok) {
      router.push(savedHref);
      return;
    }
    busy.current = false;
    setSaving(false);
    setFailed(true);
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
      method="post"
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
        {MY_GROUPS_HELP}
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
                  <option value="">All groups (not picked)</option>
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
        <button
          type="submit"
          aria-disabled={saving || undefined}
          className={primaryBtn}
        >
          <FloppyDisk size={14} aria-hidden />
          {saving ? 'Saving…' : 'Save'}
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
