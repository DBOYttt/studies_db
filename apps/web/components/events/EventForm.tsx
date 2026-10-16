'use client';

import { FloppyDisk } from '@phosphor-icons/react';
import { EVENT_KINDS, type EventKind } from '@studies/db/constants';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { createEventAction, updateEventAction } from '@/lib/event-actions';
import type { SubjectOption } from '@/lib/event-queries';

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
};

const input =
  'h-8 w-full rounded border border-line-strong bg-panel px-2 text-fg focus:border-accent';
const label = 'flex flex-col gap-1 text-[13px] font-semibold text-fg';
const primaryBtn =
  'inline-flex items-center gap-[5px] rounded bg-accent-fill px-3 py-[6px] font-semibold text-on-accent hover:bg-accent-fill-hover disabled:opacity-60';

/**
 * Add / edit form of an event. "Kiedy" is three inputs (date, start, end)
 * that the Server Action composes into `DD.MM.RRRR [GG:MM[-GG:MM]]`. Class and
 * group follow the chosen subject. A refusal is shown in place; success
 * redirects from the action.
 */
export function EventForm({
  options,
  base,
  initial,
  eventId,
  cancelHref,
}: {
  options: SubjectOption[];
  base: 'simple' | 'advanced';
  initial: EventFormValues;
  /** Set when editing. */
  eventId?: number;
  cancelHref: string;
}) {
  const [subjectId, setSubjectId] = useState(initial.subjectId);
  const [classId, setClassId] = useState(initial.classId);
  const [groupId, setGroupId] = useState(initial.groupId);
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const subject = options.find((s) => s.id === subjectId);
  const cls = subject?.classes.find((c) => c.id === classId);

  const submit = (fd: FormData) => {
    setError(null);
    start(async () => {
      const r =
        eventId === undefined
          ? await createEventAction(fd)
          : await updateEventAction(eventId, fd);
      // Success redirects; only a refusal comes back.
      if (r && !r.ok) setError(r.message);
    });
  };

  return (
    <form action={submit} className="flex max-w-xl flex-col gap-3.5">
      <input type="hidden" name="base" value={base} />
      <label className={label}>
        Rodzaj
        <select name="kind" defaultValue={initial.kind} className={input}>
          {Object.entries(EVENT_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Tytuł
        <input
          name="title"
          required
          maxLength={100}
          defaultValue={initial.title}
          className={input}
        />
      </label>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <label className={label}>
          Data
          <input
            type="date"
            name="date"
            required
            defaultValue={initial.date}
            className={input}
          />
        </label>
        <label className={label}>
          Od (godz.)
          <input
            type="time"
            name="start"
            defaultValue={initial.start}
            className={input}
          />
        </label>
        <label className={label}>
          Do (godz.)
          <input
            type="time"
            name="end"
            defaultValue={initial.end}
            className={input}
          />
        </label>
      </div>
      <p className="m-0 -mt-2 text-xs text-muted">
        Bez godziny wydarzenie trwa cały dzień.
      </p>
      {eventId === undefined && (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <label className={label}>
            Powtarzaj
            <select
              name="repeat"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              className={input}
            >
              <option value="">nie</option>
              <option value="weekly">co tydzień</option>
              <option value="biweekly">co 2 tygodnie</option>
            </select>
          </label>
          {repeat && (
            <label className={label}>
              do
              <input type="date" name="until" required className={input} />
            </label>
          )}
        </div>
      )}
      {initial.inSeries && (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-[13px] font-semibold text-fg">
            Zastosuj zmiany do
          </legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="one" defaultChecked />
            Tylko to
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="following" />
            To i następne
          </label>
        </fieldset>
      )}
      <label className={label}>
        Przedmiot
        <select
          name="subjectId"
          value={subjectId ?? ''}
          onChange={(e) => {
            setSubjectId(e.target.value ? Number(e.target.value) : null);
            setClassId(null);
            setGroupId(null);
          }}
          className={input}
        >
          <option value="">Bez przedmiotu</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
      </label>
      {subject && subject.classes.length > 0 && (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <label className={label}>
            Zajęcia
            <select
              name="classId"
              value={classId ?? ''}
              onChange={(e) => {
                setClassId(e.target.value ? Number(e.target.value) : null);
                setGroupId(null);
              }}
              className={input}
            >
              <option value="">Wszystkie</option>
              {subject.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {cls && cls.groups.length > 0 && (
            <label className={label}>
              Grupa
              <select
                name="groupId"
                value={groupId ?? ''}
                onChange={(e) =>
                  setGroupId(e.target.value ? Number(e.target.value) : null)
                }
                className={input}
              >
                <option value="">Wszystkie</option>
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
      <label className={label}>
        Miejsce
        <input
          name="place"
          maxLength={100}
          defaultValue={initial.place}
          className={input}
        />
      </label>
      <label className={label}>
        Notatka
        <textarea
          name="note"
          maxLength={1000}
          rows={4}
          defaultValue={initial.note}
          className={`${input} h-auto py-1.5`}
        />
      </label>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg"
        >
          {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryBtn}>
          <FloppyDisk size={15} aria-hidden />
          {eventId === undefined ? 'Dodaj wydarzenie' : 'Zapisz'}
        </button>
        <Link href={cancelHref} className="link">
          Anuluj
        </Link>
      </div>
    </form>
  );
}
