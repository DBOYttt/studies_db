/**
 * Body of POST /api/admin/sql (the admin write console). Auth
 * (requireAdmin) is done by the route.
 *
 * Statements run as `studies_rw`, whose grants are the hard boundary;
 * lib/admin-sql.ts is the second layer. Every write runs on one dedicated
 * connection inside a transaction that is rolled back unless committed, and
 * the connection is destroyed afterwards so no session state leaks.
 */
import { type Db, writeAudit } from '@studies/db';
import type mysql from 'mysql2/promise';
import { confirmMessage, confirmWord } from './admin-console';
import {
  adminSqlErrorMessage,
  CONFIRM_THRESHOLD,
  classifyStatement,
  PREVIEW_ROWS,
  previewSelect,
  SELECT_ROWS,
  type StatementKind,
  signPreview,
  TOKEN_TTL_MS,
  verifyPreview,
} from './admin-sql';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import type { SessionUser } from './session';
import {
  connectionErrorMessage,
  MAX_SQL_LENGTH,
  runReadonlyQuery,
  toJsonValue,
} from './sql-console';
import { BUSY_ERROR, CONNECT_ERROR } from './sql-messages';

/** One per process: 20 admin console requests per minute per user. */
export const adminSqlRateLimiter = createRateLimiter(20, 60_000);

export interface AdminSqlDeps {
  /** Main pool (audit log). */
  db: Db;
  /** `studies_rw` pool, or null when DATABASE_RW_URL is not set. */
  rw: mysql.Pool | null;
  limiter?: RateLimiter;
  now?: () => number;
}

export const DISABLED_ERROR =
  'Konsola zapisu wyłączona (brak DATABASE_RW_URL).';
export const AUDIT_FAILED_ERROR =
  'Zmiana zapisana, ale nie udało się zapisać dziennika.';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const fail = (status: number, error: string) =>
  Response.json({ ok: false, error }, { status, headers: NO_STORE });
const ok = (body: Record<string, unknown>) =>
  Response.json({ ok: true, ...body }, { headers: NO_STORE });

/**
 * A MariaDB SQL error (has a SQLSTATE / ER_ code) gets the console message;
 * anything else (socket, pool, protocol) gets the generic connection message,
 * which never includes host, port or user.
 */
function dbErrorMessage(err: unknown): string {
  const e = err as { sqlState?: unknown; code?: unknown } | null | undefined;
  const isSql =
    typeof e?.sqlState === 'string' ||
    (typeof e?.code === 'string' && e.code.startsWith('ER_'));
  return isSql ? adminSqlErrorMessage(err) : connectionErrorMessage(err);
}

const statusFor = (message: string) =>
  message === CONNECT_ERROR || message === BUSY_ERROR ? 503 : 400;

export const TOKEN_USED_ERROR = 'Token już użyty. Wykonaj podgląd ponownie.';
export const CROSS_ORIGIN_ERROR = 'Nieprawidłowe pochodzenie żądania.';

/**
 * MACs of preview tokens already sent to execute, with their expiry. A token
 * is valid for TOKEN_TTL_MS, so entries can be pruned after that. Kept on
 * globalThis so dev-mode module reloads share it; per process, which is
 * enough for the single web container.
 */
const tokenStore = globalThis as {
  __adminSqlUsedTokens?: Map<string, number>;
};
tokenStore.__adminSqlUsedTokens ??= new Map();
const usedTokens = tokenStore.__adminSqlUsedTokens;

/** Marks a token as used; false if it already was. Synchronous: no await between check and set. */
function spendToken(mac: string, issuedAt: number, now: number): boolean {
  for (const [k, expires] of usedTokens) {
    if (expires < now) usedTokens.delete(k);
  }
  if (usedTokens.has(mac)) return false;
  usedTokens.set(mac, issuedAt + TOKEN_TTL_MS);
  return true;
}

/**
 * Same-origin check for the POST (defence in depth next to the SameSite
 * session cookie): a present Origin must equal WEB_BASE_URL's origin, or the
 * request URL's origin when WEB_BASE_URL is not set.
 */
function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return false;
  let expected: string;
  try {
    expected = new URL(process.env.WEB_BASE_URL || req.url).origin;
  } catch {
    return true;
  }
  return origin !== expected;
}

interface Body {
  mode: 'preview' | 'execute';
  sql: string;
  token?: unknown;
  confirm?: unknown;
}

async function parseBody(req: Request): Promise<Body | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  const b = body as Partial<Body> | null;
  if (b?.mode !== 'preview' && b?.mode !== 'execute') return null;
  if (typeof b.sql !== 'string' || b.sql.length > MAX_SQL_LENGTH) return null;
  return b as Body;
}

type WriteKind = Exclude<StatementKind, 'select'>;

/** Runs `work` on a dedicated connection inside BEGIN … ROLLBACK (unless it commits). */
async function inTransaction<T>(
  pool: mysql.Pool,
  work: (conn: mysql.PoolConnection, commit: () => Promise<void>) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let conn: mysql.PoolConnection;
  try {
    conn = await pool.getConnection();
  } catch (err) {
    return { ok: false, error: connectionErrorMessage(err) };
  }
  let committed = false;
  try {
    await conn.query('BEGIN');
    const value = await work(conn, async () => {
      await conn.query('COMMIT');
      committed = true;
    });
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  } finally {
    if (!committed) {
      try {
        await conn.query('ROLLBACK');
      } catch {
        // The connection is destroyed below; MariaDB rolls back on disconnect.
      }
    }
    conn.destroy();
  }
}

type Shown = { columns: string[]; rows: unknown[][] };

function shownRows(
  rows: unknown[][],
  fields: mysql.FieldPacket[] | undefined,
): Shown {
  return {
    columns: (fields ?? []).map((f) => f.name),
    rows: rows.slice(0, PREVIEW_ROWS).map((r) => r.map(toJsonValue)),
  };
}

async function selectRows(
  conn: mysql.PoolConnection,
  sql: string,
): Promise<Shown> {
  const [rows, fields] = await conn.query<mysql.RowDataPacket[][]>({
    sql,
    rowsAsArray: true,
  });
  return shownRows(rows, fields);
}

/**
 * Runs the console statement. INSERT/REPLACE/DELETE … RETURNING yield a
 * result set instead of an OK packet: the row count is then the number of
 * returned rows, and those rows are the preview.
 */
async function runStatement(
  conn: mysql.PoolConnection,
  sql: string,
): Promise<{ affected: number; insertId: number; returned: Shown | null }> {
  const [res, fields] = await conn.query<
    mysql.ResultSetHeader | mysql.RowDataPacket[][]
  >({ sql, rowsAsArray: true });
  if (Array.isArray(res)) {
    return {
      affected: res.length,
      insertId: 0,
      returned: shownRows(res, fields),
    };
  }
  if (!Number.isSafeInteger(res.affectedRows)) {
    throw new Error('Unexpected statement result');
  }
  return {
    affected: res.affectedRows,
    insertId: Number(res.insertId) || 0,
    returned: null,
  };
}

async function runSelect(pool: mysql.Pool, sql: string): Promise<Response> {
  const r = await runReadonlyQuery(pool, sql, {
    maxRows: SELECT_ROWS,
    errorMessage: dbErrorMessage,
  });
  if (!r.ok) return fail(statusFor(r.error), r.error);
  return ok({
    kind: 'select',
    columns: r.columns,
    rows: r.rows,
    truncated: r.truncated,
  });
}

async function preview(
  pool: mysql.Pool,
  user: SessionUser,
  sql: string,
  kind: WriteKind,
  table: string | null,
  now: number,
): Promise<Response> {
  const before = previewSelect(sql, kind, table);
  const r = await inTransaction(pool, async (conn) => {
    let shown: Shown = { columns: [], rows: [] };
    if (before) shown = await selectRows(conn, before);
    const res = await runStatement(conn, sql);
    const { affected } = res;
    if (res.returned && !before) shown = res.returned;
    else if (
      !before &&
      table &&
      (kind === 'insert' || kind === 'replace') &&
      res.insertId > 0 &&
      affected > 0
    ) {
      // Best effort: tables with an auto-increment `id` show the new rows.
      try {
        shown = await selectRows(
          conn,
          `SELECT * FROM ${quoteTable(table)} WHERE id >= ${Number(res.insertId)} ORDER BY id LIMIT ${Math.min(affected, PREVIEW_ROWS)}`,
        );
      } catch {
        // No `id` column or similar: keep the preview without rows.
      }
    }
    return { affected, ...shown };
  });
  if (!r.ok) return fail(statusFor(r.error), r.error);
  const { affected, columns, rows } = r.value;
  return ok({
    kind,
    table,
    affected,
    columns,
    rows,
    token: signPreview({ userId: user.id, sql, affected, at: now }),
  });
}

const quoteTable = (t: string) => `\`${t.replaceAll('`', '``')}\``;

async function execute(
  deps: AdminSqlDeps & { rw: mysql.Pool },
  user: SessionUser,
  body: Body,
  kind: WriteKind,
  table: string | null,
  now: number,
): Promise<Response> {
  const { sql } = body;
  const token = verifyPreview(
    typeof body.token === 'string' ? body.token : '',
    { userId: user.id, sql, now },
  );
  if (!token.ok) return fail(400, token.reason);
  const confirmed = body.confirm === confirmWord(table);
  if (token.affected > CONFIRM_THRESHOLD && !confirmed) {
    return fail(400, confirmMessage(table, token.affected));
  }
  // Spent before BEGIN, whatever the outcome: a retry needs a new preview.
  if (!spendToken(token.mac, token.issuedAt, now)) {
    return fail(400, TOKEN_USED_ERROR);
  }

  let overLimit = 0;
  const r = await inTransaction(deps.rw, async (conn, commit) => {
    const res = await runStatement(conn, sql);
    // The data may have changed since the preview: never commit a large
    // change that was not confirmed.
    if (res.affected > CONFIRM_THRESHOLD && !confirmed) {
      overLimit = res.affected;
      return null;
    }
    await commit();
    return { affected: res.affected, insertId: res.insertId };
  });
  if (!r.ok) return fail(statusFor(r.error), r.error);
  if (!r.value) {
    return fail(
      400,
      `Liczba wierszy zmieniła się od podglądu. ${confirmMessage(table, overLimit)}`,
    );
  }

  const { affected, insertId } = r.value;
  let auditId: number;
  try {
    auditId = await writeAudit(deps.db, {
      userId: user.id,
      action: 'sql.execute',
      target: table,
      statement: sql,
      rowsAffected: affected,
      details: {
        kind,
        previewAffected: token.affected,
        ...(insertId > 0 ? { insertId } : {}),
      },
    });
  } catch (err) {
    console.error(
      `[admin-sql] audit write failed after commit (user ${user.id}, ${kind} ${table ?? '?'}, ${affected} rows):`,
      err,
    );
    return fail(500, AUDIT_FAILED_ERROR);
  }
  return ok({ kind, table, affected, auditId });
}

export async function handleAdminSqlRequest(
  req: Request,
  user: SessionUser,
  deps: AdminSqlDeps,
): Promise<Response> {
  if (isCrossOrigin(req)) return fail(403, CROSS_ORIGIN_ERROR);
  const body = await parseBody(req);
  if (!body) return fail(400, 'Nieprawidłowe zapytanie.');
  const limiter = deps.limiter ?? adminSqlRateLimiter;
  if (!limiter.check(String(user.id))) {
    return fail(429, 'Za dużo zapytań. Odczekaj chwilę.');
  }
  const { rw } = deps;
  if (!rw) return fail(503, DISABLED_ERROR);

  const c = classifyStatement(body.sql);
  if (!c.ok) {
    try {
      await writeAudit(deps.db, {
        userId: user.id,
        action: 'sql.rejected',
        statement: body.sql,
        details: { mode: body.mode, reason: c.reason },
      });
    } catch (err) {
      console.error('[admin-sql] audit write failed (sql.rejected):', err);
    }
    return fail(400, c.reason);
  }

  if (c.kind === 'select') return runSelect(rw, body.sql);
  const now = (deps.now ?? Date.now)();
  if (body.mode === 'preview') {
    return preview(rw, user, body.sql, c.kind, c.table, now);
  }
  return execute({ ...deps, rw }, user, body, c.kind, c.table, now);
}
