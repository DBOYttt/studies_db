import { safeNext } from './mode';

/**
 * One-shot notices carried through a redirect as `?notice=<key>`. Only these
 * keys exist and each maps to a fixed sentence: the URL never carries text
 * that ends up on the page.
 */
export const NOTICES = {
  'event-deleted': 'This event was deleted.',
  'session-ended':
    'Your session has ended. Sign in again with /link in Discord.',
} as const;

export type NoticeKey = keyof typeof NOTICES;

/** Shown on /login-info?expired=1 (see `requireUser` and `proxy.ts`). */
export const SESSION_ENDED = NOTICES['session-ended'];

export const NOTICE_PARAM = 'notice';

type SP = URLSearchParams | Record<string, string | string[] | undefined>;

const isKey = (v: unknown): v is NoticeKey =>
  typeof v === 'string' && Object.hasOwn(NOTICES, v);

/** The text of `?notice=`, or null for a missing, repeated or unknown key. */
export function noticeFromSearchParams(sp: SP): string | null {
  const v =
    sp instanceof URLSearchParams
      ? sp.getAll(NOTICE_PARAM).length === 1
        ? sp.get(NOTICE_PARAM)
        : null
      : sp[NOTICE_PARAM];
  return isKey(v) ? NOTICES[v] : null;
}

/**
 * `path` with `?notice=<key>` added (an earlier notice is replaced). Only an
 * internal path is accepted (same rules as the mode switch's `next`), so a
 * caller can never turn it into an open redirect.
 */
export function withNotice(path: string, key: NoticeKey): string {
  if (!isKey(key)) throw new Error(`Unknown notice: ${String(key)}`);
  if (safeNext(path) === null) throw new Error('Not an internal path');
  const u = new URL(path, 'http://internal.invalid');
  if (u.origin !== 'http://internal.invalid') {
    throw new Error('Not an internal path');
  }
  u.searchParams.set(NOTICE_PARAM, key);
  return `${u.pathname}${u.search}${u.hash}`;
}
