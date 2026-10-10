import type { Connection as CoreConnection, FieldPacket } from 'mysql2';
import mysql from 'mysql2/promise';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import type { SessionUser } from './session';

export type QueryResult =
  | {
      ok: true;
      columns: string[];
      rows: unknown[][];
      truncated: boolean;
      durationMs: number;
    }
  | { ok: false; error: string };

export interface QueryOptions {
  maxRows?: number;
  timeoutSec?: number;
  /** Rough cap on result size held in memory (default 20 MB). */
  maxBytes?: number;
  /** `?` placeholder values (server-built SQL only, never console input). */
  values?: unknown[];
}

const ER_STATEMENT_TIMEOUT = 1969;
const ER_QUERY_INTERRUPTED = 1317;
const ER_TOO_MANY_USER_CONNECTIONS = 1226;
const KILL_RETRY_MS = 250;

const BUSY_ERROR = 'Serwer jest zajęty — spróbuj za chwilę.';
const CONNECT_ERROR = 'Nie udało się połączyć z bazą danych.';

type DbError = Error & { errno?: number };

/** getConnection() failure -> user message (never leaks host/port). */
export function connectionErrorMessage(err: unknown): string {
  return (err as DbError)?.errno === ER_TOO_MANY_USER_CONNECTIONS
    ? BUSY_ERROR
    : CONNECT_ERROR;
}

/** Query failure -> user message (MariaDB errors verbatim, except 1226). */
export function queryErrorMessage(err: DbError): string {
  return err.errno === ER_TOO_MANY_USER_CONNECTIONS ? BUSY_ERROR : err.message;
}
/** Extra time past max_statement_time before we KILL the query ourselves. */
const WATCHDOG_GRACE_MS = 500;
/** If even KILL QUERY doesn't end it, give up on the connection after this. */
const WATCHDOG_HARD_MS = 1000;

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Driver value -> JSON-safe value (Buffer -> utf8 or 0x-hex, BigInt -> string, Date -> ISO). */
export function toJsonValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Buffer.isBuffer(v)) {
    try {
      return utf8.decode(v);
    } catch {
      return `0x${v.toString('hex')}`;
    }
  }
  return v;
}

function approxBytes(v: unknown): number {
  if (typeof v === 'string') return v.length;
  if (Buffer.isBuffer(v)) return v.length;
  return 8;
}

/**
 * Runs one user-supplied statement on the read-only pool.
 *
 * Security layers: the DB user only has SELECT on the v_* views and a
 * per-user MAX_STATEMENT_TIME; the pool has multipleStatements off; the query
 * is wrapped in SET STATEMENT max_statement_time; a watchdog KILLs the query
 * if it outlives the limit anyway (a nested `SET STATEMENT
 * max_statement_time=0 FOR ...` overrides ours); and the connection is always
 * destroyed afterwards, so session state (SET SESSION, user variables,
 * GET_LOCK) can never leak into later queries.
 */
export async function runReadonlyQuery(
  pool: mysql.Pool,
  sql: string,
  opts: QueryOptions = {},
): Promise<QueryResult> {
  const maxRows = opts.maxRows ?? 1000;
  // Interpolated into SQL below, so force a positive integer.
  const timeoutSec = Math.max(1, Math.floor(opts.timeoutSec ?? 5) || 5);
  const maxBytes = opts.maxBytes ?? 20_000_000;
  const timeoutError = `Przekroczono limit czasu (${timeoutSec} s).`;

  let text = sql.trim();
  if (text.endsWith(';')) text = text.slice(0, -1).trim();
  if (!text) return { ok: false, error: 'Puste zapytanie.' };

  const started = performance.now();
  let conn: mysql.PoolConnection;
  try {
    conn = await pool.getConnection();
  } catch (err) {
    return { ok: false, error: connectionErrorMessage(err) };
  }

  return new Promise<QueryResult>((resolve) => {
    let settled = false;
    let watchdogFired = false;
    let columns: string[] | null = null;
    const rows: unknown[][] = [];
    let bytes = 0;
    let truncated = false;
    let hardTimer: NodeJS.Timeout | undefined;

    const finish = (r: QueryResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      clearTimeout(hardTimer);
      conn.destroy();
      resolve(r);
    };
    const success = () =>
      finish({
        ok: true,
        columns: columns ?? [],
        rows,
        truncated,
        durationMs: Math.round(performance.now() - started),
      });

    const watchdog = setTimeout(
      () => {
        watchdogFired = true;
        void killQuery(Number(conn.threadId), killerFactory(conn));
        hardTimer = setTimeout(
          () => finish({ ok: false, error: timeoutError }),
          WATCHDOG_HARD_MS,
        );
      },
      timeoutSec * 1000 + WATCHDOG_GRACE_MS,
    );

    const query = core(conn).query({
      sql: `SET STATEMENT max_statement_time=${timeoutSec} FOR ${text}`,
      ...(opts.values ? { values: opts.values } : {}),
      rowsAsArray: true,
    });
    query.on('fields', (fields: FieldPacket[] | undefined) => {
      // undefined for OK-packet results (non-SELECT statements)
      if (fields) columns ??= fields.map((f) => f.name);
    });
    // Late errors after we've destroyed the connection must not go unhandled.
    query.on('error', () => {});
    const stream = query.stream();
    stream.on('data', (row: unknown) => {
      if (settled || !Array.isArray(row)) return; // OK packets for non-SELECT
      if (rows.length >= maxRows || bytes > maxBytes) {
        truncated = true;
        success();
        return;
      }
      const out = row.map(toJsonValue);
      for (const v of out) bytes += approxBytes(v);
      rows.push(out);
    });
    stream.on('end', success);
    stream.on('error', (err: DbError) => {
      if (
        err.errno === ER_STATEMENT_TIMEOUT ||
        (err.errno === ER_QUERY_INTERRUPTED && watchdogFired)
      ) {
        finish({ ok: false, error: timeoutError });
      } else {
        finish({ ok: false, error: queryErrorMessage(err) });
      }
    });
  });
}

/** The callback-style connection behind the promise wrapper (it has `.query().stream()`). */
const core = (conn: mysql.PoolConnection) =>
  conn.connection as unknown as CoreConnection;

/** Opens a fresh connection with the same credentials as `conn` (never from the pool, which may be exhausted). */
function killerFactory(conn: mysql.PoolConnection) {
  const c = core(conn).config;
  return () =>
    mysql.createConnection({
      host: c.host,
      port: c.port,
      socketPath: c.socketPath,
      user: c.user,
      password: c.password,
      database: c.database,
      ssl: c.ssl,
      connectTimeout: 2000,
    });
}

/** KILL QUERY <threadId> on a separate connection; one retry, then log. */
export async function killQuery(
  threadId: number,
  connect: () => Promise<mysql.Connection>,
  retryMs = KILL_RETRY_MS,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryMs));
    let killer: mysql.Connection | undefined;
    try {
      killer = await connect();
      await killer.query(`KILL QUERY ${Math.trunc(threadId)}`);
      return;
    } catch (err) {
      lastErr = err;
    } finally {
      killer?.destroy();
    }
  }
  // The hard timer still destroys our socket, but the server query may keep running.
  console.error(
    `[sql-console] KILL QUERY ${threadId} failed:`,
    (lastErr as Error)?.message ?? lastErr,
  );
}

export const MAX_SQL_LENGTH = 20_000;

/** One per process: 30 console queries per minute per user. */
export const sqlRateLimiter = createRateLimiter(30, 60_000);

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** Body of POST /api/sql. Auth (requireUser) is done by the route. */
export async function handleSqlRequest(
  req: Request,
  user: SessionUser,
  pool: mysql.Pool,
  limiter: RateLimiter = sqlRateLimiter,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const sql = (body as { sql?: unknown } | null)?.sql;
  if (typeof sql !== 'string' || sql.length > MAX_SQL_LENGTH) {
    return Response.json(
      { ok: false, error: 'Nieprawidłowe zapytanie.' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!limiter.check(String(user.id))) {
    return Response.json(
      { ok: false, error: 'Za dużo zapytań — odczekaj chwilę.' },
      { status: 429, headers: NO_STORE },
    );
  }
  const result = await runReadonlyQuery(pool, sql);
  return Response.json(result, { headers: NO_STORE });
}
