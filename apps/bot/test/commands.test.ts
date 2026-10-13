import {
  classes,
  classGroups,
  classLecturers,
  consumeLoginToken,
  type Db,
  insertMaterial,
  lecturers,
  setBanned,
  subjects,
  topics,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { PermissionFlagsBits } from 'discord.js';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addLecturer,
  addSubject,
  assignLecturer,
  banReply,
  editClass,
  editLecturer,
  editSubject,
  listSubjects,
} from '../src/commands/admin.js';
import { commandDefinitions } from '../src/commands/definitions.js';
import { planStatusText, planSyncReply } from '../src/commands/plan.js';
import { replyOptions } from '../src/commands/reply.js';
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

  it('planStatusText: never, ok, error', () => {
    const now = new Date();
    const none = {
      requestedAt: null,
      lastRunAt: null,
      lastOkAt: null,
      lastError: null,
      stats: null,
    };
    expect(planStatusText(none, now)).toBe('Nigdy nie synchronizowano.');
    const ok = {
      ...none,
      lastOkAt: new Date('2026-10-12T10:30:00Z'),
      stats: { created: 3, updated: 2, deleted: 1, unchanged: 9, warnings: [] },
    };
    expect(planStatusText(ok, now)).toBe(
      'Ostatnia synchronizacja: 12.10.2026, 12:30 (+3 ~2 -1)',
    );
    expect(planStatusText({ ...ok, lastError: 'boom' }, now)).toBe(
      'Ostatnia synchronizacja: 12.10.2026, 12:30 (+3 ~2 -1)\nBłąd: boom',
    );
    expect(planStatusText({ ...none, lastError: 'boom' }, now)).toBe(
      'Nigdy nie synchronizowano.\nBłąd: boom',
    );
  });

  it('plan sync requests and reports status', async () => {
    expect(await planSyncReply(db, new Date())).toBe(
      'Zlecono synchronizację planu (wykona ją worker w ciągu minuty).\nNigdy nie synchronizowano.',
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

describe('escaping and mentions', () => {
  it('escapes markdown in the echoed query', async () => {
    expect(await searchReply(db, 'https://x.pl', '@everyone *x*')).toBe(
      'Brak wyników dla „@everyone \\*x\\*”.',
    );
  });
  it('replyOptions never allows mentions', () => {
    expect(replyOptions('@everyone').allowedMentions.parse).toEqual([]);
    expect(replyOptions('x', true).flags).toBeDefined();
  });
});

describe('commandDefinitions', () => {
  it('has unique top-level names including all 10', () => {
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
      'class',
      'plan',
      'setup',
    ])
      expect(names).toContain(n);
  });

  it('sets max_length on free-text options', () => {
    type Opt = { name: string; max_length?: number; options?: Opt[] };
    const find = (cmd: string, sub: string, opt: string) => {
      const c = commandDefinitions.find((x) => x.name === cmd) as unknown as {
        options: Opt[];
      };
      return c.options
        .find((o) => o.name === sub)
        ?.options?.find((o) => o.name === opt)?.max_length;
    };
    expect(find('subject', 'add', 'code')).toBe(20);
    expect(find('subject', 'add', 'name')).toBe(200);
    expect(find('subject', 'add', 'description')).toBe(1000);
    expect(find('subject', 'edit', 'name')).toBe(200);
    expect(find('subject', 'edit', 'description')).toBe(1000);
    expect(find('lecturer', 'add', 'name')).toBe(200);
    expect(find('lecturer', 'add', 'title')).toBe(50);
    expect(find('lecturer', 'add', 'email')).toBe(200);
  });

  it('lecturer assign takes class choices and optional group 1-99', () => {
    type Opt = {
      name: string;
      required?: boolean;
      min_value?: number;
      max_value?: number;
      choices?: { name: string; value: string }[];
      options?: Opt[];
    };
    const c = commandDefinitions.find(
      (x) => x.name === 'lecturer',
    ) as unknown as {
      options: Opt[];
    };
    const opts = c.options.find((o) => o.name === 'assign')?.options ?? [];
    expect(opts.find((o) => o.name === 'role')).toBeUndefined();
    const cls = opts.find((o) => o.name === 'class');
    expect(cls?.required).toBe(true);
    expect(cls?.choices).toEqual([
      { name: 'Wykład', value: 'wyklad' },
      { name: 'Laboratorium', value: 'laboratorium' },
      { name: 'Ćwiczenia', value: 'cwiczenia' },
      { name: 'Projekt', value: 'projekt' },
      { name: 'Seminarium', value: 'seminarium' },
      { name: 'Zajęcia praktyczne', value: 'praktyczne' },
      { name: 'WF', value: 'wf' },
    ]);
    const g = opts.find((o) => o.name === 'group');
    expect(g?.required).toBeFalsy();
    expect(g?.min_value).toBe(1);
    expect(g?.max_value).toBe(99);
  });

  it('defines new subcommands and options', () => {
    type Opt = {
      name: string;
      autocomplete?: boolean;
      choices?: unknown[];
      options?: Opt[];
    };
    const sub = (cmd: string, s: string) =>
      (
        commandDefinitions.find((x) => x.name === cmd) as unknown as {
          options: Opt[];
        }
      ).options.find((o) => o.name === s)?.options ?? [];
    const names = (o: Opt[]) => o.map((x) => x.name);
    expect(names(sub('subject', 'edit'))).toContain('platform_url');
    expect(names(sub('lecturer', 'add'))).toEqual(
      expect.arrayContaining(['office_hours', 'room']),
    );
    expect(names(sub('lecturer', 'edit'))).toEqual([
      'lecturer',
      'name',
      'title',
      'email',
      'office_hours',
      'room',
    ]);
    expect(sub('lecturer', 'edit')[0]?.autocomplete).toBe(true);
    expect(names(sub('class', 'edit'))).toEqual([
      'subject',
      'kind',
      'assessment',
      'note',
      'platform_url',
    ]);
    expect(sub('class', 'edit')[0]?.autocomplete).toBe(true);
    expect(sub('class', 'edit')[1]?.choices).toHaveLength(7);
    expect(sub('class', 'edit')[2]?.choices).toHaveLength(6);
    const plan = commandDefinitions.find(
      (x) => x.name === 'plan',
    ) as unknown as {
      options: Opt[];
    };
    expect(names(plan.options)).toEqual(['sync', 'status']);
  });

  it('restricts admin commands by default permissions only', () => {
    const perms = (n: string) =>
      commandDefinitions.find((c) => c.name === n)?.default_member_permissions;
    for (const n of [
      'subject',
      'lecturer',
      'class',
      'plan',
      'ban',
      'unban',
      'resync',
    ])
      expect(perms(n)).toBe(String(PermissionFlagsBits.ManageGuild));
    for (const n of ['link', 'search']) expect(perms(n)).toBeFalsy();
  });
});
