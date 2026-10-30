import type { PublicView } from '@studies/db/constants';
import { getDb, getViewsPool } from './db';
import type { NavSubject } from './nav-tree';
import { getNavSubjects } from './queries';
import { listPresentSemesters } from './semester';
import { listSubjectCards, type SubjectCard } from './simple-queries';
import { countViewRows } from './tables';
import { type TtlCache, ttlCache } from './ttl-cache';

/**
 * The advanced layout's nav counts (file counts per subject/class/group and
 * the row count of every public view) and the simple mode's subject cards
 * (file count and last upload per subject) aggregate whole tables on every
 * page load; the semesters that have subjects (the semester switcher) are
 * read on every page too. They are kept in-process for COUNTS_TTL_MS.
 *
 * Staleness: writes made through this web process (event and entry quiz
 * actions, the admin SQL console) call invalidateCounts(), so the user who
 * made them sees them at once. Files the bot ingests and changes the bot
 * makes show up in these counts within COUNTS_TTL_MS. The lists themselves
 * (files, events, timetable) are never cached.
 */
export const COUNTS_TTL_MS = 60_000;

type Caches = {
  nav: TtlCache<NavSubject[]>;
  views: TtlCache<Record<PublicView, number> | null>;
  cards: TtlCache<SubjectCard[]>;
  present: TtlCache<number[] | null>;
};

// On globalThis, like the DB pools, so every route bundle and dev reload
// shares one set of caches.
const g = globalThis as typeof globalThis & { __studiesCounts?: Caches };
g.__studiesCounts ??= {
  nav: ttlCache(COUNTS_TTL_MS, () => getNavSubjects(getDb())),
  views: ttlCache(
    COUNTS_TTL_MS,
    async () => {
      try {
        return await countViewRows(getViewsPool());
      } catch {
        return null; // e.g. DATABASE_RO_URL missing: no counts
      }
    },
    // A failed count (null) is retried on the next page load.
    { keep: (v) => v !== null },
  ),
  cards: ttlCache(COUNTS_TTL_MS, () => listSubjectCards(getDb())),
  present: presentCache(),
};
// A process that created the caches before `present` existed (dev reload).
g.__studiesCounts.present ??= presentCache();
const caches = g.__studiesCounts;

/** Semesters that have subjects (the switcher's entries). */
function presentCache(): TtlCache<number[] | null> {
  return ttlCache(
    COUNTS_TTL_MS,
    async () => {
      try {
        return await listPresentSemesters(getViewsPool());
      } catch {
        return null; // no RO pool or a failed query: no switcher
      }
    },
    { keep: (v) => v !== null },
  );
}

/** Cached for all semesters; a chosen semester filters the cached list. */
export const cachedNavSubjects = async (
  semester?: number | null,
): Promise<NavSubject[]> => {
  const all = await caches.nav.get();
  return semester == null ? all : all.filter((s) => s.semester === semester);
};
export const cachedViewCounts = () => caches.views.get();
/** The semesters that have subjects; `[]` when they cannot be read. */
export const cachedPresentSemesters = async (): Promise<number[]> =>
  (await caches.present.get()) ?? [];
export const cachedSubjectCards = async (
  semester?: number | null,
): Promise<SubjectCard[]> => {
  const all = await caches.cards.get();
  return semester == null ? all : all.filter((s) => s.semester === semester);
};

/** Drops every cached count; call after a write made through the web. */
export function invalidateCounts(): void {
  caches.nav.invalidate();
  caches.views.invalidate();
  caches.cards.invalidate();
  caches.present.invalidate();
}
