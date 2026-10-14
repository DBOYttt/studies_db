import {
  type Db,
  insertMaterial,
  jobs,
  materials,
  subjects,
  topics,
  upsertUser,
  users,
  writeAudit,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminOverview } from '../lib/admin-overview';

let db: Db;
let adminId: number;

beforeAll(async () => {
  db = await resetTestDb();
  adminId = await upsertUser(db, {
    discordUserId: 'a1',
    displayName: 'Ada',
    avatarUrl: null,
  });
  const userId = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Bolek',
    avatarUrl: null,
  });
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, adminId));

  const [{ id: s1 }] = await db
    .insert(subjects)
    .values({ name: 'Fizyka', code: 'FIZ', semester: 2, ects: 5 })
    .$returningId();
  await db
    .insert(subjects)
    .values({ name: 'Analiza', code: 'AM', semester: 1, ects: 6 });
  const mkTopic = async (n: number, deleted = false) =>
    (
      await db
        .insert(topics)
        .values({
          subjectId: s1,
          title: `T${n}`,
          discordThreadId: `t${n}`,
          deletedAt: deleted ? new Date() : null,
        })
        .$returningId()
    )[0].id;
  const t1 = await mkTopic(1);
  await mkTopic(2);
  await mkTopic(3, true); // deleted: not counted

  let n = 0;
  const mkMat = async (jobTypes: ('convert' | 'extract_text')[]) => {
    n += 1;
    return (
      await insertMaterial(
        db,
        {
          topicId: t1,
          uploaderId: userId,
          discordMessageId: `m${n}`,
          discordAttachmentId: `a${n}`,
          originalFilename: `f${n}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 10,
          sha256: String(n).padStart(64, '0'),
          storagePath: `p${n}`,
          previewKind: 'pdf',
        },
        jobTypes,
      )
    ).materialId;
  };
  await mkMat([]); // ready
  await mkMat([]); // ready
  const gone = await mkMat([]); // ready but deleted: not counted
  await db
    .update(materials)
    .set({ deletedAt: new Date() })
    .where(eq(materials.id, gone));
  const pending = await mkMat(['convert', 'extract_text']); // 2 queued jobs
  await mkMat(['convert']); // 1 queued job, marked failed below
  await db
    .update(jobs)
    .set({ status: 'failed' })
    .where(eq(jobs.materialId, pending + 1));

  for (let i = 1; i <= 12; i++) {
    await writeAudit(db, {
      userId: adminId,
      action: 'sql.execute',
      target: 'topics',
      statement: `UPDATE topics SET title = 'x${i}' WHERE id = 1`,
      rowsAffected: 1,
    });
  }
});

afterAll(async () => {
  await closeTestDb(db);
});

describe('getAdminOverview', () => {
  it('counts subjects, live topics, ready files and jobs', async () => {
    const o = await getAdminOverview(db);
    expect(o.counts).toEqual({
      subjects: 2,
      topics: 2,
      readyFiles: 2,
      jobsQueued: 2,
      jobsFailed: 1,
    });
  });
  it('lists admins only', async () => {
    const o = await getAdminOverview(db);
    expect(o.admins.map((a) => a.displayName)).toEqual(['Ada']);
  });
  it('returns the 10 newest audit entries, newest first', async () => {
    const o = await getAdminOverview(db);
    expect(o.recent).toHaveLength(10);
    expect(o.recent[0].statement).toContain("'x12'");
    expect(o.recent[0].userName).toBe('Ada');
    expect(o.recent[9].statement).toContain("'x3'");
  });
});
