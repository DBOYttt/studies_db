import { getEvent, getLecturerAdmin, getSubjectAdmin } from '@studies/db';
import { cache } from 'react';
import { getDb, getViewsPool } from './db';
import { getLecturer } from './entity-queries';
import { getSubject } from './queries';

/**
 * Entity loaders memoised per request (React `cache`), shared by a page and
 * its `generateMetadata` (`page-meta.ts`), so the title costs no second
 * query. Outside a request (tests) they are plain calls.
 */

/** The subject of `/subjects/[code]` and `/s/subjects/[code]` (decoded code). */
export const loadSubject = cache((code: string) => getSubject(getDb(), code));

/** The event of the event pages (live or deleted; the caller checks). */
export const loadEvent = cache((id: number) => getEvent(getDb(), id));

/** The lecturer of `/lecturers/[id]` (from the views, as the page reads it). */
export const loadLecturer = cache((id: number) =>
  getLecturer(getViewsPool(), id),
);

export const loadSubjectAdmin = cache((code: string) =>
  getSubjectAdmin(getDb(), code),
);

export const loadLecturerAdmin = cache((id: number) =>
  getLecturerAdmin(getDb(), id),
);
