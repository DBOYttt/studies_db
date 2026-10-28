const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

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

const MAX_REDIRECTS = 5;

/**
 * Follows redirects by hand, and only on the same host without a downgrade
 * from https to http: the feed must not be able to send the worker to an
 * internal or plain-HTTP address.
 */
async function fetchSameHost(
  doFetch: typeof fetch,
  url: string,
  signal: AbortSignal,
  host: string,
): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    const res = await doFetch(current, { signal, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS)
      throw new SafeSyncError(`Too many redirects from ${host}`);
    const next = new URL(location, current);
    const downgrade =
      current.protocol === 'https:' && next.protocol !== 'https:';
    if (
      next.host !== current.host ||
      downgrade ||
      !['http:', 'https:'].includes(next.protocol)
    )
      throw new SafeSyncError(`${host} redirected to another host`);
    current = next;
  }
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
    const res = await fetchSameHost(doFetch, url, signal, host);
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

/** Largest calendar a user may import (link or upload). */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 15_000;
const IMPORT_URL_MAX = 500;
const DEFAULT_IMPORT_HOST = 'plan.agh.edu.pl';

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Hosts a user may import a personal calendar from: UNITIME_IMPORT_HOSTS
 * (default plan.agh.edu.pl) first, then the hosts of the configured feeds.
 */
export function importAllowedHosts(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = (env.UNITIME_IMPORT_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const hosts = [
    ...(configured.length > 0 ? configured : [DEFAULT_IMPORT_HOST]),
    hostnameOf(env.UNITIME_ICAL_URL),
    hostnameOf(env.UNITIME_EXAM_ICAL_URL),
  ].filter((h): h is string => h !== null);
  return [...new Set(hosts)];
}

/**
 * Validates a pasted calendar link. Errors never echo the link; they name
 * only the first allowed host.
 */
export function normalizeImportUrl(
  raw: string,
  allowedHosts: readonly string[],
): { ok: true; url: string; host: string } | { ok: false; error: string } {
  const first = allowedHosts[0] ?? DEFAULT_IMPORT_HOST;
  let text = raw.trim();
  if (text.length > IMPORT_URL_MAX)
    return { ok: false, error: 'That link is too long.' };
  if (/^webcal:\/\//i.test(text)) text = `https://${text.slice(9)}`;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: 'That is not a link.' };
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port)
    return { ok: false, error: `Use an https:// link from ${first}.` };
  const host = u.hostname.toLowerCase();
  if (!allowedHosts.includes(host))
    return {
      ok: false,
      error: `Only links from ${first} can be imported.`,
    };
  return { ok: true, url: text, host };
}

export function fetchImportCalendar(
  url: string,
  o: { fetchImpl?: typeof fetch } = {},
): Promise<string> {
  return fetchTimetable(url, {
    timeoutMs: IMPORT_TIMEOUT_MS,
    maxBytes: IMPORT_MAX_BYTES,
    fetchImpl: o.fetchImpl,
  });
}
