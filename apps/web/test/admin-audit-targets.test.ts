import {
  classMarks,
  type Db,
  ensureClass,
  ensureGroup,
  eventSeries,
  events,
  subjects,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAuditTargets } from '../lib/admin-audit-targets';

let db: Db;
const id: Record<string, number> = {};

beforeAll(async () => {
  db = await resetTestDb();
  const userId = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ola',
    avatarUrl: null,
  });
  const [{ id: asd }] = await db
    .insert(subjects)
    .values({ name: 'Algorytmy', code: 'ASD', semester: 3, ects: 5 })
    .$returningId();
  const lab = await ensureClass(db, asd, 'laboratorium');
  const gr1 = await ensureGroup(db, lab, 1);
  const wall = (m: number, d: number, h = 10) =>
    new Date(Date.UTC(2026, m, d, h));
  const [{ id: ev }] = await db
    .insert(events)
    .values({
      kind: 'kolokwium',
      title: 'Kolokwium 1',
      subjectId: asd,
      startsAt: wall(9, 26),
      createdBy: userId,
    })
    .$returningId();
  id.event = ev;
  const [{ id: gone }] = await db
    .insert(events)
    .values({
      kind: 'inne',
      title: 'Spotkanie',
      startsAt: wall(9, 2),
      deletedAt: new Date(),
      createdBy: userId,
    })
    .$returningId();
  id.deleted = gone;
  const [{ id: series }] = await db
    .insert(eventSeries)
    .values({ rule: 'weekly', until: '2026-12-01', createdBy: userId })
    .$returningId();
  id.series = series;
  const [{ id: later }] = await db
    .insert(events)
    .values({
      kind: 'zajecia_dodatkowe',
      title: 'Konsultacje',
      subjectId: asd,
      startsAt: wall(10, 9),
      seriesId: series,
      createdBy: userId,
    })
    .$returningId();
  const [{ id: first }] = await db
    .insert(events)
    .values({
      kind: 'zajecia_dodatkowe',
      title: 'Konsultacje',
      subjectId: asd,
      startsAt: wall(10, 2),
      seriesId: series,
      createdBy: userId,
    })
    .$returningId();
  id.seriesFirst = first;
  id.seriesLater = later;
  const [{ id: markAll }] = await db
    .insert(classMarks)
    .values({ classId: lab, groupId: null, kind: 'wejsciowka' })
    .$returningId();
  const [{ id: markGr }] = await db
    .insert(classMarks)
    .values({ classId: lab, groupId: gr1, kind: 'wejsciowka' })
    .$returningId();
  id.markAll = markAll;
  id.markGr = markGr;
});

afterAll(async () => {
  await closeTestDb(db);
});

describe('loadAuditTargets', () => {
  it('names events, series, entry quizzes and subjects, with links', async () => {
    const rows = [
      { id: 1, action: 'event.add', target: String(id.event) },
      { id: 2, action: 'event.delete', target: String(id.deleted) },
      { id: 3, action: 'event.edit', target: `series:${id.series}` },
      { id: 4, action: 'class_mark.add', target: `class_mark:${id.markAll}` },
      { id: 5, action: 'class_mark.skip', target: `class_mark:${id.markGr}` },
      { id: 6, action: 'subject.edit', target: 'ASD' },
      { id: 7, action: 'subject.add', target: 'NOPE' },
      { id: 8, action: 'event.add', target: '999999' },
      { id: 9, action: 'sql.execute', target: 'subjects' },
    ];
    const t = await loadAuditTargets(db, rows);
    expect(t.get(1)).toEqual({
      label: 'Test: Kolokwium 1 ASD, 26 Oct',
      href: `/wydarzenia/${id.event}`,
    });
    expect(t.get(2)).toEqual({
      label: 'Other: Spotkanie, 2 Oct (deleted)',
      href: `/wydarzenia/${id.deleted}`,
    });
    expect(t.get(3)).toEqual({
      label: 'Extra class: Konsultacje ASD, 2 Nov (series)',
      href: `/wydarzenia/${id.seriesFirst}`,
    });
    expect(t.get(4)).toEqual({
      label: 'Entry quiz: ASD, Laboratorium',
      href: '/subjects/ASD',
    });
    expect(t.get(5)?.label).toMatch(/^Entry quiz: ASD, Laboratorium .*1/);
    expect(t.get(6)).toEqual({ label: 'ASD', href: '/subjects/ASD' });
    expect(t.get(7)).toBeUndefined();
    expect(t.get(8)).toEqual({ label: 'Event #999999 (removed)' });
    expect(t.get(9)).toBeUndefined();
  });

  it('returns an empty map without nameable targets', async () => {
    expect(
      (
        await loadAuditTargets(db, [
          { id: 1, action: 'plan.sync', target: null },
        ])
      ).size,
    ).toBe(0);
  });
});

describe('semester targets', () => {
  it('names semester:<n> as "Semester n"', async () => {
    const { parseAuditTarget } = await import('../lib/admin-audit');
    expect(parseAuditTarget('plan.feed_set', 'semester:3')).toEqual({
      type: 'semester',
      n: 3,
    });
    expect(parseAuditTarget('plan.feed_set', 'semester:8')).toBeNull();
  });
});
