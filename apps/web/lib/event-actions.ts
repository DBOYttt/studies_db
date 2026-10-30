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
import { EVENT_NOT_FOUND } from '@studies/db/text';
import { asc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { invalidateCounts } from './count-cache';
import { getDb, getViewsPool } from './db';
import { withEventField } from './event-fields';
import { type LinkedTopic, searchTopics } from './event-queries';
import { composeWhen, whenOf } from './event-view';
import { withNotice } from './notices';
import { nowWall } from './plan';
import { requireAdmin, requireUser } from './session';
import { type SessionOption, upcomingSessionOptions } from './session-options';
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
/** The event page with the "Event saved." banner. */
const savedHref = (base: Base, id: number) =>
  withNotice(eventHref(base, id), 'event-saved');

function refresh(id?: number) {
  invalidateCounts();
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

/** The form's fields as an EventInput (with the composed "When"). */
function readForm(form: FormData): EventInput | ActionResult {
  const kind = text(form, 'kind') as EventKind;
  if (!Object.hasOwn(EVENT_KINDS, kind)) return fail('Unknown event type.');
  const subjectId = idOrNull(form, 'subjectId');
  const classId = idOrNull(form, 'classId');
  const groupId = idOrNull(form, 'groupId');
  if (subjectId === 'bad' || classId === 'bad' || groupId === 'bad') {
    return fail('Invalid subject, class or group selection.');
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

/** A refusal of the event form, with the input it is about (if any). */
export type EventFormResult = ActionResult & { field?: string };

/**
 * Adds an event (or a series) and opens its page; returns only a refusal,
 * naming the input it is about when it is about one.
 */
export async function createEventAction(
  form: FormData,
): Promise<EventFormResult> {
  return withEventField(await createEvent(form), form);
}

async function createEvent(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const input = readForm(form);
  if (isResult(input)) return input;
  const repeat = text(form, 'repeat');
  if (repeat && repeat !== 'weekly' && repeat !== 'biweekly') {
    return fail('Unknown repeat rule.');
  }
  if (repeat === 'weekly' || repeat === 'biweekly') {
    const until = text(form, 'until').trim();
    if (!until) return fail('Enter the date until which the event repeats.');
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
      first ? savedHref(baseOf(form), first.id) : planHref(baseOf(form)),
    );
  }
  const r = await addEvent(getDb(), user.id, input, 'web');
  if (!r.ok || r.id === undefined) return r;
  refresh(r.id);
  redirect(savedHref(baseOf(form), r.id));
}

/** Saves an edit and returns to the event page; returns only a refusal. */
export async function updateEventAction(
  id: number,
  form: FormData,
): Promise<EventFormResult> {
  return withEventField(await updateEvent(id, form), form);
}

async function updateEvent(id: number, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id)) return fail(EVENT_NOT_FOUND);
  const input = readForm(form);
  if (isResult(input)) return input;
  const db = getDb();
  const cur = await getEvent(db, id);
  const patch: Partial<EventInput> = { ...input };
  // An unchanged "When" is left out, so an old event stays editable.
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
  redirect(savedHref(baseOf(form), id));
}

export async function deleteEventAction(
  id: number,
  base: Base = 'simple',
  scope: 'one' | 'following' = 'one',
  version?: number,
): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id)) return fail(EVENT_NOT_FOUND);
  const r = await deleteEvent(getDb(), user.id, id, 'web', scopeOf(scope), {
    expectedVersion:
      typeof version === 'number' &&
      Number.isSafeInteger(version) &&
      version >= 0
        ? version
        : undefined,
  });
  const plan = withNotice(
    planHref(base === 'advanced' ? 'advanced' : 'simple'),
    'event-deleted',
  );
  if (!r.ok) {
    // Already gone (the second click of a double click, a stale tab): the
    // user wanted it deleted, so this is not an error. A row that never
    // existed reads the same, so the answer reveals nothing.
    const ev = await getEvent(getDb(), id);
    if (!ev || ev.deletedAt !== null) redirect(plan);
    return r;
  }
  refresh(id);
  redirect(plan);
}

/**
 * Admin only (404 for everyone else). From the event page it reopens that
 * page with "Event restored." and returns only a refusal. From the edit
 * form (`from = 'edit'`) it returns the result instead: a redirect would
 * remount the form and drop what the admin typed, so the form says it.
 */
export async function restoreEventAction(
  id: number,
  base: Base = 'simple',
  from: 'event' | 'edit' = 'event',
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!isId(id)) return fail(EVENT_NOT_FOUND);
  const b: Base = base === 'advanced' ? 'advanced' : 'simple';
  const r = await restoreEvent(getDb(), admin.id, id, 'web');
  if (r.ok) refresh(id);
  if (from === 'edit') return r;
  if (!r.ok) {
    // Already live again (a double click, another admin): the wanted state.
    const ev = await getEvent(getDb(), id);
    if (!ev || ev.deletedAt !== null) return r;
  }
  redirect(withNotice(eventHref(b, id), 'event-restored'));
}

export async function linkTopicAction(
  id: number,
  topicId: number,
): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id) || !isId(topicId)) return fail('Post not found.');
  const r = await linkTopic(getDb(), user.id, id, topicId, 'web');
  if (r.ok) refresh(id);
  return r;
}

export async function unlinkTopicAction(
  id: number,
  topicId: number,
): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id) || !isId(topicId)) return fail('Post not found.');
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
 * "Try again": requeues the event's failed uploads whose files remain.
 * Like every event action it follows the wiki rules: any logged-in student may
 * retry, and all failed rows of the event are requeued, not just their own.
 */
export async function retryUploadsAction(id: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id)) return fail(EVENT_NOT_FOUND);
  const r = await retryFailedUploads(getDb(), user.id, id, uploadFileExists);
  if (r.ok) refresh(id);
  return r;
}

/**
 * "Try again" for the Discord post: queues its upsert again (the
 * series' post for an occurrence). Same wiki rules as every event action.
 */
export async function retryPostAction(id: number): Promise<ActionResult> {
  const user = await requireUser();
  if (!isId(id)) return fail(EVENT_NOT_FOUND);
  const r = await retryEventPost(getDb(), user.id, id, 'web');
  if (r.ok) refresh(id);
  return r;
}

/**
 * "Pick a session" of the form after the class or group changed: the next
 * confirmed class sessions (read-only pool). Empty for malformed ids.
 */
export async function sessionOptionsAction(
  classId: number,
  groupId: number | null,
): Promise<SessionOption[]> {
  await requireUser();
  if (!isId(classId) || (groupId !== null && !isId(groupId))) return [];
  return upcomingSessionOptions(getViewsPool(), classId, groupId, nowWall());
}
