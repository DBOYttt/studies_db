'use client';

import { CalendarPlus, Check, Eye } from '@phosphor-icons/react';
import type { GroupImportPreview } from '@studies/db';
import { GROUP_IMPORT_MAX_PAIRS } from '@studies/db/constants';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { plural } from '@/lib/format';
import {
  applyGroupImportAction,
  previewGroupImportAction,
} from '@/lib/group-import-actions';
import { useHydrated } from '@/lib/use-hydrated';

// Same limit and copy as the server (IMPORT_MAX_BYTES): checked here first,
// so a large file is never sent.
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FILE_TOO_LARGE = 'The file is too large (max 2 MB).';

const primaryBtn =
  'inline-flex items-center gap-[5px] rounded bg-accent-fill px-3 py-[5px] font-semibold text-on-accent hover:bg-accent-fill-hover aria-disabled:opacity-60';
const btn =
  'inline-flex items-center gap-[5px] rounded border border-line-strong bg-panel px-2.5 py-[5px] text-accent-ink hover:border-accent aria-disabled:opacity-60';
const input =
  'h-7 w-full rounded border border-line-strong bg-panel px-2 text-fg focus:border-accent';

const REASON: Record<
  GroupImportPreview['unmatched'][number]['reason'],
  string
> = {
  subject: 'subject not in Studies DB',
  class: 'class not in Studies DB',
  group: 'group not in Studies DB',
};

type Result = { preview: GroupImportPreview; notice: string | null };

/**
 * "Import from UniTime": reads a personal UniTime calendar (link or .ics
 * file), lists the groups it finds and saves the changed ones into My
 * groups.
 */
export function GroupImport() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  // Read synchronously: a second click in the same tick must not see a
  // stale `busy`.
  const working = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(kind: 'preview' | 'apply', job: () => Promise<void>) {
    const fallback =
      kind === 'apply'
        ? 'Could not save the groups.'
        : 'Could not read the calendar.';
    if (working.current) return;
    working.current = true;
    setBusy(kind);
    setError(null);
    try {
      await job();
    } catch {
      setError(fallback);
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  const onPreview = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('file');
    if (file instanceof File && file.size > MAX_FILE_BYTES) {
      setError(FILE_TOO_LARGE);
      return;
    }
    void run('preview', async () => {
      setSaved('');
      const r = await previewGroupImportAction(form);
      if (!r.ok) {
        setResult(null);
        setError(r.error);
        return;
      }
      setResult({ preview: r.preview, notice: r.notice });
    });
  };

  const changes =
    result?.preview.matched.filter((m) => m.currentGroupId !== m.groupId) ?? [];

  const onApply = () =>
    run('apply', async () => {
      const r = await applyGroupImportAction(
        changes
          .slice(0, GROUP_IMPORT_MAX_PAIRS)
          .map((m) => ({ classId: m.classId, groupId: m.groupId })),
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult(null);
      formRef.current?.reset();
      setSaved(`Groups saved: ${r.set}.`);
      router.refresh();
    });

  const p = result?.preview;
  const skipped = p
    ? [
        p.skipped.exam && plural(p.skipped.exam, 'exam', 'exams'),
        p.skipped.noKind && `${p.skipped.noKind} without a class type`,
        p.skipped.noGroup && `${p.skipped.noGroup} without a group`,
        p.skipped.noDates && `${p.skipped.noDates} without dates`,
      ].filter(Boolean)
    : [];

  return (
    <section
      aria-labelledby="group-import-title"
      className="mb-3 max-w-3xl overflow-hidden rounded-md border border-line-strong"
    >
      <div className="flex items-center gap-1.5 border-b border-line-strong bg-box-head px-3 py-[7px]">
        <CalendarPlus size={15} className="text-accent-ink" aria-hidden />
        <h2 id="group-import-title" className="m-0 text-[13px] font-semibold">
          Import from UniTime
        </h2>
      </div>
      <p className="m-0 border-b border-line px-3 py-2 text-muted">
        In UniTime open your personal timetable, choose Export → iCalendar and
        copy the link.
      </p>
      <form
        method="post"
        ref={formRef}
        onSubmit={onPreview}
        className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-end sm:gap-3"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 font-semibold">
          UniTime calendar link
          <input
            type="url"
            name="url"
            ref={urlRef}
            // One source at a time: typing a link drops a chosen file.
            onChange={(e) => {
              if (e.target.value && fileRef.current) fileRef.current.value = '';
            }}
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://plan.agh.edu.pl/…"
            className={`${input} font-normal`}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 font-semibold">
          or upload a .ics file
          <input
            type="file"
            name="file"
            ref={fileRef}
            // ...and choosing a file drops the typed link.
            onChange={(e) => {
              if (e.target.files?.length && urlRef.current)
                urlRef.current.value = '';
            }}
            accept=".ics,text/calendar"
            className="max-w-full font-normal text-muted file:mr-2 file:rounded file:border file:border-line-strong file:bg-panel file:px-2 file:py-[3px] file:text-accent-ink"
          />
        </label>
        <button
          type="submit"
          // A real `disabled` until hydration: Enter in the link field must
          // not submit natively and put the link into the URL.
          disabled={!hydrated}
          aria-disabled={busy !== null}
          className={`${btn} self-start sm:self-auto`}
        >
          <Eye size={14} aria-hidden />
          {busy === 'preview' ? 'Reading…' : 'Preview'}
        </button>
      </form>
      {error && (
        <p
          role="alert"
          className="m-0 border-b border-line bg-err-bg px-3 py-2 text-err-fg"
        >
          {error}
        </p>
      )}
      <div role="status">
        {saved && <p className="m-0 px-3 py-2 text-ok-fg">{saved}</p>}
        {result && p && (
          <div className="flex flex-col">
            {result.notice && (
              <p className="m-0 border-b border-line px-3 py-2 text-muted">
                {result.notice}
              </p>
            )}
            {(p.matched.length > 0 || p.ambiguous.length > 0) && (
              <ul lang="pl">
                {p.matched.map((m, i) => (
                  <li
                    key={m.classId}
                    className={`border-b border-line px-3 py-1.5 ${i % 2 ? 'bg-zebra' : ''}`}
                  >
                    <span className="font-semibold">{m.subjectName}</span>
                    <span className="text-muted"> · {m.className}: </span>
                    {m.groupName}
                    {m.currentGroupId === m.groupId ? (
                      <span className="text-muted" lang="en">
                        {' '}
                        (already set)
                      </span>
                    ) : m.currentGroupId !== null ? (
                      <span className="text-muted" lang="en">
                        {' '}
                        (
                        {m.currentGroupName
                          ? `was ${m.currentGroupName}`
                          : 'was another group'}
                        )
                      </span>
                    ) : null}
                  </li>
                ))}
                {p.ambiguous.map((a) => (
                  <li
                    key={a.classId}
                    className="border-b border-line px-3 py-1.5"
                  >
                    <span className="font-semibold">{a.subjectName}</span>
                    <span className="text-muted"> · {a.className}: </span>
                    <span lang="en">
                      several groups ({a.groupNames.join(', ')}), pick one below
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {p.unmatched.length > 0 && (
              <details className="border-b border-line px-3 py-1.5">
                <summary className="cursor-pointer text-muted">
                  {plural(p.unmatched.length, 'entry', 'entries')} not matched
                </summary>
                <ul className="mt-1 mb-0.5" lang="pl">
                  {p.unmatched.map((u) => (
                    <li
                      key={`${u.subjectName}\u0000${u.label}\u0000${u.reason}`}
                      className="py-0.5"
                    >
                      {u.subjectName}
                      <span className="text-muted">
                        {' '}
                        · {u.label}: <span lang="en">{REASON[u.reason]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {skipped.length > 0 && (
              <p className="m-0 border-b border-line px-3 py-1.5 text-muted">
                Skipped: {skipped.join(', ')}.
              </p>
            )}
            {p.matched.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 bg-bar px-3 py-2">
                {changes.length === 0 ? (
                  <p className="m-0 text-ok-fg">
                    Your groups already match this calendar.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={onApply}
                    aria-disabled={busy !== null}
                    className={primaryBtn}
                  >
                    <Check size={14} aria-hidden />
                    {busy === 'apply'
                      ? 'Saving…'
                      : `Apply ${plural(changes.length, 'group', 'groups')}`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
