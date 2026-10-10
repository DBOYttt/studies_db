import {
  consumeLoginToken,
  type Db,
  insertMaterial,
  setBanned,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addLecturer,
  addSubject,
  assignLecturer,
  banReply,
  editSubject,
  listSubjects,
} from '../src/commands/admin.js';
import { commandDefinitions } from '../src/commands/definitions.js';
import { linkFor, searchReply } from '../src/commands/student.js';

let db: Db;
const base = {
  channelId: 'c1',
  name: 'Algebra',
  code: 'alg',
  semester: 1 as const,
  ects: 5,
};

beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('subjects', () => {
  it('adds, uppercases code, rejects duplicates', async () => {
    expect(await addSubject(db, base)).toBe('Dodano przedmiot ALG (Algebra).');
    expect(await addSubject(db, { ...base, channelId: 'c2' })).toBe(
      'Przedmiot z tym kodem lub kanałem już istnieje.',
    );
    expect(await addSubject(db, { ...base, code: 'X' })).toBe(
      'Przedmiot z tym kodem lub kanałem już istnieje.',
    );
  });

  it('edits only provided fields and lists sorted', async () => {
    await addSubject(db, base);
    await addSubject(db, {
      ...base,
      channelId: 'c0',
      code: 'ANA',
      semester: 2,
      name: 'Analiza',
    });
    expect(await editSubject(db, 'alg', { ects: 7 })).toBe(
      'Zaktualizowano przedmiot ALG.',
    );
    expect(await editSubject(db, 'nope', { ects: 7 })).toBe(
      'Nie znaleziono przedmiotu NOPE.',
    );
    expect(await listSubjects(db)).toBe(
      '**ALG** Algebra — sem. 1, 7 ECTS\n**ANA** Analiza — sem. 2, 5 ECTS',
    );
  });

  it('lists empty', async () => {
    expect(await listSubjects(db)).toBe('Brak przedmiotów.');
  });
});

describe('lecturers', () => {
  it('adds and assigns (idempotent), unknown subject', async () => {
    await addSubject(db, base);
    const r = await addLecturer(db, { name: 'Jan Kowalski', title: 'dr' });
    const id = Number(/id (\d+)/.exec(r)?.[1]);
    expect(r).toBe(`Dodano prowadzącego dr Jan Kowalski (id ${id}).`);
    const a = { subjectCode: 'alg', lecturerId: id, role: 'wyklad' as const };
    expect(await assignLecturer(db, a)).toBe(
      'Przypisano prowadzącego do ALG jako wyklad.',
    );
    expect(await assignLecturer(db, a)).toBe(
      'Przypisano prowadzącego do ALG jako wyklad.',
    );
    expect(await assignLecturer(db, { ...a, subjectCode: 'zzz' })).toBe(
      'Nie znaleziono przedmiotu zzz.',
    );
  });
});

describe('link and ban', () => {
  const user = { discordUserId: 'u1', displayName: 'Ann', avatarUrl: null };
  it('returns a consumable url', async () => {
    const r = await linkFor(db, 'https://x.pl', user);
    if (!r.ok) throw new Error('expected ok');
    const prefix = 'https://x.pl/auth/callback?token=';
    expect(r.url.startsWith(prefix)).toBe(true);
    expect(
      await consumeLoginToken(db, r.url.slice(prefix.length)),
    ).not.toBeNull();
  });
  it('banned user is refused', async () => {
    await upsertUser(db, user);
    await setBanned(db, 'u1', true);
    expect(await linkFor(db, 'https://x.pl', user)).toEqual({
      ok: false,
      reason: 'banned',
    });
  });
  it('banReply', async () => {
    expect(await banReply(db, 'ghost', true)).toBe(
      'Ten użytkownik nie korzystał jeszcze z bota.',
    );
    await upsertUser(db, user);
    expect(await banReply(db, 'u1', true)).toBe(
      'Zablokowano dostęp do strony.',
    );
    expect(await banReply(db, 'u1', false)).toBe(
      'Odblokowano dostęp do strony.',
    );
  });
});

describe('searchReply', () => {
  it('empty', async () => {
    expect(await searchReply(db, 'https://x.pl', 'abc')).toBe(
      'Brak wyników dla „abc”.',
    );
  });
  it('max 5 lines', async () => {
    const [s] = await db.insert(subjects).values({
      name: 'A',
      code: 'ALG',
      semester: 1,
      ects: 1,
      discordChannelId: 'c',
    });
    for (let i = 0; i < 7; i++) {
      const [t] = await db.insert(topics).values({
        subjectId: s.insertId,
        title: `Temat ${i}`,
        discordThreadId: `t${i}`,
      });
      const uploaderId = await upsertUser(db, {
        discordUserId: 'up',
        displayName: 'U',
        avatarUrl: null,
      });
      await insertMaterial(
        db,
        {
          topicId: t.insertId,
          uploaderId,
          discordMessageId: `m${i}`,
          discordAttachmentId: `a${i}`,
          originalFilename: `notatki${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1,
          sha256: 'a'.repeat(64),
          storagePath: `p${i}`,
          previewKind: 'none',
          extractedText: 'kolokwium z algebry',
        },
        [],
      );
    }
    const out = await searchReply(db, 'https://x.pl', 'kolokwium');
    const lines = out.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(
      /^\*\*ALG\*\* · Temat \d — notatki\d\.pdf https:\/\/x\.pl\/topics\/\d+$/,
    );
  });
});

describe('commandDefinitions', () => {
  it('has unique top-level names including all 7', () => {
    const names = commandDefinitions.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of [
      'subject',
      'lecturer',
      'ban',
      'unban',
      'resync',
      'link',
      'search',
    ])
      expect(names).toContain(n);
  });
});
