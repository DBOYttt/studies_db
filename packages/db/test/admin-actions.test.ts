import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as A from '../src/admin-actions.js';
import { upsertUser } from '../src/auth.js';
import type { Db } from '../src/client.js';
import {
  classes,
  classGroups,
  classLecturers,
  lecturers,
  subjects,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

// Reply text of each action; ok-flags are asserted in the "ok flag" block.
const text =
  <Args extends unknown[]>(
    f: (db: Db, ...a: Args) => Promise<A.ActionResult>,
  ) =>
  async (db: Db, ...a: Args) =>
    (await f(db, ...a)).message;
const addSubject = text(A.addSubject);
const editSubject = text(A.editSubject);
const listSubjects = text(A.listSubjects);
const addLecturer = text(A.addLecturer);
const editLecturer = text(A.editLecturer);
const assignLecturer = text(A.assignLecturer);
const editClass = text(A.editClass);

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
    const a = {
      subjectCode: 'alg',
      lecturerId: id,
      classKind: 'laboratorium' as const,
    };
    expect(await assignLecturer(db, a)).toBe(
      'Przypisano prowadzącego do ALG / Laboratorium.',
    );
    expect(await assignLecturer(db, a)).toBe(
      'Przypisano prowadzącego do ALG / Laboratorium.',
    );
    expect(await db.select().from(classLecturers)).toHaveLength(1);
    expect(await assignLecturer(db, { ...a, groupNumber: 3 })).toBe(
      'Przypisano prowadzącego do ALG / Laboratorium, Gr. 3.',
    );
    expect(await assignLecturer(db, { ...a, groupNumber: 3 })).toBe(
      'Przypisano prowadzącego do ALG / Laboratorium, Gr. 3.',
    );
    expect(await db.select().from(classLecturers)).toHaveLength(2);
    expect(await db.select().from(classGroups)).toHaveLength(1);
    expect(await assignLecturer(db, { ...a, subjectCode: 'zzz' })).toBe(
      'Nie znaleziono przedmiotu zzz.',
    );
    expect(await assignLecturer(db, { ...a, lecturerId: 9999 })).toBe(
      'Nie znaleziono prowadzącego o id 9999.',
    );
  });
});

describe('task 6 commands', () => {
  const getSubject = async () =>
    (await db.select().from(subjects).where(eq(subjects.code, 'ALG')))[0];

  it('links a channel-less subject, keeping name/semester/ects', async () => {
    await db
      .insert(subjects)
      .values({ name: 'Algebra', code: 'ALG', semester: 1, ects: 5 });
    expect(
      await addSubject(db, {
        ...base,
        name: 'Other',
        ects: 9,
        semester: 2,
        description: 'Opis',
      }),
    ).toBe('Połączono przedmiot ALG z kanałem.');
    const s = await getSubject();
    expect(s).toMatchObject({
      name: 'Algebra',
      ects: 5,
      semester: 1,
      discordChannelId: 'c1',
      description: 'Opis',
    });
  });

  it('subject platform_url: set, clear, reject', async () => {
    await addSubject(db, base);
    expect(
      await editSubject(db, 'alg', { platformUrl: 'https://p.example/x' }),
    ).toBe('Zaktualizowano przedmiot ALG.');
    expect((await getSubject())?.platformUrl).toBe('https://p.example/x');
    expect(await editSubject(db, 'alg', { platformUrl: 'ftp://x' })).toBe(
      'Nieprawidłowy adres URL.',
    );
    expect((await getSubject())?.platformUrl).toBe('https://p.example/x');
    await editSubject(db, 'alg', { platformUrl: '-' });
    expect((await getSubject())?.platformUrl).toBeNull();
  });

  it('adds and edits lecturers with new fields, clear, duplicate email', async () => {
    const r = await addLecturer(db, {
      name: 'Jan',
      title: 'dr',
      email: 'Jan@Example.edu',
      officeHours: 'pn 10',
      room: '12',
    });
    const id = Number(/id (\d+)/.exec(r)?.[1]);
    let [l] = await db.select().from(lecturers).where(eq(lecturers.id, id));
    expect(l).toMatchObject({
      email: 'jan@example.edu',
      officeHours: 'pn 10',
      room: '12',
    });
    expect(await addLecturer(db, { name: 'X', email: 'JAN@example.edu' })).toBe(
      'Prowadzący z tym adresem e-mail już istnieje.',
    );
    const id2 = Number(
      /id (\d+)/.exec(await addLecturer(db, { name: 'Ewa' }))?.[1],
    );
    expect(await editLecturer(db, id2, { email: 'jan@example.edu' })).toBe(
      'Prowadzący z tym adresem e-mail już istnieje.',
    );
    expect(await editLecturer(db, id, { room: '-', officeHours: 'wt 9' })).toBe(
      'Zaktualizowano prowadzącego dr Jan.',
    );
    [l] = await db.select().from(lecturers).where(eq(lecturers.id, id));
    expect(l).toMatchObject({ room: null, officeHours: 'wt 9' });
    expect(await editLecturer(db, 9999, { name: 'Z' })).toBe(
      'Nie znaleziono prowadzącego o id 9999.',
    );
  });

  it('lecturer title/name edge cases', async () => {
    const id = Number(
      /id (\d+)/.exec(await addLecturer(db, { name: 'Jan', title: '-' }))?.[1],
    );
    expect((await db.select().from(lecturers))[0].title).toBeNull();
    expect(await editLecturer(db, id, { name: '  -  ' })).toBe(
      'Nazwa nie może być pusta.',
    );
    expect(await editLecturer(db, id, { name: '   ' })).toBe(
      'Nazwa nie może być pusta.',
    );
    expect((await db.select().from(lecturers))[0].name).toBe('Jan');
    await editLecturer(db, id, { name: '  Jan Nowak ' });
    expect((await db.select().from(lecturers))[0].name).toBe('Jan Nowak');
  });

  it('editClass updates, clears, rejects bad url, never creates', async () => {
    await addSubject(db, base);
    expect(await editClass(db, { subjectCode: 'alg', kind: 'wyklad' })).toBe(
      'Przedmiot ALG nie ma zajęć typu Wykład.',
    );
    expect(await db.select().from(classes)).toHaveLength(0);
    await assignLecturer(db, {
      subjectCode: 'alg',
      lecturerId: Number(
        /id (\d+)/.exec(await addLecturer(db, { name: 'A' }))?.[1],
      ),
      classKind: 'wyklad',
    });
    expect(
      await editClass(db, {
        subjectCode: 'alg',
        kind: 'wyklad',
        assessment: 'egzamin',
        note: 'ustny',
        platformUrl: 'https://p.example/c',
      }),
    ).toBe('Zaktualizowano ALG / Wykład.');
    let [c] = await db.select().from(classes);
    expect(c).toMatchObject({
      assessment: 'egzamin',
      assessmentNote: 'ustny',
      platformUrl: 'https://p.example/c',
    });
    expect(
      await editClass(db, {
        subjectCode: 'alg',
        kind: 'wyklad',
        note: '-',
        platformUrl: 'nope',
      }),
    ).toBe('Nieprawidłowy adres URL.');
    await editClass(db, {
      subjectCode: 'alg',
      kind: 'wyklad',
      note: '-',
      platformUrl: '-',
    });
    await editClass(db, {
      subjectCode: 'alg',
      kind: 'wyklad',
      assessment: 'brak',
    });
    [c] = await db.select().from(classes);
    expect(c.assessment).toBeNull();
    [c] = await db.select().from(classes);
    expect(c).toMatchObject({ assessmentNote: null, platformUrl: null });
  });
});

describe('ok flag and null channel', () => {
  it('returns the inserted row id', async () => {
    const l = await A.addLecturer(db, { name: 'Jan' });
    const [row] = await db.select().from(lecturers);
    expect(l.id).toBe(row?.id);
    const s = await A.addSubject(db, base);
    const [sub] = await db.select().from(subjects);
    expect(s.id).toBe(sub?.id);
    expect((await A.editSubject(db, 'alg', { ects: 6 })).id).toBeUndefined();
  });

  const ban = { discordUserId: 'u1', displayName: 'Ann', avatarUrl: null };

  it('is true on success and false on every refusal', async () => {
    expect((await A.addSubject(db, base)).ok).toBe(true);
    expect((await A.addSubject(db, base)).ok).toBe(false);
    expect((await A.editSubject(db, 'alg', { ects: 7 })).ok).toBe(true);
    expect((await A.editSubject(db, 'nope', { ects: 7 })).ok).toBe(false);
    expect(
      (await A.editSubject(db, 'alg', { platformUrl: 'ftp://x' })).ok,
    ).toBe(false);
    expect((await A.listSubjects(db)).ok).toBe(true);
    const l = await A.addLecturer(db, { name: 'Jan', email: 'j@x.pl' });
    expect(l.ok).toBe(true);
    const id = Number(/id (\d+)/.exec(l.message)?.[1]);
    expect((await A.addLecturer(db, { name: 'J2', email: 'j@x.pl' })).ok).toBe(
      false,
    );
    expect((await A.editLecturer(db, id, { room: '1' })).ok).toBe(true);
    expect((await A.editLecturer(db, id, { name: '-' })).ok).toBe(false);
    expect((await A.editLecturer(db, 9999, { room: '1' })).ok).toBe(false);
    const a = {
      subjectCode: 'alg',
      lecturerId: id,
      classKind: 'wyklad' as const,
    };
    expect((await A.assignLecturer(db, a)).ok).toBe(true);
    expect((await A.assignLecturer(db, { ...a, subjectCode: 'zzz' })).ok).toBe(
      false,
    );
    expect((await A.assignLecturer(db, { ...a, lecturerId: 9999 })).ok).toBe(
      false,
    );
    expect(
      (await A.editClass(db, { subjectCode: 'alg', kind: 'wyklad' })).ok,
    ).toBe(true);
    expect(
      (await A.editClass(db, { subjectCode: 'alg', kind: 'projekt' })).ok,
    ).toBe(false);
    expect(
      (await A.editClass(db, { subjectCode: 'zzz', kind: 'wyklad' })).ok,
    ).toBe(false);
    expect(
      (
        await A.editClass(db, {
          subjectCode: 'alg',
          kind: 'wyklad',
          platformUrl: 'x',
        })
      ).ok,
    ).toBe(false);
  });

  it('addSubject with channelId null inserts a subject with no channel', async () => {
    const r = await A.addSubject(db, { ...base, channelId: null });
    expect(r).toMatchObject({
      ok: true,
      message: 'Dodano przedmiot ALG (Algebra).',
    });
    const [s] = await db.select().from(subjects);
    expect(s?.discordChannelId).toBeNull();
    expect((await A.addSubject(db, { ...base, channelId: null })).ok).toBe(
      false,
    );
  });

  it('banUser', async () => {
    expect(await A.banUser(db, 'ghost', true)).toEqual({
      ok: false,
      message: 'Ten użytkownik nie korzystał jeszcze z bota.',
    });
    await upsertUser(db, ban);
    expect(await A.banUser(db, 'u1', true)).toEqual({
      ok: true,
      message: 'Zablokowano dostęp do strony.',
    });
    expect(await A.banUser(db, 'u1', false)).toEqual({
      ok: true,
      message: 'Odblokowano dostęp do strony.',
    });
  });
});
