/**
 * Generic DB queue through which the web (and other apps) ask the bot to do
 * Discord work. Kinds: `event_post_upsert`, `event_post_archive`,
 * `event_upload` (later `setup`, `setup_dry_run`, `resync`). Targets are
 * strings like `event:<id>`.
 */
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db, DbExecutor } from './client.js';
import { botRequests } from './schema.js';

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
export const STALE_BOT_REQUEST_ERROR = 'Przerwane: bot został zrestartowany.';

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
  const found = await existing();
  if (found) return { id: found.id, created: false };
  const json = payload === undefined ? null : JSON.stringify(payload);
  // Conditional insert, so two concurrent enqueues rarely both insert.
  const [res] = (await db.execute(sql`
    INSERT INTO bot_requests (kind, target, payload)
    SELECT ${kind}, ${target}, ${json} FROM DUAL
    WHERE NOT EXISTS (
      SELECT 1 FROM bot_requests
       WHERE kind = ${kind} AND target = ${target} AND status = 'queued'
    )`)) as unknown as [{ insertId: number; affectedRows: number }];
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
): Promise<void> {
  await db
    .update(botRequests)
    .set({
      status,
      error: error === undefined ? null : error.slice(0, MAX_ERROR),
      finishedAt: now,
    })
    .where(eq(botRequests.id, id));
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
