import type { Db } from './client.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * MariaDB: 1020 record changed since last read, 1213 deadlock. Lock wait timeouts (1205) are not
 * retried: each attempt already waited `innodb_lock_wait_timeout`, so retrying would hold a request for minutes.
 */
const RETRYABLE_ERRNOS = new Set([1020, 1213]);

/** True when the error (or one of its `cause`s, up to 3 deep) is a retryable transaction conflict. */
export function isRetryableTxError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 3 && cur && typeof cur === 'object'; depth++) {
    const errno = (cur as { errno?: unknown }).errno;
    if (typeof errno === 'number' && RETRYABLE_ERRNOS.has(errno)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const defaultPause = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 20 + Math.random() * 60));

/** Runs `db.transaction(fn)`, retrying on snapshot conflicts and deadlocks. */
export async function withTxRetry<T>(
  db: Db,
  fn: (tx: Tx) => Promise<T>,
  opts: { attempts?: number; pause?: () => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const pause = opts.pause ?? defaultPause;
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (err) {
      if (attempt >= attempts || !isRetryableTxError(err)) throw err;
      await pause();
    }
  }
}
