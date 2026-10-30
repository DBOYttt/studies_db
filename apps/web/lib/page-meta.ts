import type { Metadata } from 'next';
import { lecturerLabel, parseSubjectParam } from './admin-pages';
import { parseEntityId } from './entity-page';
import {
  loadEvent,
  loadLecturer,
  loadLecturerAdmin,
  loadSubject,
  loadSubjectAdmin,
} from './page-loaders';
import { currentUser } from './session';
import { isPublicView } from './tables';

/**
 * Page titles (`<title>`, WCAG 2.4.2): the root layout's template turns a
 * page's `title` into `<Page> · Studies DB`. Subject, event and lecturer
 * pages are titled with their name, loaded through the same per-request
 * memoised loaders as the page (`page-loaders.ts`).
 *
 * A page's own metadata is kept when the page calls `notFound()`, so these
 * functions title every page the visitor will get as a 404 (a missing or
 * deleted entity for a student, any admin page for a non-admin, signed out)
 * exactly like the 404 page. They never throw and never call `notFound()`
 * themselves: the page alone decides the response, and a title never tells
 * an existing but hidden entity apart from a missing one.
 */

export const SITE_NAME = 'Studies DB';

/** Root layout: `<Page> · Studies DB`, and the bare name without a title. */
export const ROOT_TITLE = {
  template: `%s · ${SITE_NAME}`,
  default: SITE_NAME,
} as const;

/** The 404 page's title (`app/not-found.tsx`). */
export const NOT_FOUND_TITLE = `Page not found · ${SITE_NAME}`;

/** A page's title: `<page> · Studies DB` (through the root template). */
export const pageTitle = (page: string): Metadata => ({ title: page });

/** The title of a page the visitor gets as a 404. */
const HIDDEN: Metadata = { title: { absolute: NOT_FOUND_TITLE } };

const decoded = (raw: string): string | null => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
};

const EVENT_ID_RE = /^[1-9]\d{0,9}$/;

/**
 * Loads for a title; `name` null means the visitor gets a 404. A failed load
 * (the page shows its own error) gets the plain `fallback` title.
 */
async function titled<T>(
  load: Promise<T | null>,
  name: (row: T) => string | null,
  fallback: string,
): Promise<Metadata> {
  let row: T | null;
  try {
    row = await load;
  } catch {
    return pageTitle(fallback);
  }
  const n = row === null ? null : name(row);
  return n === null ? HIDDEN : pageTitle(n);
}

/** `/subjects/[code]`, `/s/subjects/[code]`: the subject's name. */
export async function subjectMetadata(rawCode: string): Promise<Metadata> {
  if (!(await currentUser())) return HIDDEN;
  const code = decoded(rawCode);
  if (code === null) return HIDDEN;
  return titled(loadSubject(code), (s) => s.name, 'Subject');
}

/**
 * The event pages: the event's title, prefixed for the edit form. A deleted
 * event is only titled for an admin, as only an admin may open its page.
 */
export async function eventMetadata(
  rawId: string,
  edit = false,
): Promise<Metadata> {
  const user = await currentUser();
  if (!user || !EVENT_ID_RE.test(rawId)) return HIDDEN;
  return titled(
    loadEvent(Number(rawId)),
    (ev) =>
      ev.deletedAt !== null && !user.isAdmin
        ? null
        : edit
          ? `Edit ${ev.title}`
          : ev.title,
    edit ? 'Edit event' : 'Event',
  );
}

/** `/lecturers/[id]`: the lecturer's title and name. */
export async function lecturerMetadata(rawId: string): Promise<Metadata> {
  if (!(await currentUser())) return HIDDEN;
  const id = parseEntityId(rawId);
  if (id === null) return HIDDEN;
  return titled(loadLecturer(id), lecturerLabel, 'Lecturer');
}

/** Any admin page: its title for admins, the 404 one for everyone else. */
export async function adminMetadata(page: string): Promise<Metadata> {
  return (await currentUser())?.isAdmin ? pageTitle(page) : HIDDEN;
}

/** `/admin/subjects/[code]`: the subject's name, for admins only. */
export async function adminSubjectMetadata(raw: string): Promise<Metadata> {
  if (!(await currentUser())?.isAdmin) return HIDDEN;
  const code = parseSubjectParam(raw);
  if (code === null) return HIDDEN;
  return titled(
    loadSubjectAdmin(code),
    (s) => `${s.name} · Admin`,
    'Subject · Admin',
  );
}

/** `/admin/lecturers/[id]`: the lecturer's name, for admins only. */
export async function adminLecturerMetadata(raw: string): Promise<Metadata> {
  if (!(await currentUser())?.isAdmin) return HIDDEN;
  const id = parseEntityId(raw);
  if (id === null) return HIDDEN;
  return titled(
    loadLecturerAdmin(id),
    (l) => `${lecturerLabel(l)} · Admin`,
    'Lecturer · Admin',
  );
}

/**
 * Pages titled by their route id alone (`Tag #3`): nothing is loaded, so a
 * title says nothing about the row (a missing one is titled the same).
 * `admin` pages are titled for admins only.
 */
export async function idMetadata(
  label: string,
  rawId: string,
  admin = false,
): Promise<Metadata> {
  const user = await currentUser();
  if (!user || (admin && !user.isAdmin)) return HIDDEN;
  const id = parseEntityId(rawId);
  return id === null
    ? HIDDEN
    : pageTitle(`${label} #${id}${admin ? ' · Admin' : ''}`);
}

/** `/tables/[view]`: the view's name, when it is one of the public views. */
export function viewMetadata(view: string): Metadata {
  return isPublicView(view) ? pageTitle(`View ${view}`) : HIDDEN;
}
