import {
  type Db,
  type FeedStats,
  feedAllowedHosts,
  fetchTimetable,
  getPlanSyncStatus,
  listFeeds,
  type PlanSyncStatus,
  recordPlanSync,
  removeUnownedSessions,
  SafeSyncError,
  type SyncStats,
  syncTimetable,
  validateFeedUrl,
} from '@studies/db';

export { fetchTimetable, SafeSyncError };

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_POLL_MS = 60_000;

// The URL is a secret: only the host may ever appear in messages or logs.
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown host';
  }
}

export function planSyncDue(
  s: PlanSyncStatus,
  now: Date,
  intervalMs: number,
): boolean {
  if (s.lastRunAt === null) return true;
  if (now.getTime() - s.lastRunAt.getTime() >= intervalMs) return true;
  return s.requestedAt !== null && s.requestedAt > s.lastRunAt;
}

function scrub(message: string, ...urls: (string | undefined)[]): string {
  let out = message;
  for (const url of urls) if (url) out = out.split(url).join(hostOf(url));
  return out.replace(/https?:\/\/\S+/gi, (m) => hostOf(m));
}

function addStats(a: SyncStats, b: SyncStats): SyncStats {
  return {
    created: a.created + b.created,
    updated: a.updated + b.updated,
    deleted: a.deleted + b.deleted,
    unchanged: a.unchanged + b.unchanged,
    warnings: [...a.warnings, ...b.warnings],
  };
}

let noSourceLogged = false;

/** Test helper: lets the "no sources" notice be logged again. */
export function resetNoSourceLog(): void {
  noSourceLogged = false;
}

function refusal(check: { ok: false; error: string }): string {
  return check.error.startsWith('Only links on')
    ? 'host not allowed'
    : 'link not allowed';
}

/**
 * Syncs every stored semester feed (class feed, then its exam feed). Returns
 * what to record; a failure in one semester never stops the others.
 */
async function runStoredFeeds(
  deps: {
    db: Db;
    env: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  },
  feeds: Awaited<ReturnType<typeof listFeeds>>,
  secrets: (string | undefined)[],
): Promise<{ stats: SyncStats | null; errors: string[] }> {
  const allowed = feedAllowedHosts(deps.env);
  const errors: string[] = [];
  const perFeed: FeedStats[] = [];
  let total: SyncStats | null = null;
  let allOk = true;

  const fail = (label: string, err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    const error = scrub(raw, ...secrets);
    console.error(`Plan: błąd synchronizacji (${label}): ${error}`);
    errors.push(`${label}: ${error}`);
  };

  for (const feed of feeds) {
    const label = `Semester ${feed.semester}`;
    const entry: FeedStats = {
      semester: feed.semester,
      ok: false,
      created: 0,
      updated: 0,
      deleted: 0,
    };
    perFeed.push(entry);
    const check = validateFeedUrl(feed.classUrl, allowed);
    if (!check.ok) {
      allOk = false;
      const msg = refusal(check);
      console.error(`Plan: ${label}: ${msg}`);
      errors.push(`${label}: ${msg}`);
    } else {
      console.log(`Plan: ${label} z ${check.host}…`);
      try {
        const ics = await fetchTimetable(feed.classUrl, {
          fetchImpl: deps.fetchImpl,
        });
        const st = await syncTimetable(deps.db, ics, {
          feedSemester: feed.semester,
        });
        console.log(
          `Plan: ${label} +${st.created} ~${st.updated} -${st.deleted}`,
        );
        entry.ok = true;
        entry.created = st.created;
        entry.updated = st.updated;
        entry.deleted = st.deleted;
        total = total ? addStats(total, st) : st;
      } catch (err) {
        allOk = false;
        fail(label, err);
      }
    }

    if (feed.examUrl) {
      const examCheck = validateFeedUrl(feed.examUrl, allowed);
      const examLabel = `${label} exam timetable`;
      if (!examCheck.ok) {
        const msg = refusal(examCheck);
        console.error(`Plan: ${examLabel}: ${msg}`);
        errors.push(`${examLabel}: ${msg}`);
      } else {
        console.log(`Plan: egzaminy ${label} z ${examCheck.host}…`);
        try {
          const ics = await fetchTimetable(feed.examUrl, {
            fetchImpl: deps.fetchImpl,
          });
          const st = await syncTimetable(deps.db, ics, {
            allExams: true,
            source: 'exams',
            feedSemester: feed.semester,
          });
          console.log(
            `Plan: egzaminy ${label} +${st.created} ~${st.updated} -${st.deleted}`,
          );
          // Exam stats count only next to a successful class sync.
          if (entry.ok) {
            entry.created += st.created;
            entry.updated += st.updated;
            entry.deleted += st.deleted;
            if (total) total = addStats(total, st);
          }
        } catch (err) {
          fail(examLabel, err);
        }
      }
    }
  }

  if (allOk) {
    try {
      const n = await removeUnownedSessions(
        deps.db,
        feeds.map((f) => f.semester),
      );
      if (n > 0) console.log(`Plan: usunięto ${n} sesji bez semestru`);
    } catch (err) {
      fail('Cleanup', err);
    }
  }

  return {
    stats: total ? { ...total, feeds: perFeed } : null,
    errors,
  };
}

export async function runPlanSyncOnce(deps: {
  db: Db;
  url?: string;
  /** Optional UniTime exam feed (UNITIME_EXAM_ICAL_URL); every entry is an exam. */
  examUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;
  const feeds = await listFeeds(deps.db);
  if (feeds.length === 0 && !deps.url) {
    if (!noSourceLogged) {
      noSourceLogged = true;
      console.log('Plan: brak źródeł planu — pomijam');
    }
    return;
  }
  const secrets = [
    deps.url,
    deps.examUrl,
    ...feeds.flatMap((f) => [f.classUrl, f.examUrl ?? undefined]),
  ];
  // Recorded as the run time: a request made while the sync runs is newer
  // than this and so still counts as pending.
  const startedAt = now();
  const errors: string[] = [];
  let stats: SyncStats | null = null;

  if (feeds.length > 0) {
    const r = await runStoredFeeds(
      { db: deps.db, env, fetchImpl: deps.fetchImpl },
      feeds,
      secrets,
    );
    stats = r.stats;
    errors.push(...r.errors);
  } else if (deps.url) {
    console.log(`Plan: synchronizacja z ${hostOf(deps.url)}…`);
    try {
      const ics = await fetchTimetable(deps.url, { fetchImpl: deps.fetchImpl });
      stats = await syncTimetable(deps.db, ics);
      console.log(
        `Plan: +${stats.created} ~${stats.updated} -${stats.deleted}`,
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const error = scrub(raw, ...secrets);
      console.error(`Plan: błąd synchronizacji: ${error}`);
      errors.push(error);
    }
  }

  // The env exam feed runs after the env class feed, and its failure never
  // undoes the class sync: both outcomes are recorded below.
  if (feeds.length === 0 && deps.examUrl) {
    console.log(`Plan: egzaminy z ${hostOf(deps.examUrl)}…`);
    try {
      const ics = await fetchTimetable(deps.examUrl, {
        fetchImpl: deps.fetchImpl,
      });
      const examStats = await syncTimetable(deps.db, ics, {
        allExams: true,
        source: 'exams',
      });
      console.log(
        `Plan: egzaminy +${examStats.created} ~${examStats.updated} -${examStats.deleted}`,
      );
      // Exam stats count only next to a successful class sync.
      if (stats) stats = addStats(stats, examStats);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const error = scrub(raw, ...secrets);
      console.error(`Plan: błąd synchronizacji egzaminów: ${error}`);
      errors.push(`Exam timetable: ${error}`);
    }
  }

  try {
    // A class-feed success is recorded first (last OK time and stats), then
    // any failure on top of it, so the status shows both.
    if (stats)
      await recordPlanSync(deps.db, { at: startedAt, ok: true, stats });
    if (errors.length > 0)
      await recordPlanSync(deps.db, {
        at: startedAt,
        ok: false,
        error: errors.join('; '),
      });
  } catch (e) {
    console.error(
      `Plan: nie zapisano statusu: ${e instanceof Error ? scrub(e.message, ...secrets) : 'błąd'}`,
    );
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

export async function startPlanSyncLoop(deps: {
  db: Db;
  url: string | undefined;
  examUrl?: string | undefined;
  signal: AbortSignal;
  intervalMs?: number;
  pollMs?: number;
}): Promise<void> {
  // No early exit without an env URL: feeds may be added in the admin panel.
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  while (!deps.signal.aborted) {
    try {
      const status = await getPlanSyncStatus(deps.db);
      if (planSyncDue(status, new Date(), intervalMs)) {
        await runPlanSyncOnce({
          db: deps.db,
          url: deps.url,
          examUrl: deps.examUrl,
        });
      }
    } catch (err) {
      console.error(
        `Plan: błąd pętli: ${err instanceof Error ? scrub(err.message, deps.url, deps.examUrl) : 'błąd'}`,
      );
    }
    await sleep(pollMs, deps.signal);
  }
}
