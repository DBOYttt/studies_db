import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { searchNameFor } from '../src/files.js';
import { insertMaterial } from '../src/materials.js';
import {
  materials,
  subjects,
  tags,
  topics,
  topicTags,
  users,
} from '../src/schema.js';
import { buildSnippet, clampLimit, searchAll } from '../src/search.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

let db: Db;
let s1: number;
let s2: number;
let tag1: number;
let rankTopic: number;
const rankIds: number[] = [];
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
      searchName: searchNameFor(filename),
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
  const mk = async (code: string, ch: string, semester = 1) =>
    (
      await db
        .insert(subjects)
        .values({
          name: `Przedmiot ${code}`,
          code,
          semester,
          ects: 3,
          discordChannelId: ch,
        })
        .$returningId()
    )[0].id;
  s1 = await mk('MECH', 'c1');
  s2 = await mk('AUTO', 'c2', 2);
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
  await addMaterial(
    t1,
    u.id,
    'wyklad3.txt',
    'Złożoność obliczeniowa algorytmów sortowania.',
  );
  await addMaterial(t1, u.id, 'łańcuchy_Markowa.txt', null);
  await insertMaterial(
    db,
    {
      topicId: t1,
      uploaderId: u.id,
      discordMessageId: 'mk',
      discordAttachmentId: 'ak',
      originalFilename: 'kolokwium_2023_zad1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      sha256: 'b'.repeat(64),
      storagePath: 'pk',
      previewKind: 'image',
    },
    [],
  );
  await db
    .update(topics)
    .set({ deletedAt: new Date() })
    .where(eq(topics.id, tDel));
  // Ranked set for the limit test: distinct relevance (1..6 occurrences),
  // long texts so the snippet comes from a slice, and a topic-title hit.
  rankTopic = await mkTopic(s1, 'Przekladnia zebata', 'th4');
  for (let k = 1; k <= 6; k++) {
    rankIds[k - 1] = await addMaterial(
      rankTopic,
      u.id,
      `rank${k}.txt`,
      `${'wstep '.repeat(200 * k)}${'przekladnia planetarna '.repeat(k)}${'koniec '.repeat(300)}`,
    );
  }
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
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(s).toContain('«łożysko»');
  });
  it('falls back to the start of the text', () => {
    expect(buildSnippet('abcdef', 'xyz', 3)).toBe('abcdef');
  });
});

describe('clampLimit', () => {
  it('clamps to an integer in 1..100 and defaults to 20', () => {
    expect(clampLimit(undefined)).toBe(20);
    expect(clampLimit(Number.NaN)).toBe(20);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(1000)).toBe(100);
    expect(clampLimit(7.9)).toBe(7);
  });
});

describe('searchAll', () => {
  it('finds underscore-separated filenames without extracted text', async () => {
    const hits = await searchAll(db, { q: 'kolokwium' });
    expect(hits.map((h) => h.filename)).toContain('kolokwium_2023_zad1.jpg');
  });
  it('does not blow up on NaN limit', async () => {
    const hits = await searchAll(db, { q: 'tarcie', limit: Number.NaN });
    expect(hits.length).toBeGreaterThan(0);
  });
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
  it('filters by semester', async () => {
    const all = await searchAll(db, { q: 'tarcie' });
    expect(new Set(all.map((h) => h.subjectCode))).toEqual(
      new Set(['MECH', 'AUTO']),
    );
    const one = await searchAll(db, { q: 'tarcie', semester: 2 });
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((h) => h.subjectCode === 'AUTO')).toBe(true);
    expect(await searchAll(db, { q: 'tarcie', semester: 6 })).toEqual([]);
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
  it('ignores diacritics in file text, ł included', async () => {
    const ids = async (q: string) =>
      (await searchAll(db, { q })).map((h) => h.materialId).sort();
    const folded = await ids('zlozonosc');
    expect(folded).toHaveLength(1);
    expect(folded).toEqual(await ids('złożoność'));
    expect(folded).toEqual(await ids('ZŁOŻONOŚĆ'));
    const [hit] = await searchAll(db, { q: 'zlozonosc' });
    expect(hit.filename).toBe('wyklad3.txt');
    expect(hit.snippet).toContain('«Złożoność»');
  });
  it('ignores ł in file names', async () => {
    for (const q of ['łańcuchy', 'lancuchy', 'Łańcuchy markowa']) {
      const hits = await searchAll(db, { q });
      expect(
        hits.map((h) => h.filename),
        q,
      ).toContain('łańcuchy_Markowa.txt');
    }
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
  it('more hits than the limit: top ids, order and snippets', async () => {
    // The SQL slices 1000 chars from 300 before the first match; the topic
    // hit's body is its title.
    const text = (k: number) =>
      `${'wstep '.repeat(200 * k)}${'przekladnia planetarna '.repeat(k)}${'koniec '.repeat(300)}`;
    const slice = (k: number) => {
      const at = 6 * 200 * k;
      return text(k).slice(at - 300, at - 300 + 1000);
    };
    const material = (k: number) => ({
      materialId: rankIds[k - 1],
      topicId: rankTopic,
      topicTitle: 'Przekladnia zebata',
      subjectCode: 'MECH',
      subjectName: 'Przedmiot MECH',
      filename: `rank${k}.txt`,
      snippet: buildSnippet(slice(k), 'przekladnia'),
    });
    const hits = await searchAll(db, { q: 'przekladnia', limit: 6 });
    expect(hits.map(({ score: _, ...h }) => h)).toEqual([
      material(6),
      material(5),
      material(4),
      material(3),
      material(2),
      {
        materialId: null,
        topicId: rankTopic,
        topicTitle: 'Przekladnia zebata',
        subjectCode: 'MECH',
        subjectName: 'Przedmiot MECH',
        filename: null,
        snippet: '«Przekladnia» zebata',
      },
    ]);
    expect(hits[0].snippet).toContain('…wstep wstep');
    const scores = hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(new Set(scores).size).toBe(6);
    // The seventh hit (rank1) is the one the limit cuts off.
    const all = await searchAll(db, { q: 'przekladnia' });
    expect(all.map((h) => h.filename)).toEqual([
      ...hits.map((h) => h.filename),
      'rank1.txt',
    ]);
  });
  it('equal scores keep one order whatever the limit', async () => {
    // Every rank file holds "koniec" 300 times: a six-way tie.
    const all = await searchAll(db, { q: 'koniec' });
    expect(all.map((h) => h.materialId)).toEqual(rankIds);
    expect(new Set(all.map((h) => h.score)).size).toBe(1);
    for (const limit of [1, 2, 4]) {
      const hits = await searchAll(db, { q: 'koniec', limit });
      expect(hits).toEqual(all.slice(0, limit));
    }
  });
  it('snippets from long texts come from a bounded slice', async () => {
    const hits = await searchAll(db, { q: 'unikalnyslowo' });
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('«unikalnyslowo»');
    expect(hits[0].snippet.length).toBeLessThan(400);
  });
});
