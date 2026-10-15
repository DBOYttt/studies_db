'use server';

import {
  type ActionResult,
  addEvent,
  deleteEvent,
  type EventInput,
  editEvent,
  getEvent,
  linkTopic,
  restoreEvent,
  toWall,
  unlinkTopic,
} from '@studies/db';
import { EVENT_KINDS, type EventKind } from '@studies/db/constants';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { type LinkedTopic, searchTopics } from './event-queries';
import { composeWhen, whenOf } from './event-view';
import { requireAdmin, requireUser } from './session';

/**
 * Server Actions of the event pages. They are reachable by direct POST, so
 * each authenticates (`requireUser`) and validates its arguments itself; the
 * ban check, rules and audit row live in `@studies/db` (`events.ts`).
 */

const isId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

const fail = (message: string): ActionResult => ({ ok: false, message });

type Base = 'simple' | 'advanced';
const baseOf = (form: FormData): Base =>
  form.get('base') === 'advanced' ? 'advanced' : 'simple';
const eventHref = (base: Base, id: number) =>
  base === 'simple' ? `/s/wydarzenia/${id}` : `/wydarzenia/${id}`;
const planHref = (base: Base) => (base === 'simple' ? '/s/plan' : '/plan');

function refresh(id?: number) {
  revalidatePath('/s/plan');
  revalidatePath('/plan');
  if (id !== undefined) {
    revalidatePath(`/s/wydarzenia/${id}`);
    revalidatePath(`/wydarzenia/${id}`);
  }
}

const text = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === 'string' ? v : '';
};
const idOrNull = (form: FormData, k: string): number | null | 'bad' => {
  const v = text(form, k).trim();
  if (!v) return null;
  return /^[1-9]\d{0,9}$/.test(v) ? Number(v) : 'bad';
};

/** The form's fields as an EventInput (with the composed "Kiedy"). */
function readForm(form: FormData): EventInput | ActionResult {
  const kind = text(form, 'kind') as EventKind;
  if (!Object.hasOwn(EVENT_KINDS, kind))
    return fail('Nieznany rodzaj wydarzenia.');
  const subjectId = idOrNull(form, 'subjectId');
  const classId = idOrNull(form, 'classId');
  const groupId = idOrNull(form, 'groupId');
  if (subjectId === 'bad' || classId === 'bad' || groupId === 'bad') {
    return fail('Nieprawidłowy wybór przedmiotu, zajęć lub grupy.');
  }
  const when = composeWhen(
    text(form, 'date'),
    text(form, 'start'),
    text(form, 'end'),
  );
  if (!when.ok) return fail(when.message);
  return {
    kind,
    title: text(form, 'title'),
    subjectId,
    classId,
    groupId,
    when: when.when,
    place: text(form, 'place'),
    note: text(form, 'note'),
  };
}
const isResult = (x: EventInput | ActionResult): x is ActionResult => 'ok' in x;

/** Adds an event and opens its page; returns only a refusal. */
export async function createEventAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const input = readForm(form);
  if (isResult(input)) return input;
  const r = await addEvent(getDb(), user.id, input, 'web');
  if (!r.ok || r.id === undefined) return r;
  refresh(r.id);
  redirect(eventHref(baseOf(form), r.id));
}

/** Saves an edit and returns to the event page; returns only a refusal. */
export async function updateEventAction(
  id: number,
  form: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id)) return fail('Nie znaleziono wydarzenia.');
  const input = readForm(form);
  if (isResult(input)) return input;
  const db = getDb();
  const cur = await getEvent(db, id);
  const patch: Partial<EventInput> = { ...input };
  // An unchanged "Kiedy" is left out, so an old event stays editable.
  if (
    cur &&
    input.when ===
      whenOf(
        toWall(cur.startsAt),
        cur.endsAt ? toWall(cur.endsAt) : null,
        cur.allDay,
      )
  ) {
    delete patch.when;
  }
  const r = await editEvent(db, user.id, id, patch, 'web');
  if (!r.ok) return r;
  refresh(id);
  redirect(eventHref(baseOf(form), id));
}

export async function deleteEventAction(
  id: number,
  base: Base = 'simple',
): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id)) return fail('Nie znaleziono wydarzenia.');
  const r = await deleteEvent(getDb(), user.id, id, 'web');
  if (!r.ok) return r;
  refresh(id);
  redirect(planHref(base === 'advanced' ? 'advanced' : 'simple'));
}

/** Admin only (404 for everyone else). */
export async function restoreEventAction(id: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!isId(id)) return fail('Nie znaleziono wydarzenia.');
  const r = await restoreEvent(getDb(), admin.id, id, 'web');
  if (r.ok) refresh(id);
  return r;
}

export async function linkTopicAction(
  id: number,
  topicId: number,
): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id) || !isId(topicId)) return fail('Nie znaleziono posta.');
  const r = await linkTopic(getDb(), user.id, id, topicId, 'web');
  if (r.ok) refresh(id);
  return r;
}

export async function unlinkTopicAction(
  id: number,
  topicId: number,
): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id) || !isId(topicId)) return fail('Nie znaleziono posta.');
  const r = await unlinkTopic(getDb(), user.id, id, topicId, 'web');
  if (r.ok) refresh(id);
  return r;
}

/** Up to 20 posts by title (within the subject when given). */
export async function searchTopicsAction(
  subjectId: number | null,
  q: string,
): Promise<LinkedTopic[]> {
  await requireUser();
  if (subjectId !== null && !isId(subjectId)) return [];
  if (typeof q !== 'string') return [];
  return searchTopics(getDb(), subjectId, q);
}
