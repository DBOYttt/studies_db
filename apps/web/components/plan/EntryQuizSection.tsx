'use client';

import { ClipboardText } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import {
  addMarkAction,
  editMarkAction,
  removeMarkAction,
  restoreMarkAction,
  unskipMarkAction,
} from '@/lib/class-mark-actions';
import type { EntryQuizClassView, EntryQuizMarkView } from '@/lib/entry-quiz';
import { markActionError } from '@/lib/plan-view';
import { type QuizChange, quizStatus } from '@/lib/status-text';

const input =
  'h-8 w-full rounded border border-line-strong bg-panel px-2 text-fg focus:border-accent';
const label = 'flex flex-col gap-1 text-[13px] font-semibold text-fg';
const btn =
  'inline-flex h-8 items-center gap-[5px] rounded border border-line-strong px-2.5 text-accent-ink hover:border-accent aria-disabled:opacity-60';
const primaryBtn =
  'inline-flex h-8 items-center gap-[5px] rounded bg-accent-fill px-3 font-semibold text-on-accent hover:bg-accent-fill-hover aria-disabled:opacity-60';

type Run = (
  action: () => Promise<{ ok: boolean; message: string }>,
  done: { change: QuizChange; groupLabel: string; date?: string },
  after?: () => void,
) => void;

/**
 * "Entry quiz every session" of the subject pages (simple and advanced):
 * per class, the entry quizzes that are on (note with the version check,
 * "Turn off", skipped dates with "Undo") and "Turn on" for all groups or one
 * group. Admins also see turned-off ones with "Restore". The timetable's
 * "Edit" links here (`#entry-quiz`). Each success is written to the
 * section's polite status line ("Entry quiz turned on for all groups.").
 */
export function EntryQuizSection({
  classes,
  defaultGroupId = null,
  noteMax,
}: {
  classes: EntryQuizClassView[];
  /** Preselected in "Turn on" (the group the page is filtered to). */
  defaultGroupId?: number | null;
  noteMax: number;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState('');
  return (
    <section
      id="entry-quiz"
      aria-labelledby="entry-quiz-title"
      className="mt-3 max-w-3xl scroll-mt-14 overflow-hidden rounded-md border border-line-strong"
    >
      <div className="flex items-center gap-1.5 border-b border-line-strong bg-box-head px-3 py-[7px]">
        <ClipboardText size={15} className="text-accent-ink" aria-hidden />
        <h2
          id="entry-quiz-title"
          ref={headingRef}
          tabIndex={-1}
          className="m-0 text-[13px] font-semibold outline-none"
        >
          Entry quiz every session
        </h2>
      </div>
      <p className="m-0 border-b border-line px-3 py-2 text-muted">
        A short quiz at the start of every session. It shows on the timetable.
      </p>
      <p
        role="status"
        className={
          status ? 'm-0 border-b border-line px-3 py-2 text-ok-fg' : 'sr-only'
        }
      >
        {status}
      </p>
      {classes.map((c) => (
        <ClassBlock
          key={c.id}
          c={c}
          showName={classes.length > 1}
          defaultGroupId={
            c.groups.some((g) => g.id === defaultGroupId)
              ? defaultGroupId
              : null
          }
          noteMax={noteMax}
          focusHeading={() => headingRef.current?.focus()}
          announce={setStatus}
        />
      ))}
    </section>
  );
}

function ClassBlock({
  c,
  showName,
  defaultGroupId,
  noteMax,
  focusHeading,
  announce,
}: {
  c: EntryQuizClassView;
  showName: boolean;
  defaultGroupId: number | null;
  noteMax: number;
  focusHeading: () => void;
  /** Writes the section's status line ('' clears it). */
  announce: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState(
    defaultGroupId === null ? '' : String(defaultGroupId),
  );
  const [note, setNote] = useState('');
  const uid = useId();

  const run: Run = (action, done, after) => {
    if (pending) return;
    // Outside the transition so the same refusal (or success) again is a
    // new announcement.
    setError(null);
    announce('');
    start(async () => {
      const err = await markActionError(action);
      if (err) {
        setError(err);
        return;
      }
      announce(
        quizStatus(done.change, {
          ...done,
          className: showName ? c.name : null,
        }),
      );
      after?.();
      router.refresh();
    });
  };

  const turnOn = () =>
    run(
      () =>
        addMarkAction(c.id, group ? Number(group) : null, note.trim() || null),
      {
        change: 'on',
        groupLabel:
          c.groups.find((g) => String(g.id) === group)?.name ?? 'All groups',
      },
      () => setNote(''),
    );

  const nameId = `${uid}-name`;
  const errorId = `${uid}-error`;
  return (
    // The block is a group named by its class, so the "Note (optional)" and
    // "Turn on" of several classes are told apart.
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would restyle the block; the group names its controls
    <div
      role="group"
      aria-labelledby={showName ? nameId : undefined}
      aria-label={showName ? undefined : c.name}
      className="flex flex-col gap-3 border-b border-line px-3 py-3 last:border-b-0"
    >
      {showName && (
        <h3 id={nameId} lang="pl" className="m-0 text-[13px] font-semibold">
          {c.name}
        </h3>
      )}
      {c.marks.length === 0 && (
        <p className="m-0 text-muted">No entry quiz for this class.</p>
      )}
      {c.marks.map((m) => (
        <MarkRow
          key={m.id}
          m={m}
          noteMax={noteMax}
          pending={pending}
          run={run}
          focusHeading={focusHeading}
        />
      ))}
      {c.restorable.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="m-0 text-xs font-semibold text-muted">Turned off</h4>
          <ul
            aria-label="Turned off"
            className="m-0 flex list-none flex-col gap-1.5 p-0"
          >
            {c.restorable.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span>
                  <span lang="pl">{m.groupLabel}</span>
                  {m.note && (
                    <span className="text-muted">
                      {' · '}
                      <span lang="pl">{m.note}</span>
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-disabled={pending}
                  onClick={() =>
                    run(
                      () => restoreMarkAction(m.id),
                      { change: 'restore', groupLabel: m.groupLabel },
                      focusHeading,
                    )
                  }
                  className={btn}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          turnOn();
        }}
        className="flex flex-col gap-2.5 sm:flex-row sm:items-end"
      >
        {c.groups.length > 0 && (
          <label className={`${label} sm:w-40`} htmlFor={`${uid}-group`}>
            Group
            <select
              id={`${uid}-group`}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className={input}
            >
              <option value="">All groups</option>
              {c.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={`${label} flex-1`} htmlFor={`${uid}-note`}>
          Note (optional)
          <input
            id={`${uid}-note`}
            lang="pl"
            value={note}
            maxLength={noteMax}
            onChange={(e) => setNote(e.target.value)}
            className={input}
          />
        </label>
        <button
          type="submit"
          aria-disabled={pending}
          aria-describedby={error ? errorId : undefined}
          className={`${primaryBtn} self-start sm:self-auto`}
        >
          Turn on
        </button>
      </form>
      {error && (
        <p id={errorId} role="alert" className="m-0 text-err-fg">
          {error}
        </p>
      )}
    </div>
  );
}

function MarkRow({
  m,
  noteMax,
  pending,
  run,
  focusHeading,
}: {
  m: EntryQuizMarkView;
  noteMax: number;
  pending: boolean;
  run: Run;
  focusHeading: () => void;
}) {
  const [note, setNote] = useState(m.note);
  // A new version (a save here or elsewhere) shows the stored note; the
  // row keeps its identity so focus stays on "Save note".
  const [seenVersion, setSeenVersion] = useState(m.version);
  if (seenVersion !== m.version) {
    setSeenVersion(m.version);
    setNote(m.note);
  }
  const uid = useId();
  const changed = note.trim() !== m.note;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would restyle the row; the group names its controls
    <div
      role="group"
      aria-label={`Entry quiz: ${m.groupLabel}`}
      className="flex flex-col gap-2 rounded border border-line bg-surface px-2.5 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">On · {m.groupLabel}</span>
        <button
          type="button"
          aria-disabled={pending}
          onClick={() =>
            run(
              () => removeMarkAction(m.id, m.version),
              { change: 'off', groupLabel: m.groupLabel },
              focusHeading,
            )
          }
          className={btn}
        >
          Turn off
        </button>
      </div>
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          if (!changed) return;
          run(() => editMarkAction(m.id, note.trim() || null, m.version), {
            change: 'note',
            groupLabel: m.groupLabel,
          });
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label className={`${label} flex-1`} htmlFor={`${uid}-note`}>
          Note
          <input
            id={`${uid}-note`}
            lang="pl"
            value={note}
            maxLength={noteMax}
            onChange={(e) => setNote(e.target.value)}
            className={input}
          />
        </label>
        <button
          type="submit"
          aria-disabled={pending || !changed}
          className={`${btn} self-start sm:self-auto`}
        >
          Save note
        </button>
      </form>
      {m.skips.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">
            Skipped dates
          </span>
          <ul
            aria-label="Skipped dates"
            className="m-0 flex list-none flex-wrap gap-1.5 p-0"
          >
            {m.skips.map((s) => (
              <li
                key={s.date}
                className="inline-flex items-center gap-1.5 rounded border border-line bg-panel py-0.5 pr-0.5 pl-2"
              >
                {s.label}
                <button
                  type="button"
                  aria-disabled={pending}
                  aria-label={`Undo ${s.label}`}
                  onClick={() =>
                    run(
                      () => unskipMarkAction(m.id, s.date),
                      {
                        change: 'unskip',
                        groupLabel: m.groupLabel,
                        date: s.label,
                      },
                      focusHeading,
                    )
                  }
                  className="inline-flex h-6 items-center rounded px-1.5 text-accent-ink hover:bg-line aria-disabled:opacity-60"
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
