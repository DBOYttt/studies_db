import { sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { EVENT_KINDS, PUBLIC_VIEWS } from '../src/constants.js';
import { events, subjects, topics } from '../src/schema.js';
import { closeTestDb, resetTestDb, testRoUrl } from '../src/testing.js';

let db: Db;
let subjectId: number;

beforeAll(async () => {
  db = await resetTestDb();
  const [s] = await db
    .insert(subjects)
    .values({
      code: 'EVT1',
      name: 'Fizyka',
      semester: 1,
      ects: 3,
      discordChannelId: 'evt-ch',
    })
    .$returningId();
  subjectId = s.id;
});
afterAll(async () => {
  await closeTestDb(db);
});

const at = new Date('2026-11-01T10:00:00Z');

describe('events schema', () => {
  it('inserts an event without a subject', async () => {
    const [e] = await db
      .insert(events)
      .values({ kind: 'wyjazd', title: 'Integracja', startsAt: at })
      .$returningId();
    expect(e.id).toBeGreaterThan(0);
  });

  it('inserts a topic without a subject', async () => {
    const [t] = await db
      .insert(topics)
      .values({ title: 'Wydarzenie', discordThreadId: 'evt-thread-1' })
      .$returningId();
    expect(t.id).toBeGreaterThan(0);
  });

  it('v_events hides deleted rows and joins the subject', async () => {
    const [live] = await db
      .insert(events)
      .values({ kind: 'kolokwium', title: 'Kol 1', subjectId, startsAt: at })
      .$returningId();
    const [gone] = await db
      .insert(events)
      .values({
        kind: 'egzamin',
        title: 'Usuniety',
        subjectId,
        startsAt: at,
        deletedAt: at,
      })
      .$returningId();
    const [rows] = (await db.execute(
      sql`SELECT id, subject_code, subject_name FROM v_events`,
    )) as unknown as [Array<Record<string, unknown>>];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(live.id)).toMatchObject({
      subject_code: 'EVT1',
      subject_name: 'Fizyka',
    });
    expect(byId.has(gone.id)).toBe(false);
    const noSubject = rows.find((r) => r.subject_code === null);
    expect(noSubject).toBeDefined();
  });

  it('studies_ro reads v_events but not events', async () => {
    expect(PUBLIC_VIEWS).toContain('v_events');
    const c = await mysql.createConnection({
      uri: testRoUrl(),
      charset: 'utf8mb4',
    });
    try {
      await c.query('SELECT * FROM v_events');
      await expect(c.query('SELECT * FROM events')).rejects.toMatchObject({
        errno: 1142,
      });
    } finally {
      await c.end();
    }
  });

  it('EVENT_KINDS has a label and symbol for each kind', () => {
    expect(EVENT_KINDS.kolokwium).toEqual({ label: 'Kolokwium', symbol: '📝' });
    expect(Object.keys(EVENT_KINDS)).toHaveLength(5);
  });
});
