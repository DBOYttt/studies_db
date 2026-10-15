import { getEvent, toWall } from '@studies/db';
import type { EventKind } from '@studies/db/constants';
import { EVENT_KINDS } from '@studies/db/constants';
import { notFound } from 'next/navigation';
import type { EventFormValues } from '@/components/events/EventForm';
import { getDb } from './db';
import { formWhen } from './event-view';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  typeof v === 'string' ? v : '';

/** Defaults of the add form from `?subject=<id>&date=YYYY-MM-DD&kind=`. */
export function newEventDefaults(sp: SP): EventFormValues {
  const subject = one(sp.subject);
  const date = one(sp.date);
  const kind = one(sp.kind);
  return {
    kind: Object.hasOwn(EVENT_KINDS, kind) ? (kind as EventKind) : 'kolokwium',
    title: '',
    subjectId: /^[1-9]\d{0,9}$/.test(subject) ? Number(subject) : null,
    classId: null,
    groupId: null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    start: '',
    end: '',
    place: '',
    note: '',
  };
}

/** Current values of a live event for the edit form; 404 if missing/deleted. */
export async function loadEventForm(id: number): Promise<EventFormValues> {
  const ev = await getEvent(getDb(), id);
  if (!ev || ev.deletedAt !== null) notFound();
  const w = formWhen(
    toWall(ev.startsAt),
    ev.endsAt ? toWall(ev.endsAt) : null,
    ev.allDay,
  );
  return {
    kind: ev.kind,
    title: ev.title,
    subjectId: ev.subjectId,
    classId: ev.classId,
    groupId: ev.groupId,
    ...w,
    place: ev.place ?? '',
    note: ev.note ?? '',
  };
}
