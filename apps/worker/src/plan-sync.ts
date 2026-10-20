import {
  type Db,
  getPlanSyncStatus,
  type PlanSyncStatus,
  recordPlanSync,
  syncTimetable,
} from '@studies/db';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
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

/**
 * A fetch failure whose message we wrote ourselves and that names only the
 * host, so it may be shown to users (`/plan sync`, admin panel) as is.
 * Any other error may embed the URL and is replaced by a generic message.
 */
export class SafeSyncError extends Error {
  override name = 'SafeSyncError';
}

export async function fetchTimetable(
  url: string,
  o: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const host = hostOf(url);
  const maxBytes = o.maxBytes ?? DEFAULT_MAX_BYTES;
  const doFetch = o.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { signal, redirect: 'follow' });
    if (res.status >= 400)
      throw new SafeSyncError(`HTTP ${res.status} from ${host}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.toLowerCase().includes('text/calendar')) {
      throw new SafeSyncError(
        `Unexpected response type (${type || 'none'}) from ${host}`,
      );
    }
    if (!res.body) throw new SafeSyncError(`Empty response from ${host}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new SafeSyncError(`The response from ${host} is too large`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (err) {
    if (signal.aborted)
      throw new SafeSyncError(`Timed out waiting for ${host}`);
    // Only our own host-only messages pass through; anything else may embed the URL.
    if (err instanceof SafeSyncError) throw err;
    throw new SafeSyncError(`Could not download the timetable from ${host}`);
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

function scrub(message: string, url: string): string {
  return message
    .split(url)
    .join(hostOf(url))
    .replace(/https?:\/\/\S+/gi, (m) => hostOf(m));
}

export async function runPlanSyncOnce(deps: {
  db: Db;
  url: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const host = hostOf(deps.url);
  // Recorded as the run time: a request made while the sync runs is newer
  // than this and so still counts as pending.
  const startedAt = now();
  console.log(`Plan: synchronizacja z ${host}…`);
  try {
    const ics = await fetchTimetable(deps.url, { fetchImpl: deps.fetchImpl });
    const stats = await syncTimetable(deps.db, ics);
    await recordPlanSync(deps.db, { at: startedAt, ok: true, stats });
    console.log(`Plan: +${stats.created} ~${stats.updated} -${stats.deleted}`);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const error = scrub(raw, deps.url);
    console.error(`Plan: błąd synchronizacji: ${error}`);
    try {
      await recordPlanSync(deps.db, { at: startedAt, ok: false, error });
    } catch (e) {
      console.error(
        `Plan: nie zapisano statusu: ${e instanceof Error ? scrub(e.message, deps.url) : 'błąd'}`,
      );
    }
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
  signal: AbortSignal;
  intervalMs?: number;
  pollMs?: number;
}): Promise<void> {
  if (!deps.url) {
    console.log(
      'Plan: UNITIME_ICAL_URL nie ustawiony — synchronizacja wyłączona',
    );
    return;
  }
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  while (!deps.signal.aborted) {
    try {
      const status = await getPlanSyncStatus(deps.db);
      if (planSyncDue(status, new Date(), intervalMs)) {
        await runPlanSyncOnce({ db: deps.db, url: deps.url });
      }
    } catch (err) {
      console.error(
        `Plan: błąd pętli: ${err instanceof Error ? scrub(err.message, deps.url) : 'błąd'}`,
      );
    }
    await sleep(pollMs, deps.signal);
  }
}
