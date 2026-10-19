import {
  consumeLoginToken,
  createLoginToken,
  type Db,
  PUBLIC_VIEWS,
  subjects,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import { sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
let roPool: mysql.Pool;

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db')>()),
  getDb: () => db,
  getRoPool: () => roPool,
}));

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));

const { RO_POOL_OPTIONS } = await import('../lib/db');
const {
  runReadonlyQuery,
  toJsonValue,
  handleSqlRequest,
  connectionErrorMessage,
  queryErrorMessage,
  killQuery,
} = await import('../lib/sql-console');
const { createRateLimiter } = await import('../lib/rate-limit');
const { POST, dynamic } = await import('../app/api/sql/route');

let sid: string;
let userId: number;

beforeAll(async () => {
  db = await resetTestDb();
  roPool = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 3,
  });
  await db.insert(subjects).values([
    {
      name: 'Mechanika',
      code: 'MECH',
      semester: 1,
      ects: 5,
      discordChannelId: 'c1',
    },
    {
      name: 'Analiza',
      code: 'AM',
      semester: 1,
      ects: 6,
      discordChannelId: 'c2',
    },
  ]);
  userId = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ann',
    avatarUrl: null,
  });
  const token = await createLoginToken(db, userId);
  const r = await consumeLoginToken(db, token);
  sid = (r as { sessionToken: string }).sessionToken;
});

afterAll(async () => {
  await roPool.end();
  await closeTestDb(db);
});

const TIMEOUT_MSG = 'Przekroczono limit czasu (5 s).';

describe('RO pool options', () => {
  it('never allows multiple statements', () => {
    expect(RO_POOL_OPTIONS.multipleStatements).toBe(false);
  });
  it('leaves headroom under MAX_USER_CONNECTIONS 10 for killer connections', () => {
    expect(RO_POOL_OPTIONS.connectionLimit).toBe(4);
  });
});

const BUSY = 'Serwer jest zajęty. Spróbuj za chwilę.';
const NO_DB = 'Nie udało się połączyć z bazą danych.';
const tooMany = () =>
  Object.assign(new Error("User 'studies_ro' has exceeded the limit"), {
    errno: 1226,
    code: 'ER_TOO_MANY_USER_CONNECTIONS',
  });
const refused = () =>
  Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3306'), {
    code: 'ECONNREFUSED',
    errno: -111,
  });

describe('error mapping', () => {
  it('maps connection errors without leaking host/port', () => {
    expect(connectionErrorMessage(tooMany())).toBe(BUSY);
    expect(connectionErrorMessage(refused())).toBe(NO_DB);
    expect(connectionErrorMessage(new Error('weird'))).toBe(NO_DB);
  });
  it('maps 1226 on queries, passes other MariaDB errors through', () => {
    expect(queryErrorMessage(tooMany())).toBe(BUSY);
    const e = Object.assign(new Error('SELECT command denied'), {
      errno: 1142,
    });
    expect(queryErrorMessage(e)).toBe('SELECT command denied');
  });
  it('sanitizes a denial: no user, host or schema', () => {
    const e = Object.assign(
      new Error(
        "SELECT command denied to user 'studies_ro_qa'@'10.88.0.2' for table `studies_qa_test`.`users`",
      ),
      { errno: 1142 },
    );
    const m = queryErrorMessage(e);
    expect(m).not.toMatch(/@|studies_/);
    expect(m).toContain('`users`');
  });
  it('runReadonlyQuery maps getConnection failures', async () => {
    for (const [err, msg] of [
      [tooMany(), BUSY],
      [refused(), NO_DB],
    ] as const) {
      const pool = {
        getConnection: async () => {
          throw err;
        },
      } as unknown as mysql.Pool;
      expect(await runReadonlyQuery(pool, 'SELECT 1')).toEqual({
        ok: false,
        error: msg,
      });
    }
  });
});

describe('killQuery', () => {
  it('retries a failing killer once, then logs thread id and error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const connect = vi.fn(async () => {
        throw tooMany();
      });
      await killQuery(4242, connect, 10);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = spy.mock.calls[0].map(String).join(' ');
      expect(logged).toContain('4242');
      expect(logged).toContain('exceeded the limit');
    } finally {
      spy.mockRestore();
    }
  });
  it('succeeds on the retry without logging', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const queries: string[] = [];
      let n = 0;
      const connect = vi.fn(async () => {
        if (n++ === 0) throw tooMany();
        return {
          query: async (q: string) => {
            queries.push(q);
            return [[], []];
          },
          destroy: () => {},
        } as unknown as mysql.Connection;
      });
      await killQuery(7, connect, 10);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(queries).toEqual(['KILL QUERY 7']);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('toJsonValue', () => {
  it('converts driver values to JSON-safe values', () => {
    expect(toJsonValue(null)).toBeNull();
    expect(toJsonValue(undefined)).toBeNull();
    expect(toJsonValue(5)).toBe(5);
    expect(toJsonValue('ż')).toBe('ż');
    expect(toJsonValue(true)).toBe(true);
    expect(toJsonValue(12345678901234567890n)).toBe('12345678901234567890');
    expect(toJsonValue(new Date('2026-01-02T03:04:05.000Z'))).toBe(
      '2026-01-02T03:04:05.000Z',
    );
    expect(toJsonValue(new Date('invalid'))).toBeNull();
    expect(toJsonValue(Buffer.from('zażółć', 'utf8'))).toBe('zażółć');
    expect(toJsonValue(Buffer.from([0xff, 0x00, 0xab]))).toBe('0xff00ab');
    expect(toJsonValue({ a: 1 })).toEqual({ a: 1 });
    expect(JSON.parse(JSON.stringify(toJsonValue(Number.NaN)))).toBeNull();
  });
});

describe('runReadonlyQuery', () => {
  it('runs a SELECT on a public view', async () => {
    const r = await runReadonlyQuery(
      roPool,
      '  SELECT name FROM v_subjects ORDER BY name;  ',
    );
    expect(r).toMatchObject({
      ok: true,
      columns: ['name'],
      rows: [['Analiza'], ['Mechanika']],
      truncated: false,
    });
    if (r.ok) expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps duplicate column names as separate columns', async () => {
    const r = await runReadonlyQuery(roPool, 'SELECT 1 AS a, 2 AS a');
    expect(r).toMatchObject({ ok: true, columns: ['a', 'a'], rows: [[1, 2]] });
  });

  it('rejects empty input', async () => {
    expect(await runReadonlyQuery(roPool, '   ')).toEqual({
      ok: false,
      error: 'Puste zapytanie.',
    });
    expect(await runReadonlyQuery(roPool, ' ; ')).toEqual({
      ok: false,
      error: 'Puste zapytanie.',
    });
  });

  it('rejects multiple statements and leaves the view intact', async () => {
    const r = await runReadonlyQuery(roPool, 'SELECT 1; DROP TABLE v_users');
    expect(r.ok).toBe(false);
    const [rows] = (await db.execute(
      sql`SELECT COUNT(*) AS n FROM v_users`,
    )) as unknown as [{ n: number }[]];
    expect(Number(rows[0].n)).toBe(1);
  });

  it('denies writes', async () => {
    const r = await runReadonlyQuery(roPool, 'DELETE FROM v_subjects');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/denied/i);
  });

  it('denies non-public tables', async () => {
    const r = await runReadonlyQuery(roPool, 'SELECT * FROM sessions');
    expect(r.ok).toBe(false);
  });

  it('denies INTO OUTFILE', async () => {
    const r = await runReadonlyQuery(roPool, "SELECT 1 INTO OUTFILE '/tmp/x'");
    expect(r.ok).toBe(false);
  });

  it('times out SLEEP(10) within 7 s', async () => {
    const t0 = Date.now();
    const r = await runReadonlyQuery(roPool, 'SELECT SLEEP(10)');
    expect(Date.now() - t0).toBeLessThan(7000);
    if (r.ok) expect(r.rows).toEqual([[1]]);
    else expect(r.error).toBe(TIMEOUT_MSG);
  }, 10_000);

  it('kills queries that override max_statement_time themselves', async () => {
    for (const q of [
      'SET STATEMENT max_statement_time=0 FOR SELECT SLEEP(10)',
      '/*!SET STATEMENT max_statement_time=0 FOR*/ SELECT SLEEP(10)',
    ]) {
      const t0 = Date.now();
      const r = await runReadonlyQuery(roPool, q, { timeoutSec: 1 });
      expect(Date.now() - t0).toBeLessThan(4000);
      expect(r).toEqual({
        ok: false,
        error: 'Przekroczono limit czasu (1 s).',
      });
      // the server-side query was actually killed, not just abandoned
      const [running] = await roPool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST
          WHERE COMMAND = 'Query' AND ID <> CONNECTION_ID()
            AND INFO LIKE '%SLEEP(10)%'`,
      );
      expect(Number(running[0].n)).toBe(0);
    }
  }, 15_000);

  it('truncates at maxRows', async () => {
    const r = await runReadonlyQuery(
      roPool,
      'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100000) SELECT * FROM n',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows.length).toBe(1000);
      expect(r.truncated).toBe(true);
    }
  });

  it('honours a custom maxRows; exactly maxRows is not truncated', async () => {
    const r = await runReadonlyQuery(roPool, 'SELECT name FROM v_subjects', {
      maxRows: 2,
    });
    expect(r).toMatchObject({ ok: true, truncated: false });
    const r1 = await runReadonlyQuery(roPool, 'SELECT name FROM v_subjects', {
      maxRows: 1,
    });
    expect(r1).toMatchObject({ ok: true, truncated: true });
    if (r1.ok) expect(r1.rows.length).toBe(1);
  });

  it('truncates when the result gets too large in bytes', async () => {
    const r = await runReadonlyQuery(
      roPool,
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50) SELECT REPEAT('x', 100000) FROM n",
      { maxBytes: 1_000_000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.truncated).toBe(true);
      expect(r.rows.length).toBeLessThan(50);
    }
  });

  it('SHOW TABLES lists only public views', async () => {
    const r = await runReadonlyQuery(roPool, 'SHOW TABLES');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.rows.map((row) => String(row[0])).sort();
      expect(names.length).toBe(PUBLIC_VIEWS.length);
      for (const n of names) expect(n).toMatch(/^v_/);
    }
  });

  it('does not leak session state between queries', async () => {
    const pool = mysql.createPool({
      ...RO_POOL_OPTIONS,
      uri: testRoUrl(),
      connectionLimit: 1,
    });
    try {
      expect((await runReadonlyQuery(pool, 'SET @leak = 42')).ok).toBe(true);
      expect(
        (await runReadonlyQuery(pool, 'SET SESSION max_statement_time = 0')).ok,
      ).toBe(true);
      const r = await runReadonlyQuery(pool, 'SELECT @leak');
      expect(r).toMatchObject({ ok: true, rows: [[null]] });
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT @@max_statement_time AS t',
      );
      expect(Number(rows[0].t)).toBe(5);
    } finally {
      await pool.end();
    }
  });

  it('returns JSON-serialisable rows', async () => {
    const r = await runReadonlyQuery(
      roPool,
      "SELECT created_at, CAST(18446744073709551615 AS UNSIGNED) AS big, UNHEX('FF00') AS bin, _binary'abc' AS txt FROM v_subjects LIMIT 1",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const [created, big, bin, txt] = r.rows[0];
      expect(created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(big).toBe('18446744073709551615');
      expect(bin).toBe('0xff00');
      expect(txt).toBe('abc');
      expect(() => JSON.stringify(r)).not.toThrow();
    }
  });
});

describe('POST /api/sql', () => {
  const post = (body: unknown) =>
    POST(
      new Request('http://localhost/api/sql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    ) as Promise<Response>;

  it('is dynamic', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('redirects to /login-info without a session', async () => {
    cookieSid = undefined;
    await expect(post({ sql: 'SELECT 1' })).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*\/login-info;/),
    });
  });

  it('validates the body', async () => {
    cookieSid = sid;
    for (const body of [
      'not json',
      {},
      { sql: 5 },
      null,
      { sql: 'x'.repeat(20_001) },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        ok: false,
        error: 'Nieprawidłowe zapytanie.',
      });
    }
  });

  it('runs the query and returns QueryResult JSON', async () => {
    cookieSid = sid;
    const res = await post({
      sql: 'SELECT code FROM v_subjects ORDER BY code',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toMatchObject({
      ok: true,
      columns: ['code'],
      rows: [['AM'], ['MECH']],
      truncated: false,
    });
  });

  it('returns SQL errors as ok:false', async () => {
    cookieSid = sid;
    const res = await post({ sql: 'SELECT * FROM sessions' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it('rate limits per user with 429 after 30/min', async () => {
    cookieSid = sid;
    // the module-level limiter already counted earlier successful calls
    let res: Response | undefined;
    for (let i = 0; i < 31; i++) {
      res = await post({ sql: 'SELECT 1' });
      if (res.status === 429) break;
    }
    expect(res?.status).toBe(429);
    expect(await res?.json()).toEqual({
      ok: false,
      error: 'Za dużo zapytań. Odczekaj chwilę.',
    });
  });

  it('handleSqlRequest keys the limiter by user id', async () => {
    const limiter = createRateLimiter(1, 60_000);
    const req = () =>
      new Request('http://x/', {
        method: 'POST',
        body: JSON.stringify({ sql: 'SELECT 1' }),
      });
    const user = { id: 1, displayName: 'A', avatarUrl: null, isAdmin: false };
    const other = { id: 2, displayName: 'B', avatarUrl: null, isAdmin: false };
    expect((await handleSqlRequest(req(), user, roPool, limiter)).status).toBe(
      200,
    );
    expect((await handleSqlRequest(req(), user, roPool, limiter)).status).toBe(
      429,
    );
    expect((await handleSqlRequest(req(), other, roPool, limiter)).status).toBe(
      200,
    );
  });
});
