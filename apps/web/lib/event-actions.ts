'use server';

import {
  type ActionResult,
  addEvent,
  addSeries,
  deleteEvent,
  type EventInput,
  editEvent,
  events,
  getEvent,
  linkTopic,
  restoreEvent,
  retryEventPost,
  retryFailedUploads,
  toWall,
  unlinkTopic,
} from '@studies/db';
import { EVENT_KINDS, type EventKind } from '@studies/db/constants';
import { asc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { type LinkedTopic, searchTopics } from './event-queries';
import { composeWhen, whenOf } from './event-view';
import { requireAdmin, requireUser } from './session';
import { uploadFileExists } from './storage';

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

/** Version the form was loaded with; absent or malformed means no check. */
const versionOf = (v: unknown): number | undefined => {
  const t = typeof v === 'string' ? v.trim() : '';
  return /^\d{1,9}$/.test(t) ? Number(t) : undefined;
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

const scopeOf = (v: unknown): 'one' | 'following' =>
  v === 'following' ? 'following' : 'one';

/** Adds an event (or a series) and opens its page; returns only a refusal. */
export async function createEventAction(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const input = readForm(form);
  if (isResult(input)) return input;
  const repeat = text(form, 'repeat');
  if (repeat && repeat !== 'weekly' && repeat !== 'biweekly') {
    return fail('Nieznana reguła powtarzania.');
  }
  if (repeat === 'weekly' || repeat === 'biweekly') {
    const until = text(form, 'until').trim();
    if (!until) return fail('Podaj, do kiedy powtarzać wydarzenie.');
    const s = await addSeries(
      getDb(),
      user.id,
      { ...input, rule: repeat, until },
      'web',
    );
    if (!s.ok || s.id === undefined) return s;
    const [first] = await getDb()
      .select({ id: events.id })
      .from(events)
      .where(eq(events.seriesId, s.id))
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(1);
    refresh(first?.id);
    redirect(
      first ? eventHref(baseOf(form), first.id) : planHref(baseOf(form)),
    );
  }
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
  const r = await editEvent(
    db,
    user.id,
    id,
    patch,
    'web',
    scopeOf(text(form, 'scope')),
    { expectedVersion: versionOf(form.get('version')) },
  );
  if (!r.ok) return r;
  refresh(id);
  redirect(eventHref(baseOf(form), id));
}

export async function deleteEventAction(
  id: number,
  base: Base = 'simple',
  scope: 'one' | 'following' = 'one',
  version?: number,
): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id)) return fail('Nie znaleziono wydarzenia.');
  const r = await deleteEvent(getDb(), user.id, id, 'web', scopeOf(scope), {
    expectedVersion:
      typeof version === 'number' &&
      Number.isSafeInteger(version) &&
      version >= 0
        ? version
        : undefined,
  });
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

/**
 * "Spróbuj ponownie": requeues the event's failed uploads whose files remain.
 * Like every event action it follows the wiki rules: any logged-in student may
 * retry, and all failed rows of the event are requeued, not just their own.
 */
export async function retryUploadsAction(id: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id)) return fail('Nie znaleziono wydarzenia.');
  const r = await retryFailedUploads(getDb(), user.id, id, uploadFileExists);
  if (r.ok) refresh(id);
  return r;
}

/**
 * "Spróbuj ponownie" for the Discord post: queues its upsert again (the
 * series' post for an occurrence). Same wiki rules as every event action.
 */
export async function retryPostAction(id: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id)) return fail('Nie znaleziono wydarzenia.');
  const r = await retryEventPost(getDb(), user.id, id, 'web');
  if (r.ok) refresh(id);
  return r;
}
