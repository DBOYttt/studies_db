import { getEvent, toWall } from '@studies/db';
import type { EventKind } from '@studies/db/constants';
import { EVENT_KINDS } from '@studies/db/constants';
import { notFound } from 'next/navigation';
import type { EventFormValues } from '@/components/events/EventForm';
import { getDb, getViewsPool } from './db';
import { formWhen } from './event-view';
import { nowWall } from './plan';
import {
  getSessionOption,
  type SessionOption,
  upcomingSessionOptions,
} from './session-options';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  typeof v === 'string' ? v : '';
const idOf = (v: string | string[] | undefined): number | null => {
  const t = one(v);
  return /^[1-9]\d{0,9}$/.test(t) ? Number(t) : null;
};

/**
 * Defaults of the add form from
 * `?subject=<id>&class=<id>&group=<id>&date=YYYY-MM-DD&kind=&title=`
 * (the timetable's "Add test" suggests a title).
 */
export function newEventDefaults(sp: SP): EventFormValues {
  const date = one(sp.date);
  const kind = one(sp.kind);
  const subjectId = idOf(sp.subject);
  const classId = subjectId === null ? null : idOf(sp.class);
  return {
    kind: Object.hasOwn(EVENT_KINDS, kind) ? (kind as EventKind) : 'kolokwium',
    title: one(sp.title).trim().slice(0, 100),
    subjectId,
    classId,
    groupId: classId === null ? null : idOf(sp.group),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    start: '',
    end: '',
    place: '',
    note: '',
  };
}

/** Heading and crumb of the add form: "Add test" when the link asks for one. */
export function newEventHeading(sp: SP): 'Add test' | 'Add event' {
  return one(sp.kind) === 'kolokwium' ? 'Add test' : 'Add event';
}

/**
 * The add form: `newEventDefaults`, and with `?session=<id>` (the timetable's
 * "Add test") that session's subject, class, group, date, time and room.
 * `sessions` are the "Pick a session" options of the initial class/group
 * (the picked session first if it already started).
 */
export async function loadNewEventForm(
  sp: SP,
): Promise<{ initial: EventFormValues; sessions: SessionOption[] }> {
  const initial = newEventDefaults(sp);
  const pool = getViewsPool();
  const sessionId = idOf(sp.session);
  const picked =
    sessionId === null ? null : await getSessionOption(pool, sessionId);
  if (picked) {
    Object.assign(initial, {
      subjectId: picked.subjectId,
      classId: picked.classId,
      groupId: picked.groupId,
      date: picked.date,
      start: picked.from,
      end: picked.to,
      place: picked.room ?? '',
      sessionId: picked.value,
    });
  }
  if (initial.classId === null) return { initial, sessions: [] };
  const sessions = await upcomingSessionOptions(
    pool,
    initial.classId,
    initial.groupId,
    nowWall(),
  );
  if (picked && !sessions.some((o) => o.value === picked.value)) {
    const { subjectId, classId, groupId, ...option } = picked;
    sessions.unshift(option);
  }
  return { initial, sessions };
}

/**
 * Current values of an event for the edit form; 404 if it does not exist. A
 * soft-deleted event comes back with `deleted: true` (and its own values) so
 * the page can explain instead of 404-ing.
 */
export async function loadEventForm(
  id: number,
): Promise<{ values: EventFormValues; deleted: boolean }> {
  const ev = await getEvent(getDb(), id);
  if (!ev) notFound();
  const w = formWhen(
    toWall(ev.startsAt),
    ev.endsAt ? toWall(ev.endsAt) : null,
    ev.allDay,
  );
  const values: EventFormValues = {
    kind: ev.kind,
    title: ev.title,
    subjectId: ev.subjectId,
    classId: ev.classId,
    groupId: ev.groupId,
    ...w,
    place: ev.place ?? '',
    note: ev.note ?? '',
    inSeries: ev.series !== null,
    version: ev.version,
  };
  return { values, deleted: ev.deletedAt !== null };
}
