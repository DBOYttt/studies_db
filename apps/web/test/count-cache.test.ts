import { type Db, subjects } from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
let viewsPool: unknown = null;
vi.mock('@/lib/db', () => ({
  getDb: () => db,
  getViewsPool: () => {
    if (!viewsPool) throw new Error('no RO pool in this test');
    return viewsPool;
  },
}));

const C = await import('../lib/count-cache');

beforeAll(async () => {
  db = await resetTestDb();
  await db
    .insert(subjects)
    .values({ name: 'Alfa', code: 'ALF', semester: 1, ects: 1 });
});
afterAll(() => closeTestDb(db));

describe('count caches', () => {
  it('subject cards are served from the cache until invalidated', async () => {
    C.invalidateCounts();
    expect((await C.cachedSubjectCards()).map((s) => s.code)).toEqual(['ALF']);
    await db
      .insert(subjects)
      .values({ name: 'Beta', code: 'BET', semester: 1, ects: 1 });
    expect((await C.cachedSubjectCards()).map((s) => s.code)).toEqual(['ALF']);
    C.invalidateCounts();
    expect((await C.cachedSubjectCards()).map((s) => s.code)).toEqual([
      'ALF',
      'BET',
    ]);
  });

  it('nav subjects are cached the same way', async () => {
    C.invalidateCounts();
    const before = (await C.cachedNavSubjects()).map((s) => s.code);
    await db
      .insert(subjects)
      .values({ name: 'Gamma', code: 'GAM', semester: 2, ects: 1 });
    expect((await C.cachedNavSubjects()).map((s) => s.code)).toEqual(before);
    C.invalidateCounts();
    expect((await C.cachedNavSubjects()).map((s) => s.code)).toContain('GAM');
  });

  it('a chosen semester filters the cached lists', async () => {
    C.invalidateCounts();
    expect((await C.cachedSubjectCards(2)).map((s) => s.semester)).toEqual([2]);
    expect((await C.cachedNavSubjects(1)).map((s) => s.code)).not.toContain(
      'GAM',
    );
    expect((await C.cachedNavSubjects(2)).map((s) => s.code)).toContain('GAM');
    expect((await C.cachedSubjectCards(null)).length).toBeGreaterThan(2);
  });

  it('view counts are null without an RO pool, and null is not cached', async () => {
    C.invalidateCounts();
    expect(await C.cachedViewCounts()).toBeNull();
  });

  it('present semesters are cached until invalidated; a failure is not kept', async () => {
    C.invalidateCounts();
    expect(await C.cachedPresentSemesters()).toEqual([]);
    let calls = 0;
    viewsPool = {
      query: async () => {
        calls++;
        return [[{ semester: 1 }, { semester: 3 }]];
      },
    };
    try {
      expect(await C.cachedPresentSemesters()).toEqual([1, 3]);
      expect(await C.cachedPresentSemesters()).toEqual([1, 3]);
      expect(calls).toBe(1);
      C.invalidateCounts();
      await C.cachedPresentSemesters();
      expect(calls).toBe(2);
    } finally {
      viewsPool = null;
    }
  });
});
