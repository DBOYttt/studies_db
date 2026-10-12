import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  classSessions,
  type Db,
  getPlanSyncStatus,
  type PlanSyncStatus,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fetchTimetable,
  planSyncDue,
  runPlanSyncOnce,
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
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain('127.0.0.1');
    expect(msg).toContain('500');
    expect(msg).not.toContain('secret');
    expect(msg).not.toContain('?x=');
  });
  it('rejects text/html', async () => {
    await expect(fetchTimetable(`${base}/html?x=secret`)).rejects.toThrow(
      /Nieprawidłowy typ/,
    );
  });
  it('rejects oversized bodies', async () => {
    await expect(fetchTimetable(`${base}/big?x=secret`)).rejects.toThrow();
  });
  it('rejects on timeout', async () => {
    const err = await fetchTimetable(`${base}/slow?x=secret`, {
      timeoutMs: 100,
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('secret');
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
});
