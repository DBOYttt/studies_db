import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SeedRefusedError,
  type SeedSummary,
  seedDatabase,
} from '../src/cli/seed-core.js';
import type { Db } from '../src/client.js';
import { EVENT_KINDS } from '../src/constants.js';
import { listEventsInRange } from '../src/events.js';
import {
  annotateWeek,
  isoWeekOf,
  listWeekMarks,
  listWeekSessionRows,
  nowWall,
  shiftWeek,
  weekStart,
} from '../src/plan.js';
import {
  adminAudit,
  botRequests,
  botSettings,
  classMarkSkips,
  classMarks,
  classSessions,
  eventSeries,
  events,
  eventTopics,
  reminderPrefs,
  sessions,
  subjects,
  topics,
  userGroups,
  users,
  webUploads,
} from '../src/schema.js';
import { searchAll } from '../src/search.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

const DAY_MS = 86_400_000;
const REAL_ID = '123456789012345678';

let db: Db;
let pool: mysql.Pool;
let storageDir: string;
let first: SeedSummary;

const userId = async (discordUserId: string) => {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordUserId, discordUserId));
  return u?.id;
};

/** The annotated timetable of the week `offset` weeks from now. */
async function annotated(offset: number) {
  const w = shiftWeek(isoWeekOf(nowWall()), offset);
  const classRows = await listWeekSessionRows(pool, w);
  const eventRows = await listEventsInRange(
    pool,
    weekStart(w),
    weekStart(shiftWeek(w, 1)),
  );
  const marks = await listWeekMarks(
    pool,
    classRows.flatMap((s) => (s.classId === null ? [] : [s.classId])),
  );
  return annotateWeek([...classRows, ...eventRows], marks);
}

beforeAll(async () => {
  db = await resetTestDb();
  pool = (db as unknown as { $client: mysql.Pool }).$client;
  storageDir = mkdtempSync(join(tmpdir(), 'seed-test-'));
  first = await seedDatabase(db, { storageDir, log: () => {} });
});

afterAll(async () => {
  await closeTestDb(db);
  rmSync(storageDir, { recursive: true, force: true });
});

describe('seed on an empty database', () => {
  it('creates the admin, the banned user and the students', async () => {
    const rows = await db.select().from(users);
    const by = new Map(rows.map((u) => [u.discordUserId, u]));
    expect(by.get('seed-admin')?.isAdmin).toBe(true);
    expect(by.get('seed-banned')?.isBanned).toBe(true);
    for (const id of ['seed-u1', 'seed-u2', 'seed-u3', 'seed-u4', 'seed-u5']) {
      expect(by.get(id)?.isAdmin).toBe(false);
      expect(by.get(id)?.isBanned).toBe(false);
    }
    expect(first.loginUsers.student).toBe(by.get('seed-u1')?.id);
    expect(first.loginUsers.admin).toBe(by.get('seed-admin')?.id);
  });

  it('has an event of every kind, a subject-less trip, past and upcoming ones', async () => {
    const live = await db.select().from(events).where(isNull(events.deletedAt));
    const kinds = new Set(live.map((e) => e.kind));
    for (const k of Object.keys(EVENT_KINDS)) expect(kinds).toContain(k);
    expect(live.some((e) => e.kind === 'wyjazd' && e.subjectId === null)).toBe(
      true,
    );
    const now = nowWall().getTime();
    expect(live.some((e) => e.startsAt.getTime() < now)).toBe(true);
    const soon = live.filter(
      (e) =>
        e.seriesId === null &&
        e.startsAt.getTime() > now &&
        e.startsAt.getTime() < now + 30 * DAY_MS,
    );
    expect(soon.length).toBeGreaterThanOrEqual(5);
  });

  it('has a weekly series with a subject and a biweekly one without', async () => {
    const series = await db.select().from(eventSeries);
    const weekly = series.find((s) => s.rule === 'weekly');
    const biweekly = series.find((s) => s.rule === 'biweekly');
    expect(weekly && biweekly).toBeTruthy();
    const occ = async (id: number) =>
      db.select().from(events).where(eq(events.seriesId, id));
    const w = await occ(weekly?.id as number);
    const b = await occ(biweekly?.id as number);
    expect(w.length).toBeGreaterThanOrEqual(3);
    expect(w.every((e) => e.subjectId !== null)).toBe(true);
    expect(b.length).toBeGreaterThanOrEqual(3);
    expect(b.every((e) => e.subjectId === null)).toBe(true);
  });

  it('has an edited event, a soft-deleted one and a linked post', async () => {
    const audit = await db.select().from(adminAudit);
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('event.edit');
    expect(actions).toContain('event.delete');
    expect(actions).toContain('event.link');
    const deleted = await db
      .select()
      .from(events)
      .where(isNotNull(events.deletedAt));
    expect(deleted).toHaveLength(1);
    const edited = audit.find((a) => a.action === 'event.edit');
    const [ev] = await db
      .select()
      .from(events)
      .where(eq(events.id, Number(edited?.target)));
    expect(ev.version).toBeGreaterThan(0);
    expect(ev.updatedBy).not.toBe(ev.createdBy);
    const links = await db.select().from(eventTopics);
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it('shows a Test badge, a Test + Entry quiz bar and an unmatched Test next week', async () => {
    const week = await annotated(1);
    const kinds = (s: (typeof week)[number]) =>
      (s.badges ?? []).map((b) => b.kind).sort();
    const testOnly = week.filter(
      (s) => s.type === 'class' && kinds(s).join() === 'test',
    );
    const both = week.filter(
      (s) => s.type === 'class' && kinds(s).join() === 'entry_quiz,test',
    );
    expect(testOnly.length).toBeGreaterThanOrEqual(1);
    expect(both.length).toBeGreaterThanOrEqual(1);
    expect(both[0].endsAt.getTime() - both[0].startsAt.getTime()).toBe(
      90 * 60_000,
    );
    const unmatched = week.filter(
      (s) => s.type === 'event' && s.eventKind === 'kolokwium',
    );
    expect(unmatched.length).toBeGreaterThanOrEqual(1);
  });

  it('imports exams and shows the matching egzamin event once', async () => {
    const exams = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.kind, 'exam'));
    expect(exams.length).toBeGreaterThanOrEqual(3);
    for (const x of exams) {
      expect(x.source).toBe('exams');
      expect(x.classId).toBeNull();
    }
    let linked = 0;
    for (let offset = 0; offset <= 5; offset++) {
      const week = await annotated(offset);
      linked += week.filter((s) => s.linkedEventId !== undefined).length;
      // The egzamin event merged into the exam is not drawn again.
      for (const s of week.filter((x) => x.linkedEventId !== undefined)) {
        expect(
          week.some((e) => e.type === 'event' && e.id === s.linkedEventId),
        ).toBe(false);
      }
    }
    expect(linked).toBe(1);
  });

  it('has entry quizzes: all-groups with a note, one group, a skip and a removed one', async () => {
    const marks = await db.select().from(classMarks);
    const live = marks.filter((m) => m.deletedAt === null);
    const all = live.find((m) => m.groupId === null);
    expect(all?.note).toBeTruthy();
    const group = live.find((m) => m.groupId !== null);
    expect(group).toBeTruthy();
    expect(group?.classId).not.toBe(all?.classId);
    expect(marks.filter((m) => m.deletedAt !== null)).toHaveLength(1);
    const skips = await db.select().from(classMarkSkips);
    expect(skips).toHaveLength(1);
    const actions = (await db.select().from(adminAudit)).map((a) => a.action);
    for (const a of ['class_mark.add', 'class_mark.skip', 'class_mark.remove'])
      expect(actions).toContain(a);
  });

  it('picks some groups for seed-u1, none for seed-u2', async () => {
    const u1 = await userId('seed-u1');
    const u2 = await userId('seed-u2');
    const mine = await db
      .select()
      .from(userGroups)
      .where(eq(userGroups.userId, u1 as number));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const [[{ n }]] = (await db.execute(
      sql`SELECT COUNT(DISTINCT class_id) AS n FROM class_groups`,
    )) as unknown as [[{ n: number }]];
    expect(mine.length).toBeLessThan(Number(n));
    const theirs = await db
      .select()
      .from(userGroups)
      .where(eq(userGroups.userId, u2 as number));
    expect(theirs).toHaveLength(0);
  });

  it('turns both reminders on for one student', async () => {
    const prefs = await db.select().from(reminderPrefs);
    expect(prefs).toHaveLength(1);
    expect(prefs[0]).toMatchObject({ dayBefore: true, hourBefore: true });
  });

  it('finds Polish words typed without diacritics', async () => {
    for (const q of ['zlozonosc', 'lacze']) {
      const hits = await searchAll(db, { q });
      expect(hits.length, q).toBeGreaterThanOrEqual(1);
    }
    const t = await db.select({ title: topics.title }).from(topics);
    expect(t.some((x) => x.title.includes('ł'))).toBe(true);
  });

  it('writes an executed and a rejected admin SQL audit row', async () => {
    const audit = await db.select().from(adminAudit);
    const exec = audit.find((a) => a.action === 'sql.execute');
    const rej = audit.find((a) => a.action === 'sql.rejected');
    expect(exec?.statement).toBeTruthy();
    expect(exec?.rowsAffected).toBe(1);
    expect(rej?.statement).toBeTruthy();
  });

  it('queues one web upload with its file in uploads/', async () => {
    const ups = await db.select().from(webUploads);
    expect(ups).toHaveLength(1);
    expect(ups[0].status).toBe('queued');
    expect(ups[0].storagePath).toMatch(/^uploads\/[0-9a-f-]{36}$/);
    expect(existsSync(join(storageDir, ups[0].storagePath))).toBe(true);
    expect(readFileSync(join(storageDir, ups[0].storagePath)).length).toBe(
      ups[0].sizeBytes,
    );
    const [req] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.kind, 'event_upload'));
    expect(req.target).toBe(`upload:${ups[0].id}`);
    expect(req.payload).toEqual({
      eventId: ups[0].eventId,
      uploadIds: [ups[0].id],
    });
  });

  it('queues the bot requests that post every event', async () => {
    const reqs = await db.select().from(botRequests);
    expect(reqs.every((r) => r.status === 'queued')).toBe(true);
    const singles = await db
      .select({ id: events.id })
      .from(events)
      .where(isNull(events.seriesId));
    const series = await db.select({ id: eventSeries.id }).from(eventSeries);
    const upserts = reqs.filter((r) => r.kind === 'event_post_upsert');
    expect(upserts.map((r) => r.target).sort()).toEqual(
      [
        ...singles.map((e) => `event:${e.id}`),
        ...series.map((s) => `series:${s.id}`),
      ].sort(),
    );
    expect(reqs.filter((r) => r.kind === 'event_post_archive')).toHaveLength(1);
    expect(first.botRequests).toBe(reqs.length);
  });
});

describe('seed --reset', () => {
  let adminRoleBefore: string | undefined;

  beforeAll(async () => {
    await db.insert(botSettings).values([
      { key: 'admin_role_id', value: '900000000000000001' },
      { key: 'events_forum_id', value: '900000000000000002' },
    ]);
    adminRoleBefore = '900000000000000001';
    await db
      .update(subjects)
      .set({ discordChannelId: '800000000000000001' })
      .where(eq(subjects.code, 'ASD'));
    await db.insert(subjects).values({
      code: 'OLD',
      name: 'Old subject',
      semester: 1,
      ects: 1,
      discordChannelId: '800000000000000009',
    });
    const [{ id }] = await db
      .insert(users)
      .values({
        discordUserId: REAL_ID,
        displayName: 'Real Person',
        isAdmin: true,
      })
      .$returningId();
    await db.insert(sessions).values({
      userId: id,
      tokenHash: 'x'.repeat(64),
      expiresAt: new Date(Date.now() + DAY_MS),
    });
  });

  it('refuses without --reset on a non-empty database', async () => {
    await expect(
      seedDatabase(db, { storageDir, log: () => {} }),
    ).rejects.toBeInstanceOf(SeedRefusedError);
  });

  it('keeps bot settings and real users, re-links channels by code', async () => {
    const lines: string[] = [];
    const again = await seedDatabase(db, {
      storageDir,
      reset: true,
      log: (l) => lines.push(l),
    });
    const settings = await db.select().from(botSettings);
    expect(settings.find((s) => s.key === 'admin_role_id')?.value).toBe(
      adminRoleBefore,
    );
    expect(settings).toHaveLength(2);

    const [real] = await db
      .select()
      .from(users)
      .where(eq(users.discordUserId, REAL_ID));
    expect(real).toMatchObject({ isAdmin: true, displayName: 'Real Person' });
    expect(await db.select().from(sessions)).toHaveLength(0);
    // Seed users exist once each.
    const seedUsers = await db
      .select()
      .from(users)
      .where(sql`${users.discordUserId} LIKE 'seed-%'`);
    expect(seedUsers).toHaveLength(7);

    const subs = await db.select().from(subjects);
    expect(subs.find((s) => s.code === 'ASD')?.discordChannelId).toBe(
      '800000000000000001',
    );
    expect(subs.some((s) => s.code === 'OLD')).toBe(false);
    expect(
      subs.filter((s) => s.code !== 'ASD').every((s) => !s.discordChannelId),
    ).toBe(true);

    expect(again.kept.relinked).toEqual(['ASD']);
    expect(again.kept.dropped).toEqual(['OLD']);
    expect(again.kept.users).toEqual(['Real Person']);
    expect(again.kept.settings).toBe(2);
    expect(lines.join('\n')).toMatch(/OLD/);

    const all = await db.select({ id: events.id }).from(events);
    expect(all).toHaveLength(first.events);
    expect(again.botRequests).toBe(first.botRequests);
  });
});
