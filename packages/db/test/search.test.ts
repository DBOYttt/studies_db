import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import {
  materials,
  subjects,
  tags,
  topics,
  topicTags,
  users,
} from '../src/schema.js';
import { buildSnippet, searchAll } from '../src/search.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;
let s1: number;
let s2: number;
let tag1: number;
let n = 0;

async function addMaterial(
  topicId: number,
  uploaderId: number,
  filename: string,
  text: string | null,
  deleted = false,
) {
  n += 1;
  const [m] = await db
    .insert(materials)
    .values({
      topicId,
      uploaderId,
      discordMessageId: `m${n}`,
      discordAttachmentId: `a${n}`,
      originalFilename: filename,
      mimeType: 'text/plain',
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
      storagePath: `p${n}`,
      previewKind: 'text',
      extractedText: text,
      status: 'ready',
      deletedAt: deleted ? new Date() : null,
    })
    .$returningId();
  return m.id;
}

beforeAll(async () => {
  db = await resetTestDb();
  const mk = async (code: string, ch: string) =>
    (
      await db
        .insert(subjects)
        .values({
          name: `Przedmiot ${code}`,
          code,
          semester: 1,
          ects: 3,
          discordChannelId: ch,
        })
        .$returningId()
    )[0].id;
  s1 = await mk('MECH', 'c1');
  s2 = await mk('AUTO', 'c2');
  const [u] = await db
    .insert(users)
    .values({ discordUserId: 'u1', displayName: 'Ala' })
    .$returningId();
  const mkTopic = async (subjectId: number, title: string, th: string) =>
    (
      await db
        .insert(topics)
        .values({ subjectId, title, discordThreadId: th })
        .$returningId()
    )[0].id;
  const t1 = await mkTopic(s1, 'W1 – Statyka', 'th1');
  const t2 = await mkTopic(s2, 'Sterowniki', 'th2');
  const tDel = await mkTopic(s1, 'Skasowany temat zebra', 'th3');
  const [tg] = await db
    .insert(tags)
    .values({ subjectId: s1, name: 'kolokwium', discordTagId: 'tg1' })
    .$returningId();
  tag1 = tg.id;
  await db.insert(topicTags).values({ topicId: t1, tagId: tag1 });
  await addMaterial(t1, u.id, 'tarcie.txt', 'Tarcie suche i poślizg.');
  await addMaterial(t1, u.id, 'stare.txt', 'tarcie usunięte', true);
  await addMaterial(t2, u.id, 'tarcie2.txt', 'Tarcie w napędach.');
  await addMaterial(t1, u.id, 'lozysko.txt', 'Zadanie: łożysko toczne.');
  await addMaterial(t2, u.id, 'ai.txt', 'Wstęp do AI w automatyce.');
  await addMaterial(
    t2,
    u.id,
    'long.txt',
    `${'wypełniacz '.repeat(5000)}unikalnyslowo na końcu`,
  );
  await addMaterial(t2, u.id, 'plc.txt', 'Programujemy sterownik PLC w labie.');
  await db
    .update(topics)
    .set({ deletedAt: new Date() })
    .where(eq(topics.id, tDel));
});

afterAll(async () => {
  await closeTestDb(db);
});

describe('buildSnippet', () => {
  it('wraps match and adds ellipsis', () => {
    const s = buildSnippet(
      'Ala ma kota. Kolokwium z mechaniki będzie we wtorek.',
      'kolokwium',
      10,
    );
    expect(s).toContain('«Kolokwium»');
    expect(s.startsWith('…')).toBe(true);
  });
  it('is diacritic-insensitive', () => {
    expect(buildSnippet('Zadanie: łożysko toczne', 'lozysko')).toContain(
      '«łożysko»',
    );
  });
  it('stays fast on ~1 MB text with the match near the end', () => {
    const text = `${'Lorem ipsum dolor sit amet. '.repeat(37_000)}łożysko końcowe`;
    const t0 = performance.now();
    const s = buildSnippet(text, 'lozysko');
    expect(performance.now() - t0).toBeLessThan(200);
    expect(s).toContain('«łożysko»');
  });
  it('falls back to the start of the text', () => {
    expect(buildSnippet('abcdef', 'xyz', 3)).toBe('abcdef');
  });
});

describe('searchAll', () => {
  it('ignores soft-deleted materials', async () => {
    const hits = await searchAll(db, { q: 'tarcie' });
    const names = hits.map((h) => h.filename).sort();
    expect(names).toEqual(['tarcie.txt', 'tarcie2.txt']);
    expect(hits[0].snippet).toContain('«');
    expect(hits[0].subjectCode).toMatch(/MECH|AUTO/);
  });
  it('finds topics by title with materialId null', async () => {
    const hits = await searchAll(db, { q: 'statyka' });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      materialId: null,
      topicTitle: 'W1 – Statyka',
      filename: null,
    });
  });
  it('ignores soft-deleted topics', async () => {
    expect(await searchAll(db, { q: 'zebra' })).toEqual([]);
  });
  it('filters by subject', async () => {
    const hits = await searchAll(db, { q: 'tarcie', subjectId: s1 });
    expect(hits.map((h) => h.filename)).toEqual(['tarcie.txt']);
  });
  it('filters by tag', async () => {
    const hits = await searchAll(db, { q: 'tarcie', tagId: tag1 });
    expect(hits.map((h) => h.filename)).toEqual(['tarcie.txt']);
    expect(await searchAll(db, { q: 'sterowniki', tagId: tag1 })).toEqual([]);
  });
  it('handles blank and punctuation-only queries', async () => {
    expect(await searchAll(db, { q: '   ' })).toEqual([]);
    expect(await searchAll(db, { q: '"+-*()' })).toEqual([]);
  });
  it('finds short tokens', async () => {
    const hits = await searchAll(db, { q: 'PLC' });
    expect(hits.map((h) => h.filename)).toEqual(['plc.txt']);
  });
  it('respects limit', async () => {
    expect(await searchAll(db, { q: 'tarcie', limit: 1 })).toHaveLength(1);
  });
  it('finds Polish diacritics', async () => {
    const hits = await searchAll(db, { q: 'łożysko' });
    expect(hits.map((h) => h.filename)).toContain('lozysko.txt');
  });
  it('finds 2-character words', async () => {
    const hits = await searchAll(db, { q: 'AI' });
    expect(hits.map((h) => h.filename)).toEqual(['ai.txt']);
  });
  it('tolerates mixed operator input', async () => {
    const hits = await searchAll(db, { q: 'tarcie "+' });
    expect(hits.map((h) => h.filename).sort()).toEqual([
      'tarcie.txt',
      'tarcie2.txt',
    ]);
  });
  it('snippets from long texts come from a bounded slice', async () => {
    const hits = await searchAll(db, { q: 'unikalnyslowo' });
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('«unikalnyslowo»');
    expect(hits[0].snippet.length).toBeLessThan(400);
  });
});
