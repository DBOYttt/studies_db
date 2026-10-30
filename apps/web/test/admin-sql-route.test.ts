import {
  adminAudit,
  classes,
  classGroups,
  consumeLoginToken,
  createLoginToken,
  type Db,
  subjects,
  tags,
  upsertUser,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRwUrl } from '@studies/db/testing';
import { count, eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../lib/session';

let db: Db;
let rw: mysql.Pool | null = null;
vi.mock('@/lib/db', () => ({ getDb: () => db, getRwPool: () => rw }));

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));

const counts = vi.hoisted(() => ({ invalidated: 0 }));
vi.mock('../lib/count-cache', () => ({
  invalidateCounts: () => {
    counts.invalidated++;
  },
}));

const audit = vi.hoisted(() => ({ fail: false }));
vi.mock('@studies/db', async (importOriginal) => {
  const m = await importOriginal<typeof import('@studies/db')>();
  return {
    ...m,
    writeAudit: async (...a: Parameters<typeof m.writeAudit>) => {
      if (audit.fail) throw new Error('audit table unavailable');
      return m.writeAudit(...a);
    },
  };
});

const route = await import('../app/api/admin/sql/route');
const { POST } = route;
const { handleAdminSqlRequest } = await import('../lib/admin-sql-handler');
const { TOKEN_TTL_MS, signPreview } = await import('../lib/admin-sql');
const { createRateLimiter } = await import('../lib/rate-limit');
const { CONNECT_ERROR } = await import('../lib/sql-messages');
const { confirmMessage } = await import('../lib/admin-console');

let admin: SessionUser;
let adminSid: string;
let plainSid: string;
let rwPool: mysql.Pool;

type Body = Record<string, unknown>;
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x/api/admin/sql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...('Origin' in headers ? {} : { 'sec-fetch-site': 'same-origin' }),
      ...headers,
    },
    body: JSON.stringify(body),
  });

/** Handler call with a fresh limiter (rate limiting is tested separately). */
const call = (
  body: Body,
  deps: Partial<Parameters<typeof handleAdminSqlRequest>[2]> = {},
  headers: Record<string, string> = {},
) =>
  handleAdminSqlRequest(request(body, headers), admin, {
    db,
    rw: rwPool,
    limiter: createRateLimiter(1000, 60_000),
    ...deps,
  });

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown> & {
    ok: boolean;
    error?: string;
    token?: string;
    rows?: unknown[][];
    columns?: string[];
  };
}

const auditCount = async (action: string) =>
  (
    await db
      .select({ n: count() })
      .from(adminAudit)
      .where(eq(adminAudit.action, action))
  )[0].n;

const ectsOf = async (code: string) =>
  (
    await db
      .select({ ects: subjects.ects })
      .from(subjects)
      .where(eq(subjects.code, code))
  )[0]?.ects;

async function login(discordUserId: string, displayName: string) {
  const id = await upsertUser(db, {
    discordUserId,
    displayName,
    avatarUrl: null,
  });
  const r = await consumeLoginToken(db, await createLoginToken(db, id));
  return { id, sid: (r as { sessionToken: string }).sessionToken };
}

async function expect404(p: Promise<unknown>) {
  try {
    await p;
    expect.unreachable();
  } catch (e) {
    expect(String((e as { digest?: string }).digest)).toBe(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
  }
}

beforeAll(async () => {
  db = await resetTestDb();
  rwPool = mysql.createPool({
    uri: testRwUrl(),
    connectionLimit: 3,
    multipleStatements: false,
  });
  rw = rwPool;
  await db
    .insert(subjects)
    .values({ name: 'Algorytmy', code: 'ASD', semester: 1, ects: 5 });
  await db.insert(subjects).values(
    Array.from({ length: 101 }, (_, i) => ({
      name: `Bulk ${i}`,
      code: `B${String(i).padStart(3, '0')}`,
      semester: 7,
      ects: 1,
    })),
  );
  const a = await login('adm', 'Ada');
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, a.id));
  adminSid = a.sid;
  admin = { id: a.id, displayName: 'Ada', avatarUrl: null, isAdmin: true };
  plainSid = (await login('usr', 'Bob')).sid;
});
afterAll(async () => {
  await rwPool.end();
  await closeTestDb(db);
});

describe('POST /api/admin/sql route gate', () => {
  it('404 for a non-admin session in every mode', async () => {
    cookieSid = plainSid;
    for (const body of [
      {
        mode: 'preview',
        sql: "UPDATE subjects SET ects = 9 WHERE code = 'ASD'",
      },
      { mode: 'execute', sql: 'SELECT 1', token: 'x' },
      { mode: 'preview', sql: 'SELECT 1' },
    ])
      await expect404(POST(request(body)));
    cookieSid = undefined;
    await expect404(POST(request({ mode: 'preview', sql: 'SELECT 1' })));
  });

  it('other methods: 404 for non-admins, 405 with Allow: POST for admins', async () => {
    const methods = ['GET', 'PUT', 'PATCH', 'DELETE'] as const;
    try {
      cookieSid = plainSid;
      for (const m of methods) await expect404(route[m]());
      cookieSid = adminSid;
      for (const m of methods) {
        const res = await route[m]();
        expect(res.status, m).toBe(405);
        expect(res.headers.get('Allow'), m).toBe('POST');
      }
    } finally {
      cookieSid = undefined;
    }
  });

  it('404 on the next request once the admin flag is cleared', async () => {
    cookieSid = adminSid;
    const ok = await POST(request({ mode: 'preview', sql: 'SELECT 1' }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store');
    await db
      .update(users)
      .set({ isAdmin: false })
      .where(eq(users.id, admin.id));
    try {
      await expect404(POST(request({ mode: 'preview', sql: 'SELECT 1' })));
    } finally {
      await db
        .update(users)
        .set({ isAdmin: true })
        .where(eq(users.id, admin.id));
      cookieSid = undefined;
    }
  });
});

describe('handleAdminSqlRequest', () => {
  const update = "UPDATE subjects SET ects = 9 WHERE code = 'ASD'";

  it('preview reports affected rows and leaves the data unchanged', async () => {
    const res = await call({ mode: 'preview', sql: update });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await json(res);
    expect(body).toMatchObject({
      ok: true,
      kind: 'update',
      table: 'subjects',
      affected: 1,
    });
    expect(body.rows).toHaveLength(1);
    expect(body.columns).toContain('ects');
    const row = body.rows?.[0] ?? [];
    expect(row[body.columns?.indexOf('code') ?? -1]).toBe('ASD');
    expect(row[body.columns?.indexOf('ects') ?? -1]).toBe(5);
    expect(typeof body.token).toBe('string');
    expect(await ectsOf('ASD')).toBe(5);
    expect(await auditCount('sql.execute')).toBe(0);
  });

  it('execute with the token commits and writes one audit row', async () => {
    const preview = await json(await call({ mode: 'preview', sql: update }));
    const res = await call({
      mode: 'execute',
      sql: update,
      token: preview.token,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      ok: true,
      kind: 'update',
      table: 'subjects',
      affected: 1,
    });
    expect(await ectsOf('ASD')).toBe(9);
    const rows = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, 'sql.execute'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.auditId,
      userId: admin.id,
      target: 'subjects',
      statement: update,
      rowsAffected: 1,
    });
  });

  it('400 when the SQL changed by one space since the preview', async () => {
    const sql = "UPDATE subjects SET ects = 8 WHERE code = 'ASD'";
    const preview = await json(await call({ mode: 'preview', sql }));
    const res = await call({
      mode: 'execute',
      sql: sql.replace('SET', 'SET '),
      token: preview.token,
    });
    expect(res.status).toBe(400);
    expect((await json(res)).ok).toBe(false);
    expect(await ectsOf('ASD')).toBe(9);
  });

  it('400 for an expired token', async () => {
    const sql = "UPDATE subjects SET ects = 7 WHERE code = 'ASD'";
    const t0 = Date.now();
    const preview = await json(
      await call({ mode: 'preview', sql }, { now: () => t0 }),
    );
    const res = await call(
      { mode: 'execute', sql, token: preview.token },
      { now: () => t0 + TOKEN_TTL_MS + 1 },
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/expired/);
    expect(await ectsOf('ASD')).toBe(9);
  });

  it('a token executes once; reuse is 400 and changes nothing', async () => {
    const sql = "UPDATE subjects SET ects = ects + 1 WHERE code = 'ASD'";
    const preview = await json(await call({ mode: 'preview', sql }));
    const invalidated = counts.invalidated;
    const first = await call({ mode: 'execute', sql, token: preview.token });
    expect(first.status).toBe(200);
    // a committed write drops the cached nav / subject-card counts
    expect(counts.invalidated).toBe(invalidated + 1);
    const after = await ectsOf('ASD');
    const before = await auditCount('sql.execute');
    const again = await call({ mode: 'execute', sql, token: preview.token });
    expect(again.status).toBe(400);
    expect(counts.invalidated).toBe(invalidated + 1);
    expect((await json(again)).error).toBe(
      'Token already used. Run the preview again.',
    );
    expect(await ectsOf('ASD')).toBe(after);
    expect(await auditCount('sql.execute')).toBe(before);
    await db.update(subjects).set({ ects: 9 }).where(eq(subjects.code, 'ASD'));
  });

  it('a token is spent even when padded or re-encoded', async () => {
    const sql = "UPDATE subjects SET ects = 9 WHERE code = 'ASD'";
    const { token } = await json(await call({ mode: 'preview', sql }));
    expect((await call({ mode: 'execute', sql, token })).status).toBe(200);
    const raw = Buffer.from(token as string, 'base64url');
    for (const variant of [
      raw.toString('base64'),
      `${token}=`,
      raw.toString('base64url'),
    ]) {
      const res = await call({ mode: 'execute', sql, token: variant });
      expect(res.status, variant).toBe(400);
    }
  });

  it('403 for a cross-origin POST; same-origin is fine', async () => {
    const sql = 'SELECT 1';
    vi.stubEnv('WEB_BASE_URL', 'https://studies.example.com/');
    try {
      const evil = await call(
        { mode: 'preview', sql },
        {},
        { Origin: 'https://evil.example' },
      );
      expect(evil.status).toBe(403);
      expect((await json(evil)).ok).toBe(false);
      for (const origin of [
        'null',
        'http://x',
        'https://studies.example.com:444',
      ]) {
        const res = await call(
          { mode: 'preview', sql },
          {},
          { Origin: origin },
        );
        expect(res.status, origin).toBe(403);
      }
      const same = await call(
        { mode: 'preview', sql },
        {},
        { Origin: 'https://studies.example.com' },
      );
      expect(same.status).toBe(200);
      expect((await call({ mode: 'preview', sql })).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('403 without Origin and Sec-Fetch-Site', async () => {
    const res = await handleAdminSqlRequest(
      new Request('http://x/api/admin/sql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', sql: 'SELECT 1' }),
      }),
      admin,
      { db, rw: rwPool, limiter: createRateLimiter(1000, 60_000) },
    );
    expect(res.status).toBe(403);
  });

  it('without WEB_BASE_URL the Origin must match the request URL', async () => {
    vi.stubEnv('WEB_BASE_URL', '');
    try {
      const sql = 'SELECT 1';
      expect(
        (await call({ mode: 'preview', sql }, {}, { Origin: 'http://x' }))
          .status,
      ).toBe(200);
      expect(
        (await call({ mode: 'preview', sql }, {}, { Origin: 'http://y' }))
          .status,
      ).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('400 for a missing or bogus token', async () => {
    for (const token of [undefined, '', 'nope', 42]) {
      const res = await call({ mode: 'execute', sql: update, token });
      expect(res.status, String(token)).toBe(400);
    }
  });

  it('more than 100 rows requires the table name typed as confirmation', async () => {
    const sql = 'UPDATE subjects SET ects = 2 WHERE semester = 7';
    const preview = await json(await call({ mode: 'preview', sql }));
    expect(preview.affected).toBe(101);
    expect(preview.rows).toHaveLength(50);
    // 'YES' is only the word for statements whose table is unknown; a known
    // table must be confirmed by its own name, so 'YES' is refused here.
    for (const confirm of [undefined, '', 'Subjects', 'YES']) {
      const res = await call({
        mode: 'execute',
        sql,
        token: preview.token,
        confirm,
      });
      expect(res.status, String(confirm)).toBe(400);
    }
    expect(await ectsOf('B000')).toBe(1);
    const res = await call({
      mode: 'execute',
      sql,
      token: preview.token,
      confirm: 'subjects',
    });
    expect(res.status).toBe(200);
    expect((await json(res)).affected).toBe(101);
    expect(await ectsOf('B000')).toBe(2);
  });

  it('a DELETE on a cascade parent needs the typed confirmation even for 1 row', async () => {
    const [s] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.code, 'ASD'));
    const [c] = await db
      .insert(classes)
      .values({ subjectId: s.id, kind: 'wyklad', name: 'Wykład' })
      .$returningId();
    await db
      .insert(classGroups)
      .values({ classId: c.id, number: 99, name: 'Gr. 99' });
    const sql = 'DELETE FROM class_groups WHERE number = 99';
    const preview = await json(await call({ mode: 'preview', sql }));
    expect(preview).toMatchObject({ ok: true, affected: 1, cascade: true });
    const groups = async () =>
      (await db.select({ n: count() }).from(classGroups))[0].n;
    for (const confirm of [undefined, '', 'YES']) {
      const res = await call({
        mode: 'execute',
        sql,
        token: preview.token,
        confirm,
      });
      expect(res.status, String(confirm)).toBe(400);
      expect((await json(res)).error).toBe(confirmMessage('class_groups', 1));
    }
    expect(await groups()).toBe(1);
    const res = await call({
      mode: 'execute',
      sql,
      token: preview.token,
      confirm: 'class_groups',
    });
    expect(res.status).toBe(200);
    expect(await groups()).toBe(0);
    // An UPDATE on the same table is not a cascade.
    const upd = await json(
      await call({
        mode: 'preview',
        sql: "UPDATE subjects SET ects = 5 WHERE code = 'ASD'",
      }),
    );
    expect(upd.cascade).toBe(false);
  });

  it('rolls back an unconfirmed change that grew past 100 rows since the preview', async () => {
    const sql = 'UPDATE subjects SET ects = 3 WHERE semester = 7';
    const token = signPreview({
      userId: admin.id,
      sql,
      affected: 1,
      at: Date.now(),
    });
    const before = await auditCount('sql.execute');
    const res = await call({ mode: 'execute', sql, token });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(
      /since the preview.*Run the preview again/,
    );
    expect(await ectsOf('B000')).toBe(2);
    expect(await auditCount('sql.execute')).toBe(before);
  });

  it('more than 100 rows on an unknown table is confirmed with YES', async () => {
    // The alias hides the target table from the analyser (table = null).
    const sql = 'UPDATE subjects s SET s.ects = 4 WHERE s.semester = 7';
    const preview = await json(await call({ mode: 'preview', sql }));
    expect(preview.table).toBeNull();
    expect(preview.affected).toBe(101);
    const refused = await call({
      mode: 'execute',
      sql,
      token: preview.token,
      confirm: 'subjects',
    });
    expect(refused.status).toBe(400);
    expect(await ectsOf('B000')).toBe(2);
    const res = await call({
      mode: 'execute',
      sql,
      token: preview.token,
      confirm: 'YES',
    });
    expect(res.status).toBe(200);
    expect((await json(res)).affected).toBe(101);
    expect(await ectsOf('B000')).toBe(4);
  });

  it('tables outside the grants are refused with the permission message', async () => {
    const before = await auditCount('sql.execute');
    const rejectedBefore = await auditCount('sql.rejected');
    for (const sql of [
      'UPDATE subjects SET name = (SELECT display_name FROM users LIMIT 1)',
      'INSERT INTO tags (subject_id, name, discord_tag_id) SELECT 1, display_name, discord_user_id FROM users',
    ]) {
      const preview = await call({ mode: 'preview', sql });
      expect(preview.status, sql).toBe(400);
      expect((await json(preview)).error).toBe(
        "Table `users` is outside the console's scope.",
      );

      const token = signPreview({
        userId: admin.id,
        sql,
        affected: 1,
        at: Date.now(),
      });
      const res = await call({ mode: 'execute', sql, token });
      expect(res.status, sql).toBe(400);
      expect((await json(res)).error).toBe(
        "Table `users` is outside the console's scope.",
      );
    }
    expect(await auditCount('sql.execute')).toBe(before);
    expect(await auditCount('sql.rejected')).toBe(rejectedBefore + 4);
    expect((await db.select({ n: count() }).from(tags))[0].n).toBe(0);
    expect(
      (
        await db
          .select({ n: count() })
          .from(subjects)
          .where(eq(subjects.name, 'Ada'))
      )[0].n,
    ).toBe(0);
  });

  describe('grant refusals from MariaDB are audited', () => {
    const text1143 =
      "UPDATE command denied to user 'u'@'h' for column 'topic_id' in table 'events'";
    const text1142 =
      "SELECT command denied to user 'u'@'h' for table `studies`.`users`";
    const fakePool = (message: string, errno: number) =>
      ({
        getConnection: async () => ({
          query: async (q: unknown) => {
            const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
            if (/^(BEGIN|ROLLBACK)/.test(sql)) return [[], []];
            throw Object.assign(new Error(message), {
              errno,
              sqlState: '42000',
            });
          },
          destroy: () => {},
        }),
      }) as unknown as mysql.Pool;
    const cases = [
      {
        name: '1143',
        pool: () => fakePool(text1143, 1143),
        sql: 'UPDATE events SET topic_id = 1 WHERE id = 1',
        error:
          "Column `topic_id` of `events` can't be changed from the console.",
        table: 'events',
        column: 'topic_id',
      },
      {
        name: '1142',
        pool: () => fakePool(text1142, 1142),
        sql: 'DELETE FROM users WHERE id = 1',
        error: "Table `users` is outside the console's scope.",
        table: 'users',
        column: undefined,
      },
    ];
    for (const c of cases) {
      for (const mode of ['preview', 'execute'] as const) {
        it(`${c.name} on ${mode}: 400, message and one audit row`, async () => {
          const before = await auditCount('sql.rejected');
          const token =
            mode === 'execute'
              ? signPreview({
                  userId: admin.id,
                  sql: c.sql,
                  affected: 1,
                  at: Date.now(),
                })
              : undefined;
          // `users` is a cascade parent: the DELETE carries its confirmation.
          const res = await call(
            { mode, sql: c.sql, token, confirm: c.table },
            { rw: c.pool() },
          );
          expect(res.status).toBe(400);
          expect((await json(res)).error).toBe(c.error);
          expect(await auditCount('sql.rejected')).toBe(before + 1);
          const rows = await db
            .select()
            .from(adminAudit)
            .where(eq(adminAudit.action, 'sql.rejected'));
          const last = rows[rows.length - 1];
          expect(last.statement).toBe(c.sql);
          expect(last.details).toMatchObject({
            mode,
            reason: 'permission',
            table: c.table,
            ...(c.column ? { column: c.column } : {}),
          });
        });
      }
    }
  });

  it('real grants: a column-restricted UPDATE is refused, explained and audited', async () => {
    const sql = 'UPDATE events SET topic_id = topic_id WHERE id = 0';
    const before = await auditCount('sql.rejected');
    const res = await call({ mode: 'preview', sql });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(
      "Column `topic_id` of `events` can't be changed from the console.",
    );
    const rows = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, 'sql.rejected'));
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1].details).toMatchObject({
      reason: 'permission',
      errno: 1143,
      table: 'events',
      column: 'topic_id',
    });
  });

  it('a rejected statement is 400 with one sql.rejected audit row', async () => {
    const before = await auditCount('sql.rejected');
    const res = await call({ mode: 'preview', sql: 'DROP TABLE tags' });
    expect(res.status).toBe(400);
    expect((await json(res)).ok).toBe(false);
    const rows = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, 'sql.rejected'));
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({
      userId: admin.id,
      statement: 'DROP TABLE tags',
    });
  });

  it('a unique-key violation is 400, commits nothing and writes no audit row', async () => {
    const before = await auditCount('sql.execute');
    const sql =
      "INSERT INTO subjects (name, code, semester, ects) VALUES ('Dup', 'ASD', 1, 1)";
    const preview = await call({ mode: 'preview', sql });
    expect(preview.status).toBe(400);
    expect((await json(preview)).error).toMatch(/Duplicate/);

    const token = signPreview({
      userId: admin.id,
      sql,
      affected: 1,
      at: Date.now(),
    });
    const res = await call({ mode: 'execute', sql, token });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/Duplicate/);
    expect(
      (
        await db
          .select({ n: count() })
          .from(subjects)
          .where(eq(subjects.name, 'Dup'))
      )[0].n,
    ).toBe(0);
    expect(await auditCount('sql.execute')).toBe(before);
  });

  it('INSERT preview shows the inserted rows and rolls back', async () => {
    const sql =
      "INSERT INTO subjects (name, code, semester, ects) VALUES ('Nowy', 'NEW1', 2, 3)";
    const res = await call({ mode: 'preview', sql });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      kind: 'insert',
      table: 'subjects',
      affected: 1,
    });
    expect(body.rows).toHaveLength(1);
    expect(body.rows?.[0][body.columns?.indexOf('code') ?? -1]).toBe('NEW1');
    expect(await ectsOf('NEW1')).toBeUndefined();
  });

  it('INSERT/DELETE … RETURNING count and show the returned rows', async () => {
    const ins =
      "INSERT INTO subjects (name, code, semester, ects) VALUES ('Ret', 'RET1', 2, 3) RETURNING code";
    const p = await json(await call({ mode: 'preview', sql: ins }));
    expect(p).toMatchObject({ ok: true, affected: 1, columns: ['code'] });
    expect(p.rows).toEqual([['RET1']]);
    expect(await ectsOf('RET1')).toBeUndefined();
    const e = await json(
      await call({ mode: 'execute', sql: ins, token: p.token }),
    );
    expect(e).toMatchObject({ ok: true, affected: 1 });
    expect(await ectsOf('RET1')).toBe(3);

    const del = "DELETE FROM subjects WHERE code = 'RET1' RETURNING code";
    const d = await json(await call({ mode: 'preview', sql: del }));
    expect(d).toMatchObject({ ok: true, kind: 'delete', affected: 1 });
    // subjects is a cascade parent: confirmed by name.
    const x = await json(
      await call({
        mode: 'execute',
        sql: del,
        token: d.token,
        confirm: 'subjects',
      }),
    );
    expect(x).toMatchObject({ ok: true, affected: 1 });
    expect(await ectsOf('RET1')).toBeUndefined();
  });

  it('SELECT returns rows without an audit row', async () => {
    const before = (await db.select({ n: count() }).from(adminAudit))[0].n;
    const res = await call({
      mode: 'preview',
      sql: "SELECT code, ects FROM subjects WHERE code = 'ASD'",
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      ok: true,
      kind: 'select',
      columns: ['code', 'ects'],
      rows: [['ASD', 9]],
      truncated: false,
    });
    const big = await json(
      await call({
        mode: 'execute',
        sql: 'SELECT a.id, b.id FROM subjects a CROSS JOIN subjects b',
      }),
    );
    expect(big.rows).toHaveLength(500);
    expect(big.truncated).toBe(true);
    expect((await db.select({ n: count() }).from(adminAudit))[0].n).toBe(
      before,
    );
  });

  it('400 for a malformed body', async () => {
    for (const body of [
      {},
      { mode: 'run', sql: 'SELECT 1' },
      { mode: 'preview', sql: 1 },
      { mode: 'preview', sql: 'x'.repeat(20_001) },
    ])
      expect((await call(body)).status, JSON.stringify(body)).toBe(400);
  });

  it('503 when the RW pool is not configured', async () => {
    const res = await call({ mode: 'preview', sql: 'SELECT 1' }, { rw: null });
    expect(res.status).toBe(503);
    expect((await json(res)).ok).toBe(false);
  });

  it('503 with a generic message when the database is unreachable', async () => {
    const bad = mysql.createPool({
      uri: 'mysql://ghost:secret@127.0.0.1:1/nope',
      connectTimeout: 1000,
    });
    try {
      for (const sql of ['SELECT 1', update]) {
        const res = await call({ mode: 'preview', sql }, { rw: bad });
        expect(res.status).toBe(503);
        const body = await json(res);
        expect(body.error).toBe(CONNECT_ERROR);
        expect(JSON.stringify(body)).not.toMatch(/127\.0\.0\.1|ghost|:1\b/);
      }
    } finally {
      await bad.end();
    }
  });

  it('429 on the 21st request in a minute', async () => {
    const limiter = createRateLimiter(20, 60_000);
    for (let i = 0; i < 20; i++) {
      const res = await call({ mode: 'preview', sql: 'SELECT 1' }, { limiter });
      expect(res.status).toBe(200);
    }
    const res = await call({ mode: 'preview', sql: 'SELECT 1' }, { limiter });
    expect(res.status).toBe(429);
  });

  it('500 when the audit write fails after commit (the change stays)', async () => {
    const sql = "UPDATE subjects SET ects = 4 WHERE code = 'ASD'";
    const preview = await json(await call({ mode: 'preview', sql }));
    audit.fail = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await call({ mode: 'execute', sql, token: preview.token });
      expect(res.status).toBe(500);
      expect((await json(res)).error).toContain(
        'The change was saved, but writing the audit log failed',
      );
      expect(err).toHaveBeenCalled();
    } finally {
      audit.fail = false;
      err.mockRestore();
    }
    expect(await ectsOf('ASD')).toBe(4);
  });
});
