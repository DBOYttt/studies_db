/**
 * Generic DB queue through which the web (and other apps) ask the bot to do
 * Discord work. Kinds: `event_post_upsert`, `event_post_archive`,
 * `event_upload`, and the admin kinds `setup`, `setup_dry_run`, `resync`
 * (target `guild`, payload `{ requestedBy }`, at most one queued or running
 * at a time). Targets are strings like `event:<id>`.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db, DbExecutor } from './client.js';
import { botRequests, users } from './schema.js';
import { withTxRetry } from './tx.js';

export type BotRequestStatus = 'queued' | 'running' | 'done' | 'failed';

export type BotRequest = {
  id: number;
  kind: string;
  target: string;
  status: BotRequestStatus;
  payload: unknown;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const MAX_ERROR = 500;
const MAX_REPORT = 60_000;
export const STALE_BOT_REQUEST_ERROR = 'Interrupted: the bot was restarted.';

/**
 * Queues a request unless one for the same kind and target is already
 * `queued` (then that one's id is returned with `created: false`). A
 * `running` one doesn't count: the change it is processing may be older.
 */
export async function enqueueBotRequest(
  db: DbExecutor,
  kind: string,
  target: string,
  payload?: unknown,
): Promise<{ id: number; created: boolean }> {
  const existing = async () => {
    const [row] = await db
      .select({ id: botRequests.id })
      .from(botRequests)
      .where(
        and(
          eq(botRequests.kind, kind),
          eq(botRequests.target, target),
          eq(botRequests.status, 'queued'),
        ),
      )
      .orderBy(botRequests.id)
      .limit(1);
    return row;
  };
  // MariaDB has no FOR SHARE: the locking read is spelt out.
  const lockedExisting = async () => {
    const [rows] = (await db.execute(sql`
      SELECT id FROM bot_requests
       WHERE kind = ${kind} AND target = ${target} AND status = 'queued'
       ORDER BY id LIMIT 1
       LOCK IN SHARE MODE`)) as unknown as [{ id: number }[]];
    return rows[0];
  };
  // A locking read (inside a transaction it holds until commit), so two
  // concurrent enqueues rarely both insert. Then a plain INSERT ... VALUES:
  // an INSERT ... SELECT would take the table-level AUTO-INC lock, and a
  // deadlock on that lock is reported as 1467 (ER_AUTOINC_READ_FAILED)
  // instead of 1213, which withTxRetry retries.
  const found = await lockedExisting();
  if (found) return { id: found.id, created: false };
  const json = payload === undefined ? null : JSON.stringify(payload);
  const [res] = (await db.execute(sql`
    INSERT INTO bot_requests (kind, target, payload)
    VALUES (${kind}, ${target}, ${json})`)) as unknown as [
    { insertId: number; affectedRows: number },
  ];
  if (res.affectedRows === 1) return { id: res.insertId, created: true };
  const raced = await existing();
  if (!raced) throw new Error('enqueueBotRequest: queued row vanished');
  return { id: raced.id, created: false };
}

/** Atomically claims the oldest queued request of `kinds` (SKIP LOCKED). */
export async function claimNextBotRequest(
  db: Db,
  kinds: string[],
  now: Date = new Date(),
): Promise<BotRequest | null> {
  if (kinds.length === 0) return null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(botRequests)
      .where(
        and(eq(botRequests.status, 'queued'), inArray(botRequests.kind, kinds)),
      )
      .orderBy(botRequests.id)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return null;
    await tx
      .update(botRequests)
      .set({ status: 'running', startedAt: now })
      .where(eq(botRequests.id, row.id));
    return { ...row, status: 'running', startedAt: now };
  });
}

export async function finishBotRequest(
  db: DbExecutor,
  id: number,
  status: 'done' | 'failed',
  error?: string,
  now: Date = new Date(),
  report?: string,
): Promise<void> {
  await db
    .update(botRequests)
    .set({
      status,
      error: error === undefined ? null : error.slice(0, MAX_ERROR),
      finishedAt: now,
      ...(report === undefined ? {} : { report: truncateReport(report) }),
    })
    .where(eq(botRequests.id, id));
}

/** At most MAX_REPORT UTF-16 units plus `…`, never splitting a surrogate pair. */
function truncateReport(report: string): string {
  if (report.length <= MAX_REPORT) return report;
  let cut = report.slice(0, MAX_REPORT);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export const ADMIN_REQUEST_KINDS = [
  'setup',
  'setup_dry_run',
  'resync',
] as const;
export type AdminRequestKind = (typeof ADMIN_REQUEST_KINDS)[number];
export const BOT_BUSY_MESSAGE = 'The bot is already working on a request.';
export const CANCELLED_MESSAGE = 'Cancelled.';
const ADMIN_LOCK = 'admin_bot_request';

/**
 * Queues an admin request (target `guild`, payload `{ requestedBy }`) unless
 * another admin request is queued or running.
 *
 * The check is a FOR UPDATE read inside the transaction. When no admin row
 * exists that read only takes gap locks, which do not conflict with each
 * other, so two concurrent enqueues would both pass it and then deadlock on
 * their inserts. The named lock `admin_bot_request` (taken on the same
 * connection before the read) serialises them instead: the second one waits,
 * then sees the first one's committed row and is refused.
 */
export async function enqueueAdminBotRequest(
  db: Db,
  kind: AdminRequestKind,
  userId: number,
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  return withTxRetry(db, async (tx) => {
    const [[lock]] = (await tx.execute(
      sql`SELECT GET_LOCK(${ADMIN_LOCK}, 5) AS got`,
    )) as unknown as [{ got: number | null }[]];
    if (lock?.got !== 1) return { ok: false, message: BOT_BUSY_MESSAGE };
    try {
      const busy = await tx
        .select({ id: botRequests.id })
        .from(botRequests)
        .where(
          and(
            inArray(botRequests.kind, [...ADMIN_REQUEST_KINDS]),
            inArray(botRequests.status, ['queued', 'running']),
          ),
        )
        .limit(1)
        .for('update');
      if (busy.length > 0) return { ok: false, message: BOT_BUSY_MESSAGE };
      const [res] = await tx.insert(botRequests).values({
        kind,
        target: 'guild',
        payload: { requestedBy: userId },
      });
      return { ok: true, id: res.insertId };
    } finally {
      // Released before COMMIT, but the FOR UPDATE read still holds; and a
      // waiter that gets the lock first re-reads, at the latest, after our
      // commit (its FOR UPDATE blocks on our new row's lock).
      await tx.execute(sql`SELECT RELEASE_LOCK(${ADMIN_LOCK})`);
    }
  });
}

/** Fails a queued admin request with `Cancelled.`; false when it is not queued. */
export async function cancelAdminBotRequest(
  db: DbExecutor,
  id: number,
  now: Date = new Date(),
): Promise<boolean> {
  const [res] = await db
    .update(botRequests)
    .set({ status: 'failed', error: CANCELLED_MESSAGE, finishedAt: now })
    .where(
      and(
        eq(botRequests.id, id),
        eq(botRequests.status, 'queued'),
        inArray(botRequests.kind, [...ADMIN_REQUEST_KINDS]),
      ),
    );
  return res.affectedRows === 1;
}

export type AdminBotRequest = BotRequest & {
  report: string | null;
  requestedBy: number | null;
  requesterName: string | null;
};

/** Admin requests, newest first, with the requester's display name. */
export async function listAdminBotRequests(
  db: DbExecutor,
  limit = 20,
): Promise<AdminBotRequest[]> {
  const requestedBy = sql<
    number | null
  >`CAST(JSON_UNQUOTE(JSON_EXTRACT(${botRequests.payload}, '$.requestedBy')) AS INTEGER)`;
  const rows = await db
    .select({
      id: botRequests.id,
      kind: botRequests.kind,
      target: botRequests.target,
      status: botRequests.status,
      payload: botRequests.payload,
      error: botRequests.error,
      report: botRequests.report,
      createdAt: botRequests.createdAt,
      startedAt: botRequests.startedAt,
      finishedAt: botRequests.finishedAt,
      requestedBy,
      requesterName: users.displayName,
    })
    .from(botRequests)
    .leftJoin(users, eq(users.id, requestedBy))
    .where(inArray(botRequests.kind, [...ADMIN_REQUEST_KINDS]))
    .orderBy(desc(botRequests.id))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    requestedBy: r.requestedBy == null ? null : Number(r.requestedBy),
  }));
}

/**
 * Fails `running` requests started more than `olderThanMs` before `now`
 * (left behind by a crash or restart). `kinds` limits it to those kinds (a
 * consumer recovering its own requests at boot passes `olderThanMs` 0).
 * Returns how many were failed.
 */
export async function failStaleBotRequests(
  db: DbExecutor,
  now: Date,
  olderThanMs = 15 * 60_000,
  kinds?: string[],
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const [res] = await db
    .update(botRequests)
    .set({
      status: 'failed',
      error: STALE_BOT_REQUEST_ERROR,
      finishedAt: now,
    })
    .where(
      and(
        eq(botRequests.status, 'running'),
        lt(botRequests.startedAt, cutoff),
        kinds ? inArray(botRequests.kind, kinds) : undefined,
      ),
    );
  return res.affectedRows;
}

/** The newest request for (kind, target), whatever its status. */
export async function lastBotRequest(
  db: DbExecutor,
  kind: string,
  target: string,
): Promise<BotRequest | null> {
  const [row] = await db
    .select()
    .from(botRequests)
    .where(and(eq(botRequests.kind, kind), eq(botRequests.target, target)))
    .orderBy(desc(botRequests.id))
    .limit(1);
  return row ?? null;
}

/** Finished requests are kept this long (the event page shows the last one). */
export const BOT_REQUEST_KEEP_MS = 30 * 24 * 3600_000;

/**
 * Deletes `done`/`failed` requests created and finished more than
 * `keepMs` before `now`. Queued and running ones are never touched. Returns
 * how many were deleted.
 */
export async function pruneBotRequests(
  db: DbExecutor,
  now: Date,
  keepMs = BOT_REQUEST_KEEP_MS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - keepMs);
  const [res] = await db
    .delete(botRequests)
    .where(
      and(
        inArray(botRequests.status, ['done', 'failed']),
        lt(botRequests.createdAt, cutoff),
        or(isNull(botRequests.finishedAt), lt(botRequests.finishedAt, cutoff)),
      ),
    );
  return res.affectedRows;
}
