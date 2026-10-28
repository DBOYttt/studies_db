'use client';

import { FloppyDisk } from '@phosphor-icons/react';
import { EVENT_KINDS, type EventKind } from '@studies/db/constants';
import { EVENT_NOT_FOUND } from '@studies/db/text';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  createEventAction,
  restoreEventAction,
  sessionOptionsAction,
  updateEventAction,
} from '@/lib/event-actions';
import { type FormVersion, nextFormVersion } from '@/lib/event-form-version';
import type { SubjectOption } from '@/lib/event-queries';
import { type SessionOption, sessionFormFields } from '@/lib/session-options';
import { STATUS } from '@/lib/status-text';

export type EventFormValues = {
  kind: EventKind;
  title: string;
  subjectId: number | null;
  classId: number | null;
  groupId: number | null;
  date: string;
  start: string;
  end: string;
  place: string;
  note: string;
  /** Set when the event is an occurrence of a series. */
  inSeries?: boolean;
  /** Row version at load time; the save is refused if it changed since. */
  version?: number;
  /** The picked class session (`?session=`, "Add test" on the timetable). */
  sessionId?: string;
};

/** ms between clearing the status line and writing it again. */
const STATUS_DELAY = 150;

const groupKey = (classId: number | null, groupId: number | null) =>
  classId === null ? null : `${classId}:${groupId ?? ''}`;

/** The refusal for an event that no longer exists (same text as the db's). */
const GONE = EVENT_NOT_FOUND;

const input =
  'h-8 w-full rounded border border-line-strong bg-panel px-2 text-fg focus:border-accent';
const label = 'flex flex-col gap-1 text-[13px] font-semibold text-fg';
const primaryBtn =
  'inline-flex items-center gap-[5px] rounded bg-accent-fill px-3 py-[6px] font-semibold text-on-accent hover:bg-accent-fill-hover aria-disabled:opacity-60';

/**
 * Add / edit form of an event, one field width throughout. Subject, class,
 * group and "Pick a session" come first (the pick fills the When fields
 * below). "When" is three inputs (date, start, end)
 * that the Server Action composes into `DD.MM.YYYY [HH:MM[-HH:MM]]`. Class and
 * group follow the chosen subject. For a Test with a class, "Pick a session"
 * lists the class/group's upcoming sessions and fills date, time and place
 * (still editable), saying so in a polite status line. A refusal is shown
 * in place and describes the submit button; success redirects from the
 * action. The submit is `aria-disabled` while saving (not `disabled`, which
 * would drop focus).
 */
export function EventForm({
  options,
  base,
  initial,
  eventId,
  cancelHref,
  deleted = false,
  isAdmin = false,
  planHref,
  sessions,
}: {
  options: SubjectOption[];
  base: 'simple' | 'advanced';
  initial: EventFormValues;
  /** Set when editing. */
  eventId?: number;
  cancelHref: string;
  /** The event was soft-deleted: show the banner, Save disabled. */
  deleted?: boolean;
  isAdmin?: boolean;
  planHref?: string;
  /** "Pick a session" options of the initial class/group, when loaded. */
  sessions?: SessionOption[];
}) {
  const router = useRouter();
  // Kept from the first render: a refresh after a refusal must not swap in a
  // newer version, or the next Save would silently overwrite the other edit.
  // Only a delete or restore seen as a single version step is followed
  // (see nextFormVersion), so restoring from the banner can save again.
  const [seen, setSeen] = useState<FormVersion>({
    version: initial.version,
    deleted,
  });
  useEffect(() => {
    setSeen((s) => nextFormVersion(s, { version: initial.version, deleted }));
  }, [deleted, initial.version]);
  const version = seen.version;
  const [subjectId, setSubjectId] = useState(initial.subjectId);
  const [classId, setClassId] = useState(initial.classId);
  const [groupId, setGroupId] = useState(initial.groupId);
  const [kind, setKind] = useState<EventKind>(initial.kind);
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.start);
  const [endTime, setEndTime] = useState(initial.end);
  const [place, setPlace] = useState(initial.place);
  const [sessionId, setSessionId] = useState(initial.sessionId ?? '');
  // Options and the class/group they belong to; refetched when that changes.
  const [picker, setPicker] = useState<{
    key: string | null;
    options: SessionOption[];
    /** The options could not be loaded (offline, server error). */
    failed: boolean;
  }>({
    key: sessions ? groupKey(initial.classId, initial.groupId) : null,
    options: sessions ?? [],
    failed: false,
  });
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatusNow] = useState('');
  // The auto-fill message is written a moment after the line is cleared, so
  // a second pick is a new change that screen readers announce again.
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setStatus = (text: string) => {
    clearTimeout(statusTimer.current);
    setStatusNow('');
    if (text)
      statusTimer.current = setTimeout(() => setStatusNow(text), STATUS_DELAY);
  };
  useEffect(() => () => clearTimeout(statusTimer.current), []);
  const [pending, start] = useTransition();
  const subject = options.find((s) => s.id === subjectId);
  const cls = subject?.classes.find((c) => c.id === classId);
  const wantKey = kind === 'kolokwium' ? groupKey(classId, groupId) : null;

  useEffect(() => {
    if (wantKey === null || wantKey === picker.key || classId === null) return;
    let live = true;
    startTransition(async () => {
      let options: SessionOption[] = [];
      let failed = false;
      try {
        options = await sessionOptionsAction(classId, groupId);
      } catch {
        failed = true;
      }
      if (live) setPicker({ key: wantKey, options, failed });
    });
    return () => {
      live = false;
    };
  }, [wantKey, picker.key, classId, groupId]);

  const pickSession = (value: string) => {
    setSessionId(value);
    const o = picker.options.find((x) => x.value === value);
    if (!o) return;
    const f = sessionFormFields(o);
    setDate(f.date);
    setStartTime(f.start);
    setEndTime(f.end);
    setPlace(f.place);
    setStatus(STATUS.sessionFilled);
  };
  const showPicker = wantKey !== null;
  const pickerReady = picker.key === wantKey;

  const submit = (fd: FormData) => {
    if (pending || deleted) return;
    setError(null);
    start(async () => {
      const r =
        eventId === undefined
          ? await createEventAction(fd)
          : await updateEventAction(eventId, fd);
      // Success redirects; only a refusal comes back.
      if (r && !r.ok) {
        setError(r.message);
        // Deleted meanwhile: re-render the page for the banner; typed values stay.
        if (eventId !== undefined && r.message === GONE) router.refresh();
      }
    });
  };

  const restore = () => {
    if (pending) return;
    start(async () => {
      const r = await restoreEventAction(eventId ?? 0);
      if (r.ok) router.refresh();
      else setError(r.message);
    });
  };

  return (
    <>
      {deleted && (
        <div
          role="alert"
          className="mb-3.5 flex max-w-xl flex-wrap items-center gap-3 rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg"
        >
          <span>This event was deleted. Your changes weren't saved.</span>
          {planHref && (
            <Link href={planHref} className="link">
              Back to timetable
            </Link>
          )}
          {isAdmin && (
            <button type="button" onClick={restore} aria-disabled={pending}>
              Restore
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          // Not `action={fn}`: React 19 resets uncontrolled fields after it,
          // which would empty the form on a refusal.
          e.preventDefault();
          submit(new FormData(e.currentTarget));
        }}
        className="flex max-w-xl flex-col gap-3.5"
      >
        <p className="m-0 text-xs text-muted">
          Fields marked <span className="text-err-fg">*</span> are required.
        </p>
        <input type="hidden" name="base" value={base} />
        {version !== undefined && (
          <input type="hidden" name="version" value={version} />
        )}
        <label className={label}>
          Type
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as EventKind)}
            className={input}
          >
            {Object.entries(EVENT_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Subject
          <select
            name="subjectId"
            value={subjectId ?? ''}
            onChange={(e) => {
              setSubjectId(e.target.value ? Number(e.target.value) : null);
              setClassId(null);
              setGroupId(null);
              setSessionId('');
            }}
            className={input}
          >
            <option value="">No subject</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        {subject && subject.classes.length > 0 && (
          <div className="flex flex-col gap-3.5">
            <label className={label}>
              Class
              <select
                name="classId"
                value={classId ?? ''}
                onChange={(e) => {
                  setClassId(e.target.value ? Number(e.target.value) : null);
                  setGroupId(null);
                  setSessionId('');
                }}
                className={input}
              >
                <option value="">All</option>
                {subject.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {cls && cls.groups.length > 0 && (
              <label className={label}>
                Group
                <select
                  name="groupId"
                  value={groupId ?? ''}
                  onChange={(e) => {
                    setGroupId(e.target.value ? Number(e.target.value) : null);
                    setSessionId('');
                  }}
                  className={input}
                >
                  <option value="">All</option>
                  {cls.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {showPicker && (
          <div className="flex flex-col gap-1">
            <label htmlFor="pick-session" className={label}>
              Pick a session
            </label>
            <select
              id="pick-session"
              value={pickerReady ? sessionId : ''}
              onChange={(e) => pickSession(e.target.value)}
              disabled={!pickerReady || picker.options.length === 0}
              aria-describedby="pick-session-help"
              className={`${input} disabled:opacity-60`}
            >
              <option value="">
                {!pickerReady
                  ? 'Loading sessions…'
                  : picker.failed
                    ? 'Could not load sessions.'
                    : picker.options.length === 0
                      ? 'No upcoming sessions'
                      : 'Choose a session'}
              </option>
              {pickerReady &&
                picker.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </select>
            <span
              id="pick-session-help"
              className="text-xs font-normal text-muted"
            >
              Fills the date, time and place; you can still change them.
            </span>
            <span role="status" className="text-xs font-normal text-ok-fg">
              {status}
            </span>
          </div>
        )}
        <label className={label}>
          <span className="req">Title</span>
          <input
            name="title"
            required
            lang="pl"
            maxLength={100}
            defaultValue={initial.title}
            className={input}
          />
        </label>
        <div className="flex flex-col gap-3.5">
          <label className={label}>
            <span className="req">Date</span>
            <input
              type="date"
              name="date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSessionId(''); // no longer that session
                setStatus('');
              }}
              className={input}
            />
          </label>
          <label className={label}>
            Starts
            <input
              type="time"
              name="start"
              aria-describedby="event-all-day-hint"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                setSessionId('');
                setStatus('');
              }}
              className={input}
            />
          </label>
          <label className={label}>
            Ends
            <input
              type="time"
              name="end"
              aria-describedby="event-all-day-hint"
              value={endTime}
              onChange={(e) => {
                setEndTime(e.target.value);
                setSessionId('');
                setStatus('');
              }}
              className={input}
            />
          </label>
        </div>
        <p id="event-all-day-hint" className="m-0 -mt-2 text-xs text-muted">
          Without a time the event lasts all day.
        </p>
        {eventId === undefined && (
          <div className="flex flex-col gap-3.5">
            <label className={label}>
              Repeat
              <select
                name="repeat"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                className={input}
              >
                <option value="">Don&apos;t repeat</option>
                <option value="weekly">every week</option>
                <option value="biweekly">every 2 weeks</option>
              </select>
            </label>
            {repeat && (
              <label className={label}>
                <span className="req">Until</span>
                <input type="date" name="until" required className={input} />
              </label>
            )}
          </div>
        )}
        {initial.inSeries && (
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-[13px] font-semibold text-fg">
              Apply changes to
            </legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" value="one" defaultChecked />
              Only this one
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" value="following" />
              This and following
            </label>
          </fieldset>
        )}
        <label className={label}>
          Place
          <input
            name="place"
            lang="pl"
            maxLength={100}
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              setStatus('');
            }}
            className={input}
          />
        </label>
        <label className={label}>
          Note
          <textarea
            name="note"
            lang="pl"
            maxLength={1000}
            rows={4}
            defaultValue={initial.note}
            className={`${input} h-auto py-1.5`}
          />
        </label>
        {error && (
          <div
            id="event-form-error"
            role="alert"
            className="rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg"
          >
            {error}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            aria-disabled={pending || deleted}
            aria-describedby={error ? 'event-form-error' : undefined}
            className={primaryBtn}
          >
            <FloppyDisk size={15} aria-hidden />
            {eventId === undefined ? 'Add event' : 'Save'}
          </button>
          <Link href={cancelHref} className="link">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
