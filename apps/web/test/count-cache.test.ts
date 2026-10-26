import { type Db, subjects } from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
vi.mock('@/lib/db', () => ({
  getDb: () => db,
  getRoPool: () => {
    throw new Error('no RO pool in this test');
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

  it('view counts are null without an RO pool, and null is not cached', async () => {
    C.invalidateCounts();
    expect(await C.cachedViewCounts()).toBeNull();
  });
});
