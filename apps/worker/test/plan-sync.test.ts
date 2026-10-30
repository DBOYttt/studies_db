import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  classSessions,
  type Db,
  getPlanSyncStatus,
  type PlanSyncStatus,
  requestPlanSync,
  unitimeFeeds,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  fetchTimetable,
  planSyncDue,
  resetNoSourceLog,
  runPlanSyncOnce,
  SafeSyncError,
} from '../src/plan-sync.js';

const ics = readFileSync(
  fileURLToPath(
    new URL('../../../packages/db/test/fixtures/unitime.ics', import.meta.url),
  ),
  'utf8',
);

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '';
    if (path.startsWith('/ok')) {
      res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' });
      res.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    } else if (path.startsWith('/redir-same')) {
      res.writeHead(302, { location: '/ok?moved=1' });
      res.end();
    } else if (path.startsWith('/redir-other')) {
      // Same server under another host name: must not be followed.
      const port = (server.address() as AddressInfo).port;
      res.writeHead(302, { location: `http://localhost:${port}/ok` });
      res.end();
    } else if (path.startsWith('/redir-loop')) {
      res.writeHead(301, { location: '/redir-loop' });
      res.end();
    } else if (path.startsWith('/err')) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('boom');
    } else if (path.startsWith('/html')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html></html>');
    } else if (path.startsWith('/big')) {
      res.writeHead(200, { 'content-type': 'text/calendar' });
      res.end(Buffer.alloc(6 * 1024 * 1024, 'a'));
    } else if (path.startsWith('/slow')) {
      res.writeHead(200, { 'content-type': 'text/calendar' });
      res.write('BEGIN:VCALENDAR\r\n');
      // never ends
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const host = () => new URL(base).host;

describe('fetchTimetable', () => {
  it('returns the body for text/calendar', async () => {
    expect(await fetchTimetable(`${base}/ok?x=secret`)).toContain(
      'BEGIN:VCALENDAR',
    );
  });
  it('rejects on HTTP 500 naming host only', async () => {
    const err = await fetchTimetable(`${base}/err/secretpath?x=secret`).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(SafeSyncError);
    expect((err as Error).message).toBe(`HTTP 500 from ${host()}`);
  });
  it('rejects text/html', async () => {
    const err = await fetchTimetable(`${base}/html?x=secret`).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(SafeSyncError);
    expect((err as Error).message).toBe(
      `Unexpected response type (text/html) from ${host()}`,
    );
  });
  it('rejects an empty response', async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/calendar' },
      })) as typeof fetch;
    const err = await fetchTimetable(`${base}/x?x=secret`, { fetchImpl }).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(SafeSyncError);
    expect((err as Error).message).toBe(`Empty response from ${host()}`);
  });
  it('rejects oversized bodies', async () => {
    const err = await fetchTimetable(`${base}/big?x=secret`).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(SafeSyncError);
    expect((err as Error).message).toBe(
      `The response from ${host()} is too large`,
    );
  });
  it('rejects on timeout', async () => {
    const err = await fetchTimetable(`${base}/slow?x=secret`, {
      timeoutMs: 100,
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SafeSyncError);
    expect((err as Error).message).toBe(`Timed out waiting for ${host()}`);
  });
  it('follows a redirect on the same host (L4)', async () => {
    expect(await fetchTimetable(`${base}/redir-same?x=secret`)).toContain(
      'BEGIN:VCALENDAR',
    );
  });
  it('refuses a redirect to another host, naming the first host only (L4)', async () => {
    const err = await fetchTimetable(`${base}/redir-other?x=secret`).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(SafeSyncError);
    expect((err as Error).message).toBe(`${host()} redirected to another host`);
  });
  it('refuses a downgrade from https to http (L4)', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return new Response(null, {
        status: 302,
        headers: { location: 'http://feed.example/cal.ics' },
      });
    }) as typeof fetch;
    const err = await fetchTimetable('https://feed.example/cal.ics?k=s', {
      fetchImpl,
    }).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      'feed.example redirected to another host',
    );
    expect(calls).toHaveLength(1);
  });
  it('gives up after a few redirects (L4)', async () => {
    const err = await fetchTimetable(`${base}/redir-loop?x=secret`).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(SafeSyncError);
    expect((err as Error).message).toBe(`Too many redirects from ${host()}`);
  });
  it('replaces an unexpected error with a generic message (no URL leak)', async () => {
    const url = `${base}/x/secretpath?x=secret`;
    const fetchImpl = (async () => {
      throw new Error(`connect failed for ${url}`);
    }) as typeof fetch;
    const err = await fetchTimetable(url, { fetchImpl }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SafeSyncError);
    const msg = (err as Error).message;
    expect(msg).toBe(`Could not download the timetable from ${host()}`);
    expect(msg).not.toContain('secret');
  });
});

describe('planSyncDue', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const H = 3600_000;
  const base6: PlanSyncStatus = {
    requestedAt: null,
    lastRunAt: null,
    lastOkAt: null,
    lastError: null,
    stats: null,
  };
  it('never run -> due', () =>
    expect(planSyncDue(base6, now, 6 * H)).toBe(true));
  it('5 h ago -> not due', () =>
    expect(
      planSyncDue(
        { ...base6, lastRunAt: new Date(now.getTime() - 5 * H) },
        now,
        6 * H,
      ),
    ).toBe(false));
  it('7 h ago -> due', () =>
    expect(
      planSyncDue(
        { ...base6, lastRunAt: new Date(now.getTime() - 7 * H) },
        now,
        6 * H,
      ),
    ).toBe(true));
  it('requested after last run -> due', () =>
    expect(
      planSyncDue(
        {
          ...base6,
          lastRunAt: new Date(now.getTime() - 1 * H),
          requestedAt: new Date(now.getTime() - 0.5 * H),
        },
        now,
        6 * H,
      ),
    ).toBe(true));
  it('requested before last run -> not due', () =>
    expect(
      planSyncDue(
        {
          ...base6,
          lastRunAt: new Date(now.getTime() - 1 * H),
          requestedAt: new Date(now.getTime() - 2 * H),
        },
        now,
        6 * H,
      ),
    ).toBe(false));
});

describe('runPlanSyncOnce', () => {
  let db: Db;
  beforeAll(async () => {
    db = await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  const okFetch = (async () =>
    new Response(ics, {
      headers: { 'content-type': 'text/calendar' },
    })) as typeof fetch;

  it('syncs and records ok status', async () => {
    await runPlanSyncOnce({
      db,
      url: 'https://unitime.example.edu/ical?x=secret',
      fetchImpl: okFetch,
    });
    const s = await getPlanSyncStatus(db);
    expect(s.lastError).toBeNull();
    expect(s.lastOkAt).not.toBeNull();
    expect((await db.select().from(classSessions)).length).toBeGreaterThan(0);
  });

  it('records failure without leaking the url and keeps old sessions', async () => {
    const before = (await db.select().from(classSessions)).length;
    const failing = (async () => {
      throw new Error(
        'connect failed https://unitime.example.edu/ical?x=secret',
      );
    }) as typeof fetch;
    await runPlanSyncOnce({
      db,
      url: 'https://unitime.example.edu/ical?x=secret',
      fetchImpl: failing,
    });
    const s = await getPlanSyncStatus(db);
    expect(s.lastError).toBeTruthy();
    expect(s.lastError).not.toContain('?x=');
    expect(s.lastError).not.toContain('secret');
    expect((await db.select().from(classSessions)).length).toBe(before);
  });

  it('keeps a request made during the run pending', async () => {
    const start = new Date('2026-10-12T10:00:00Z');
    const end = new Date('2026-10-12T10:00:05Z');
    const mid = new Date('2026-10-12T10:00:02Z');
    const times = [start, end];
    const fetchImpl = (async () => {
      await requestPlanSync(db, mid);
      return new Response(ics, {
        headers: { 'content-type': 'text/calendar' },
      });
    }) as typeof fetch;
    await runPlanSyncOnce({
      db,
      url: 'https://unitime.example.edu/ical?x=secret',
      fetchImpl,
      now: () => times.shift() ?? end,
    });
    const s = await getPlanSyncStatus(db);
    expect(s.lastRunAt).toEqual(start);
    expect(planSyncDue(s, end, 6 * 3600_000)).toBe(true);
  });
});

describe('runPlanSyncOnce with an exam feed', () => {
  let db: Db;
  beforeAll(async () => {
    db = await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  const CLASS_URL = 'https://unitime.example.edu/ical?x=secret';
  const EXAM_URL = 'https://exams.example.edu/ical/secretpath?x=examsecret';
  const examIcs = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Egzaminy',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Warsaw:20270201T090000',
    'DTEND;TZID=Europe/Warsaw:20270201T110000',
    'LOCATION:A-0 1',
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'UID:700000001',
    'SUMMARY:Algebra liniowa (1rok)',
    'DESCRIPTION:Pisemny',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  function fakeFetch(
    exam: 'ok' | 'fail',
    seen: string[],
    classes: 'ok' | 'fail' = 'ok',
  ): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (url === CLASS_URL && classes === 'fail')
        throw new Error(`connect failed for ${url}`);
      if (url === EXAM_URL) {
        if (exam === 'fail') throw new Error(`connect failed for ${url}`);
        return new Response(examIcs, {
          headers: { 'content-type': 'text/calendar' },
        });
      }
      return new Response(ics, {
        headers: { 'content-type': 'text/calendar' },
      });
    }) as typeof fetch;
  }

  it('without an exam URL fetches only the class feed', async () => {
    const seen: string[] = [];
    await runPlanSyncOnce({
      db,
      url: CLASS_URL,
      fetchImpl: fakeFetch('ok', seen),
    });
    expect(seen).toEqual([CLASS_URL]);
    expect((await getPlanSyncStatus(db)).lastError).toBeNull();
  });

  it('syncs both feeds; exam feed rows are exams', async () => {
    const seen: string[] = [];
    await runPlanSyncOnce({
      db,
      url: CLASS_URL,
      examUrl: EXAM_URL,
      fetchImpl: fakeFetch('ok', seen),
    });
    expect(seen).toEqual([CLASS_URL, EXAM_URL]);
    const s = await getPlanSyncStatus(db);
    expect(s.lastError).toBeNull();
    const rows = await db.select().from(classSessions);
    const exam = rows.find((r) => r.uid === '700000001');
    expect(exam).toMatchObject({ kind: 'exam', source: 'exams' });
    expect(rows.filter((r) => r.source === 'classes').length).toBeGreaterThan(
      0,
    );
  });

  it('an exam feed failure is recorded host-only and class sessions still sync', async () => {
    await db.delete(classSessions);
    const startedAt = new Date('2026-10-13T10:00:00Z');
    await runPlanSyncOnce({
      db,
      url: CLASS_URL,
      examUrl: EXAM_URL,
      fetchImpl: fakeFetch('fail', []),
      now: () => startedAt,
    });
    const s = await getPlanSyncStatus(db);
    expect(s.lastError).toBe(
      'Exam timetable: Could not download the timetable from exams.example.edu',
    );
    expect(s.lastOkAt).toEqual(startedAt);
    expect(s.stats?.created).toBeGreaterThan(0);
    const rows = await db.select().from(classSessions);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === 'classes')).toBe(true);
  });

  it('a class feed failure is recorded while the exam feed is still written', async () => {
    await db.delete(classSessions);
    const before = await getPlanSyncStatus(db);
    expect(before.lastOkAt).not.toBeNull();
    const startedAt = new Date('2026-10-14T10:00:00Z');
    await runPlanSyncOnce({
      db,
      url: CLASS_URL,
      examUrl: EXAM_URL,
      fetchImpl: fakeFetch('ok', [], 'fail'),
      now: () => startedAt,
    });
    const s = await getPlanSyncStatus(db);
    expect(s.lastRunAt).toEqual(startedAt);
    expect(s.lastOkAt).toEqual(before.lastOkAt);
    expect(s.lastError).toBe(
      'Could not download the timetable from unitime.example.edu',
    );
    expect(s.lastError).not.toContain('secret');
    const rows = await db.select().from(classSessions);
    expect(rows.map((r) => [r.uid, r.kind, r.source])).toEqual([
      ['700000001', 'exam', 'exams'],
    ]);
  });
});

describe('runPlanSyncOnce with semester feeds', () => {
  let db: Db;
  beforeAll(async () => {
    db = await resetTestDb();
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  const env = {
    UNITIME_IMPORT_HOSTS: 'unitime.example.edu,exams.example.edu',
  } as NodeJS.ProcessEnv;
  const C3 = 'https://unitime.example.edu/ical/three?x=secret3';
  const C5 = 'https://unitime.example.edu/ical/five?x=secret5';
  const E3 = 'https://exams.example.edu/ical/exam3?x=examsecret3';
  const ENV_URL = 'https://unitime.example.edu/ical/env?x=envsecret';
  const icsFor = (n: string) => ics.replace(/^UID:/gm, `UID:s${n}-`);
  const examIcs = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Egzaminy',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Warsaw:20270201T090000',
    'DTEND;TZID=Europe/Warsaw:20270201T110000',
    'LOCATION:A-0 1',
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'UID:e3-1',
    'SUMMARY:Algebra liniowa (1rok)',
    'DESCRIPTION:Pisemny',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  function feedFetch(seen: string[], failing: string[] = []): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      if (failing.includes(url)) throw new Error(`connect failed for ${url}`);
      const body =
        url === C3
          ? icsFor('3')
          : url === C5
            ? icsFor('5')
            : url === E3
              ? examIcs
              : ics;
      return new Response(body, {
        headers: { 'content-type': 'text/calendar' },
      });
    }) as typeof fetch;
  }

  async function setFeeds(
    rows: { semester: number; classUrl: string; examUrl?: string }[],
  ) {
    await db.delete(unitimeFeeds);
    if (rows.length) await db.insert(unitimeFeeds).values(rows);
  }

  it('syncs every stored feed in semester order with its feed_semester', async () => {
    await db.delete(classSessions);
    await setFeeds([
      { semester: 5, classUrl: C5 },
      { semester: 3, classUrl: C3 },
    ]);
    const seen: string[] = [];
    await runPlanSyncOnce({ db, env, fetchImpl: feedFetch(seen) });
    expect(seen).toEqual([C3, C5]);
    const rows = await db.select().from(classSessions);
    expect(new Set(rows.map((r) => r.feedSemester))).toEqual(new Set([3, 5]));
    const s = await getPlanSyncStatus(db);
    expect(s.lastError).toBeNull();
    expect(s.stats?.feeds?.map((f) => [f.semester, f.ok])).toEqual([
      [3, true],
      [5, true],
    ]);
  });

  it('a failing feed does not stop the others and never leaks its URL', async () => {
    await db.delete(classSessions);
    await setFeeds([
      { semester: 3, classUrl: C3 },
      { semester: 5, classUrl: C5 },
    ]);
    const seen: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runPlanSyncOnce({ db, env, fetchImpl: feedFetch(seen, [C3]) });
      const out = [...errSpy.mock.calls, ...logSpy.mock.calls]
        .flat()
        .join('\n');
      expect(out).not.toContain('secret');
      expect(out).not.toContain('/ical/');
    } finally {
      errSpy.mockRestore();
      logSpy.mockRestore();
    }
    expect(seen).toEqual([C3, C5]);
    const s = await getPlanSyncStatus(db);
    expect(s.lastError).toContain('Semester 3:');
    expect(s.lastError).toContain('unitime.example.edu');
    expect(s.lastError).not.toContain('secret');
    expect(s.lastError).not.toContain('https://');
    expect(s.lastOkAt).not.toBeNull();
    expect(s.stats?.feeds?.map((f) => [f.semester, f.ok])).toEqual([
      [3, false],
      [5, true],
    ]);
    const rows = await db.select().from(classSessions);
    expect(rows.every((r) => r.feedSemester === 5)).toBe(true);
  });

  it('refuses a stored feed on a host that is not allowed', async () => {
    await setFeeds([
      { semester: 4, classUrl: 'https://evil.example.org/x?k=s' },
    ]);
    const seen: string[] = [];
    await runPlanSyncOnce({ db, env, fetchImpl: feedFetch(seen) });
    expect(seen).toEqual([]);
    const s = await getPlanSyncStatus(db);
    expect(s.lastError).toBe('Semester 4: host not allowed');
  });

  it('removes unscoped leftovers only when every class feed succeeded', async () => {
    await db.delete(classSessions);
    await setFeeds([]);
    await runPlanSyncOnce({
      db,
      url: ENV_URL,
      env,
      fetchImpl: feedFetch([]),
    });
    const nullRows = async () =>
      (await db.select().from(classSessions)).filter(
        (r) => r.feedSemester === null,
      ).length;
    expect(await nullRows()).toBeGreaterThan(0);

    await setFeeds([
      { semester: 3, classUrl: C3 },
      { semester: 5, classUrl: C5 },
    ]);
    await runPlanSyncOnce({ db, env, fetchImpl: feedFetch([], [C5]) });
    expect(await nullRows()).toBeGreaterThan(0);

    await runPlanSyncOnce({ db, env, fetchImpl: feedFetch([]) });
    expect(await nullRows()).toBe(0);
  });

  it('without stored feeds the env feed behaves as before (rows NULL)', async () => {
    await db.delete(classSessions);
    await setFeeds([]);
    await runPlanSyncOnce({ db, url: ENV_URL, env, fetchImpl: feedFetch([]) });
    const rows = await db.select().from(classSessions);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.feedSemester === null)).toBe(true);
  });

  it('with no feeds and no URL nothing is fetched, status is untouched and the notice logs once', async () => {
    await setFeeds([]);
    const before = await getPlanSyncStatus(db);
    const seen: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    resetNoSourceLog();
    try {
      await runPlanSyncOnce({ db, env, fetchImpl: feedFetch(seen) });
      await runPlanSyncOnce({ db, env, fetchImpl: feedFetch(seen) });
      const lines = logSpy.mock.calls
        .flat()
        .filter((l) => String(l).includes('brak źródeł planu'));
      expect(lines).toHaveLength(1);
    } finally {
      logSpy.mockRestore();
    }
    expect(seen).toEqual([]);
    expect(await getPlanSyncStatus(db)).toEqual(before);
  });

  it("runs a semester's exam feed right after its class feed as exams", async () => {
    await db.delete(classSessions);
    await setFeeds([
      { semester: 3, classUrl: C3, examUrl: E3 },
      { semester: 5, classUrl: C5 },
    ]);
    const seen: string[] = [];
    await runPlanSyncOnce({ db, env, fetchImpl: feedFetch(seen) });
    expect(seen).toEqual([C3, E3, C5]);
    const exam = (await db.select().from(classSessions)).find(
      (r) => r.uid === 'e3-1',
    );
    expect(exam).toMatchObject({
      kind: 'exam',
      source: 'exams',
      feedSemester: 3,
    });
  });

  it('an exam feed failure marks only the exam part', async () => {
    await db.delete(classSessions);
    await setFeeds([{ semester: 3, classUrl: C3, examUrl: E3 }]);
    await runPlanSyncOnce({ db, env, fetchImpl: feedFetch([], [E3]) });
    const s = await getPlanSyncStatus(db);
    expect(s.lastError).toContain('Semester 3');
    expect(s.lastError).not.toContain('secret');
    expect(s.stats?.feeds?.[0]).toMatchObject({ semester: 3, ok: true });
  });
});
