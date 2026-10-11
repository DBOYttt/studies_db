import {
  consumeLoginToken,
  createLoginToken,
  type Db,
  PUBLIC_VIEWS,
  subjects,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
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
  browseView,
  listViewColumns,
  PAGE_SIZE,
  parseViewParams,
  viewQueryString,
} = await import('../lib/tables');
const { GET: CSV } = await import('../app/(app)/tables/[view]/csv/route');
const { GET, dynamic } = await import('../app/api/schema/route');

let sid: string;

beforeAll(async () => {
  db = await resetTestDb();
  roPool = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 3,
  });
  const rows = Array.from({ length: 119 }, (_, i) => ({
    name: `Przedmiot ${String(i + 1).padStart(3, '0')}`,
    code: `P${i + 1}`,
    semester: (i % 7) + 1,
    ects: 5,
    discordChannelId: `ch${i + 1}`,
  }));
  rows.push({
    name: 'Mechanika 50%_x',
    code: 'MECH',
    semester: 2,
    ects: 6,
    discordChannelId: 'mech',
  });
  await db.insert(subjects).values(rows);
  const userId = await upsertUser(db, {
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

describe('listViewColumns', () => {
  it('returns ordered columns for every public view', async () => {
    const cols = await listViewColumns(roPool);
    expect(Object.keys(cols).sort()).toEqual([...PUBLIC_VIEWS].sort());
    expect(cols.v_users).toEqual(['id', 'display_name', 'created_at']);
    expect(cols.v_subjects[0]).toBe('id');
    expect(cols.v_subjects).toContain('name');
  });
  it('is cached', async () => {
    const a = await listViewColumns(roPool);
    const b = await listViewColumns(roPool);
    expect(b).toBe(a);
  });
});

describe('browseView', () => {
  it('returns null for non-public views', async () => {
    expect(await browseView(roPool, 'sessions', {})).toBeNull();
    expect(await browseView(roPool, 'v_subjects`; --', {})).toBeNull();
    expect(await browseView(roPool, 'constructor', {})).toBeNull();
  });

  it('paginates with page size 50', async () => {
    expect(PAGE_SIZE).toBe(50);
    const p1 = await browseView(roPool, 'v_subjects', {});
    expect(p1).toMatchObject({ total: 120, page: 1, pageCount: 3 });
    expect(p1?.rows.length).toBe(50);
    expect(p1?.columns[0]).toBe('id');
    const p2 = await browseView(roPool, 'v_subjects', { page: 2 });
    expect(p2).toMatchObject({ total: 120, page: 2, pageCount: 3 });
    expect(p2?.rows.length).toBe(50);
    expect(p2?.rows[0][0]).not.toBe(p1?.rows[0][0]);
    const p3 = await browseView(roPool, 'v_subjects', { page: 3 });
    expect(p3?.rows.length).toBe(20);
  });

  it('clamps the page', async () => {
    expect(await browseView(roPool, 'v_subjects', { page: 0 })).toMatchObject({
      page: 1,
    });
    expect(await browseView(roPool, 'v_subjects', { page: -5 })).toMatchObject({
      page: 1,
    });
    expect(
      await browseView(roPool, 'v_subjects', { page: Number.NaN }),
    ).toMatchObject({ page: 1 });
    const last = await browseView(roPool, 'v_subjects', { page: 99 });
    expect(last).toMatchObject({ page: 3 });
    expect(last?.rows.length).toBe(20);
  });

  it('sorts by a whitelisted column and ignores unknown ones', async () => {
    const desc = await browseView(roPool, 'v_subjects', {
      sort: 'name',
      dir: 'desc',
    });
    const nameIdx = desc?.columns.indexOf('name') ?? -1;
    expect(desc?.rows[0][nameIdx]).toBe('Przedmiot 119');
    const asc = await browseView(roPool, 'v_subjects', {
      sort: 'name',
      dir: 'asc',
    });
    expect(asc?.rows[0][nameIdx]).toBe('Mechanika 50%_x');
    const evil = await browseView(roPool, 'v_subjects', { sort: '1;DROP' });
    expect(evil).toMatchObject({ total: 120, page: 1 });
    const evil2 = await browseView(roPool, 'v_subjects', {
      sort: 'name',
      dir: 'desc; DROP' as 'desc',
    });
    expect(evil2?.total).toBe(120);
  });

  it('filters with LIKE on whitelisted columns', async () => {
    const r = await browseView(roPool, 'v_subjects', {
      filters: { name: 'Mech' },
    });
    expect(r).toMatchObject({ total: 1, page: 1, pageCount: 1 });
    expect(r?.rows[0]).toContain('MECH');
    // numeric columns via CAST
    const s = await browseView(roPool, 'v_subjects', {
      filters: { ects: '6' },
    });
    expect(s?.total).toBe(1);
    // LIKE wildcards in the value are literal
    expect(
      (await browseView(roPool, 'v_subjects', { filters: { name: '%' } }))
        ?.total,
    ).toBe(1);
    expect(
      (await browseView(roPool, 'v_subjects', { filters: { name: '0%_' } }))
        ?.total,
    ).toBe(1);
    // unknown columns and empty values are ignored
    const u = await browseView(roPool, 'v_subjects', {
      filters: { 'name`=1 OR 1=1 -- ': 'x', bogus: 'x', name: '' },
    });
    expect(u?.total).toBe(120);
    // no match -> empty page, pageCount 1
    expect(
      await browseView(roPool, 'v_subjects', { filters: { name: 'zzz' } }),
    ).toMatchObject({ total: 0, page: 1, pageCount: 1, rows: [] });
  });

  it('returns JSON-serialisable rows', async () => {
    const r = await browseView(roPool, 'v_subjects', {});
    const createdIdx = r?.columns.indexOf('created_at') ?? -1;
    expect(r?.rows[0][createdIdx]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('GET /api/schema', () => {
  it('is dynamic', () => {
    expect(dynamic).toBe('force-dynamic');
  });
  it('redirects without a session', async () => {
    cookieSid = undefined;
    await expect(GET()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*\/login-info;/),
    });
  });
  it('returns view columns', async () => {
    cookieSid = sid;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.columns.v_users).toEqual(['id', 'display_name', 'created_at']);
    expect(Object.keys(body.columns).length).toBe(PUBLIC_VIEWS.length);
    expect(body.relations).toHaveLength(15);
  });
});

describe('parseViewParams / viewQueryString', () => {
  it('reads sort, dir, f_<col> and page from URLSearchParams or a record', () => {
    const fromUrl = parseViewParams(
      new URLSearchParams('sort=name&dir=desc&f_name=Me&f_code=&page=3&x=1'),
    );
    expect(fromUrl).toEqual({
      sort: 'name',
      dir: 'desc',
      filters: { name: 'Me' },
      page: 3,
    });
    const fromRecord = parseViewParams({
      sort: ['ects', 'name'],
      dir: 'sideways',
      f_name: 'x'.repeat(300),
    });
    expect(fromRecord.sort).toBe('ects');
    expect(fromRecord.dir).toBe('asc');
    expect(fromRecord.filters.name).toHaveLength(200);
    expect(fromRecord.page).toBe(1);
  });
  it('round-trips without the page', () => {
    const q = parseViewParams(
      new URLSearchParams('sort=name&dir=desc&f_name=Me&page=2'),
    );
    expect(viewQueryString(q).toString()).toBe('sort=name&dir=desc&f_name=Me');
    expect(viewQueryString({ filters: {} }).toString()).toBe('');
  });
});

describe('GET /tables/[view]/csv', () => {
  const csv = (view: string, qs = '') =>
    CSV(new Request(`http://localhost/tables/${view}/csv${qs}`), {
      params: Promise.resolve({ view }),
    });
  const lines = async (res: Response) =>
    (await res.text())
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');

  it('redirects without a session', async () => {
    cookieSid = undefined;
    await expect(csv('v_subjects')).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*\/login-info;/),
    });
  });

  it('exports every row without params; 404 for non-public views', async () => {
    cookieSid = sid;
    const res = await csv('v_subjects');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(await lines(res)).toHaveLength(1 + 120);
    expect((await csv('sessions')).status).toBe(404);
  });

  it('applies the same filters and sort as the table page', async () => {
    cookieSid = sid;
    const filtered = await lines(await csv('v_subjects', '?f_name=Mech'));
    expect(filtered).toHaveLength(2);
    expect(filtered[1]).toContain('MECH');

    const sorted = await lines(
      await csv('v_subjects', '?sort=name&dir=desc&f_name=Przedmiot%2011'),
    );
    const header = sorted[0].split(',');
    const nameIdx = header.indexOf('name');
    const names = sorted.slice(1).map((l) => l.split(',')[nameIdx]);
    expect(names).toEqual([
      'Przedmiot 119',
      'Przedmiot 118',
      'Przedmiot 117',
      'Przedmiot 116',
      'Przedmiot 115',
      'Przedmiot 114',
      'Przedmiot 113',
      'Przedmiot 112',
      'Przedmiot 111',
      'Przedmiot 110',
    ]);
    // same as the page builder
    const page = await browseView(roPool, 'v_subjects', {
      sort: 'name',
      dir: 'desc',
      filters: { name: 'Przedmiot 11' },
    });
    expect(page?.rows.map((r) => r[nameIdx])).toEqual(names);
  });

  it('ignores unknown columns and treats LIKE wildcards literally', async () => {
    cookieSid = sid;
    expect(
      await lines(await csv('v_subjects', '?f_bogus=x&sort=1%3BDROP')),
    ).toHaveLength(121);
    expect(await lines(await csv('v_subjects', '?f_name=%25'))).toHaveLength(2);
  });
});
