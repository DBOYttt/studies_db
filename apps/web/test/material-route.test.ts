import {
  consumeLoginToken,
  createLoginToken,
  type Db,
  insertMaterial,
  materials,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let db: Db;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));

const { GET } = await import('../app/api/material/[id]/route');

let sid: string;
let topicId: number;
let userId: number;
let seq = 0;

async function seed() {
  seq++;
  const { materialId } = await insertMaterial(
    db,
    {
      topicId,
      uploaderId: userId,
      discordMessageId: `m${seq}`,
      discordAttachmentId: `a${seq}`,
      originalFilename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      storagePath: `originals/f${seq}`,
      previewKind: 'pdf',
    },
    [],
  );
  return materialId;
}
const call = (id: string) =>
  GET(new Request(`http://x/api/material/${id}`), {
    params: Promise.resolve({ id }),
  });

beforeAll(async () => {
  db = await resetTestDb();
  const [s] = await db.insert(subjects).values({
    name: 'A',
    code: 'A',
    semester: 1,
    ects: 1,
    discordChannelId: 'c1',
  });
  const [t] = await db
    .insert(topics)
    .values({ subjectId: s.insertId, title: 'T', discordThreadId: 't1' });
  topicId = t.insertId;
  userId = await upsertUser(db, {
    discordUserId: 'u1',
    displayName: 'Ann',
    avatarUrl: null,
  });
  const r = await consumeLoginToken(db, await createLoginToken(db, userId));
  sid = (r as { sessionToken: string }).sessionToken;
  cookieSid = sid;
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('GET /api/material/[id]', () => {
  it('returns the ExplorerFile JSON', async () => {
    const id = await seed();
    const res = await call(String(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      id,
      filename: 'doc.pdf',
      topicTitle: 'T',
      uploader: 'Ann',
      previewKind: 'pdf',
    });
  });
  it('404 for deleted material, deleted topic, unknown and bad ids', async () => {
    const del = await seed();
    await db
      .update(materials)
      .set({ deletedAt: new Date() })
      .where(eq(materials.id, del));
    expect((await call(String(del))).status).toBe(404);

    const [t2] = await db
      .insert(topics)
      .values({ subjectId: 1, title: 'Gone', discordThreadId: 't2' });
    await db
      .update(topics)
      .set({ deletedAt: new Date() })
      .where(eq(topics.id, t2.insertId));
    const prev = topicId;
    topicId = t2.insertId;
    const inGone = await seed();
    topicId = prev;
    expect((await call(String(inGone))).status).toBe(404);

    for (const bad of ['999999', 'abc', '1.5', '-3', '0', '1e3'])
      expect((await call(bad)).status, bad).toBe(404);
  });
  it('redirects without a session', async () => {
    const id = await seed();
    cookieSid = undefined;
    try {
      await call(String(id));
      expect.unreachable();
    } catch (e) {
      expect(String((e as { digest?: string }).digest)).toContain(
        '/login-info',
      );
    }
    cookieSid = sid;
  });
});
