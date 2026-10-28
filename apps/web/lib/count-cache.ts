import type { PublicView } from '@studies/db/constants';
import { getDb, getRoPool } from './db';
import type { NavSubject } from './nav-tree';
import { getNavSubjects } from './queries';
import { listSubjectCards, type SubjectCard } from './simple-queries';
import { countViewRows } from './tables';
import { type TtlCache, ttlCache } from './ttl-cache';

/**
 * The advanced layout's nav counts (file counts per subject/class/group and
 * the row count of every public view) and the simple mode's subject cards
 * (file count and last upload per subject) aggregate whole tables on every
 * page load. They are kept in-process for COUNTS_TTL_MS.
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
        return await countViewRows(getRoPool());
      } catch {
        return null; // e.g. DATABASE_RO_URL missing: no counts
      }
    },
    // A failed count (null) is retried on the next page load.
    { keep: (v) => v !== null },
  ),
  cards: ttlCache(COUNTS_TTL_MS, () => listSubjectCards(getDb())),
};
const caches = g.__studiesCounts;

export const cachedNavSubjects = () => caches.nav.get();
export const cachedViewCounts = () => caches.views.get();
export const cachedSubjectCards = () => caches.cards.get();

/** Drops every cached count; call after a write made through the web. */
export function invalidateCounts(): void {
  caches.nav.invalidate();
  caches.views.invalidate();
  caches.cards.invalidate();
}
