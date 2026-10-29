import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMark,
  editMark,
  listMarks,
  MARK_CONFLICT,
  removeMark,
  restoreMark,
  skipDate,
  unskipDate,
} from '../src/class-marks.js';
import type { Db } from '../src/client.js';
import { BANNED_MESSAGE } from '../src/events.js';
import {
  adminAudit,
  classes,
  classGroups,
  classSessions,
  subjects,
  users,
} from '../src/schema.js';
import { closeTestDb, resetTestDb } from '../src/testing.js';

const ALREADY_ON_ALL = 'Entry quiz is already on for all groups of this class.';
const ALREADY_ON = 'Entry quiz is already on for this class.';

it('the stale-version refusal names the entry quiz, not an event', () => {
  expect(MARK_CONFLICT).toBe(
    "Someone changed this entry quiz while you were editing. Your changes weren't saved — reload to see the current version.",
  );
});

describe('class marks (entry quiz)', () => {
  let db: Db;
  const id: Record<string, number> = {};
  let uid = 0;

  const auditRows = (action: string, markId: number) =>
    db
      .select()
      .from(adminAudit)
      .where(
        and(
          eq(adminAudit.action, action),
          eq(adminAudit.target, `class_mark:${markId}`),
        ),
      );
  const session = (
    classId: number,
    groupId: number | null,
    startsAt: Date,
    o: Partial<typeof classSessions.$inferInsert> = {},
  ) =>
    db.insert(classSessions).values({
      uid: `s-${++uid}`,
      occurrenceStart: startsAt,
      subjectId: id.sub,
      classId,
      groupId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 90 * 60_000),
      ...o,
    });
  const user = async (
    name: string,
    o: Partial<typeof users.$inferInsert> = {},
  ) =>
    (
      await db
        .insert(users)
        .values({ discordUserId: `d-${name}`, displayName: name, ...o })
        .$returningId()
    )[0].id;
  const okId = (r: { ok: boolean; id?: number }) => {
    expect(r.ok).toBe(true);
    return r.id as number;
  };

  beforeAll(async () => {
    db = await resetTestDb();
    id.u = await user('Ala');
    id.banned = await user('Zbanowany', { isBanned: true });
    id.admin = await user('Admin', { isAdmin: true });
    [{ id: id.sub }] = await db
      .insert(subjects)
      .values({ code: 'BD', name: 'Bazy danych', semester: 1, ects: 5 })
      .$returningId();
    const cls = async (kind: 'laboratorium' | 'wyklad' | 'cwiczenia') =>
      (
        await db
          .insert(classes)
          .values({ subjectId: id.sub, kind, name: kind })
          .$returningId()
      )[0].id;
    id.lab = await cls('laboratorium');
    id.lec = await cls('wyklad');
    id.ex = await cls('cwiczenia');
    const grp = async (classId: number, number: number) =>
      (
        await db
          .insert(classGroups)
          .values({ classId, number, name: `Gr. ${number}` })
          .$returningId()
      )[0].id;
    id.g1 = await grp(id.lab, 1);
    id.g2 = await grp(id.lab, 2);
    id.lecG1 = await grp(id.lec, 1);
    // Lab group 2: confirmed on 2026-10-21, cancelled on 2026-10-28.
    await session(id.lab, id.g2, new Date(Date.UTC(2026, 9, 21, 10)));
    await session(id.lab, id.g2, new Date(Date.UTC(2026, 9, 28, 10)), {
      status: 'cancelled',
    });
    // Lab group 1 only on 2026-10-22.
    await session(id.lab, id.g1, new Date(Date.UTC(2026, 9, 22, 8)));
    // Lab group 2 late on 2026-10-29 (the end of the day, not the next one).
    await session(id.lab, id.g2, new Date(Date.UTC(2026, 9, 29, 23, 30)));
  });
  afterAll(async () => {
    await closeTestDb(db);
  });

  it('adds a mark, lists it and audits class_mark.add', async () => {
    const r = await addMark(
      db,
      id.u,
      { classId: id.lab, groupId: id.g2, kind: 'wejsciowka', note: ' Kartka ' },
      'web',
    );
    expect(r).toMatchObject({
      ok: true,
      message: 'Entry quiz turned on.',
      version: 0,
    });
    id.m = okId(r);
    const [m] = await listMarks(db, [id.lab]);
    expect(m).toEqual({
      id: id.m,
      classId: id.lab,
      groupId: id.g2,
      kind: 'wejsciowka',
      note: 'Kartka',
      version: 0,
      skips: [],
      deletedAt: null,
      updatedByName: 'Ala',
    });
    const audit = await auditRows('class_mark.add', id.m);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      userId: id.u,
      details: {
        source: 'web',
        classId: id.lab,
        groupId: id.g2,
        kind: 'wejsciowka',
        note: 'Kartka',
      },
    });
  });

  it('refuses a second active mark for the same class and group', async () => {
    const r = await addMark(
      db,
      id.u,
      { classId: id.lab, groupId: id.g2, kind: 'wejsciowka' },
      'discord',
    );
    expect(r).toEqual({ ok: false, message: ALREADY_ON });
  });

  it('allows a mark for all groups next to a group mark', async () => {
    const all = await addMark(
      db,
      id.u,
      { classId: id.lab, groupId: null, kind: 'wejsciowka' },
      'web',
    );
    id.mAll = okId(all);
    expect(
      await addMark(
        db,
        id.u,
        { classId: id.lab, groupId: null, kind: 'wejsciowka' },
        'web',
      ),
    ).toEqual({ ok: false, message: ALREADY_ON });
    expect((await listMarks(db, [id.lab])).map((m) => m.id)).toEqual([
      id.m,
      id.mAll,
    ]);
  });

  it('refuses a group mark while an all-groups mark is on', async () => {
    expect(
      await addMark(
        db,
        id.u,
        { classId: id.lab, groupId: id.g1, kind: 'wejsciowka' },
        'web',
      ),
    ).toEqual({
      ok: false,
      message: 'Entry quiz is already on for all groups of this class.',
    });
    expect((await listMarks(db, [id.lab])).map((m) => m.id)).toEqual([
      id.m,
      id.mAll,
    ]);
  });

  it('refuses an unknown mark type', async () => {
    expect(
      await addMark(
        db,
        id.u,
        {
          classId: id.lec,
          groupId: null,
          kind: 'nope' as unknown as 'wejsciowka',
        },
        'web',
      ),
    ).toEqual({ ok: false, message: 'Unknown mark type.' });
  });

  it('refuses a group of another class, an unknown class, a banned user', async () => {
    expect(
      await addMark(
        db,
        id.u,
        { classId: id.lab, groupId: id.lecG1, kind: 'wejsciowka' },
        'web',
      ),
    ).toEqual({ ok: false, message: 'This group is not part of the class.' });
    expect(
      await addMark(
        db,
        id.u,
        { classId: 999_999, groupId: null, kind: 'wejsciowka' },
        'web',
      ),
    ).toEqual({ ok: false, message: 'Class not found.' });
    expect(
      await addMark(
        db,
        id.banned,
        { classId: id.lec, groupId: null, kind: 'wejsciowka' },
        'web',
      ),
    ).toEqual({ ok: false, message: BANNED_MESSAGE });
    expect(await listMarks(db, [id.lec])).toEqual([]);
  });

  it('two concurrent adds create exactly one mark', async () => {
    const input = {
      classId: id.ex,
      groupId: null,
      kind: 'wejsciowka' as const,
    };
    const rs = await Promise.all([
      addMark(db, id.u, input, 'web'),
      addMark(db, id.admin, input, 'discord'),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toEqual({ ok: false, message: ALREADY_ON });
    expect(await listMarks(db, [id.ex])).toHaveLength(1);
  });

  it('refuses a note over 200 characters', async () => {
    const long = 'x'.repeat(201);
    expect(
      await addMark(
        db,
        id.u,
        { classId: id.lec, groupId: null, kind: 'wejsciowka', note: long },
        'web',
      ),
    ).toEqual({
      ok: false,
      message: 'The note can be at most 200 characters.',
    });
    expect(
      await editMark(
        db,
        id.u,
        id.m,
        { note: long },
        { expectedVersion: 0 },
        'web',
      ),
    ).toEqual({
      ok: false,
      message: 'The note can be at most 200 characters.',
    });
  });

  it('edits the note with the version check', async () => {
    const r = await editMark(
      db,
      id.u,
      id.m,
      { note: 'Kartka A4' },
      { expectedVersion: 0 },
      'web',
    );
    expect(r).toEqual({
      ok: true,
      message: 'Note saved.',
      id: id.m,
      version: 1,
    });
    expect(
      await editMark(
        db,
        id.u,
        id.m,
        { note: 'stale' },
        { expectedVersion: 0 },
        'web',
      ),
    ).toEqual({ ok: false, message: MARK_CONFLICT });
    expect(
      await editMark(
        db,
        id.banned,
        id.m,
        { note: 'x' },
        { expectedVersion: 1 },
        'web',
      ),
    ).toEqual({ ok: false, message: BANNED_MESSAGE });
    expect(
      await editMark(
        db,
        id.u,
        999_999,
        { note: 'x' },
        { expectedVersion: 0 },
        'web',
      ),
    ).toEqual({ ok: false, message: 'Entry quiz not found.' });
    const [m] = await listMarks(db, [id.lab]);
    expect(m).toMatchObject({ note: 'Kartka A4', version: 1 });
    expect((await auditRows('class_mark.edit', id.m))[0]).toMatchObject({
      details: { source: 'web', note: 'Kartka A4', before: 'Kartka' },
    });
  });

  it('skips and unskips a date with a confirmed session', async () => {
    const r = await skipDate(db, id.u, id.m, '2026-10-21', 'discord');
    expect(r).toEqual({
      ok: true,
      message: 'Skipped for that week.',
      id: id.m,
      version: 1,
    });
    expect(await skipDate(db, id.u, id.m, '2026-10-21', 'web')).toEqual({
      ok: false,
      message: 'This week is already skipped.',
    });
    const none = 'There is no session of this class on that date.';
    // Cancelled session, other group's session, no session, bad date.
    for (const d of ['2026-10-28', '2026-10-22', '2026-10-23', '21.10.2026']) {
      expect(await skipDate(db, id.u, id.m, d, 'web'), d).toEqual({
        ok: false,
        message: none,
      });
    }
    // The all-groups mark accepts any group's session.
    expect(await skipDate(db, id.u, id.mAll, '2026-10-22', 'web')).toEqual({
      ok: true,
      message: 'Skipped for that week.',
      id: id.mAll,
      version: 0,
    });
    expect(await skipDate(db, id.banned, id.m, '2026-10-21', 'web')).toEqual({
      ok: false,
      message: BANNED_MESSAGE,
    });
    expect((await listMarks(db, [id.lab]))[0].skips).toEqual(['2026-10-21']);
    expect((await auditRows('class_mark.skip', id.m))[0]).toMatchObject({
      details: { source: 'discord', onDate: '2026-10-21' },
    });

    expect(await unskipDate(db, id.u, id.m, '2026-10-21', 'web')).toEqual({
      ok: true,
      message: 'Skip undone.',
      id: id.m,
      version: 1,
    });
    expect(await unskipDate(db, id.u, id.m, '2026-10-21', 'web')).toEqual({
      ok: false,
      message: 'This week is not skipped.',
    });
    expect(await unskipDate(db, id.u, id.m, '21.10.2026', 'web')).toEqual({
      ok: false,
      message: 'This week is not skipped.',
    });
    expect((await listMarks(db, [id.lab]))[0].skips).toEqual([]);
    expect((await auditRows('class_mark.unskip', id.m))[0]).toMatchObject({
      details: { source: 'web', onDate: '2026-10-21' },
    });

    // The day is [00:00, next day 00:00).
    expect(await skipDate(db, id.u, id.m, '2026-10-30', 'web')).toEqual({
      ok: false,
      message: none,
    });
    expect((await skipDate(db, id.u, id.m, '2026-10-29', 'web')).ok).toBe(true);
    expect(
      (await unskipDate(db, id.u, id.m, '2026-10-29', 'web')).message,
    ).toBe('Skip undone.');
  });

  it('removes (soft), restores as admin, and refuses a restore over an active mark', async () => {
    expect(
      await removeMark(db, id.u, id.m, { expectedVersion: 0 }, 'web'),
    ).toEqual({ ok: false, message: MARK_CONFLICT });
    const r = await removeMark(db, id.u, id.m, { expectedVersion: 1 }, 'web');
    expect(r).toEqual({
      ok: true,
      message: 'Entry quiz turned off.',
      id: id.m,
      version: 2,
    });
    expect((await listMarks(db, [id.lab])).map((m) => m.id)).toEqual([id.mAll]);
    const withDeleted = await listMarks(db, [id.lab], { includeDeleted: true });
    expect(withDeleted.find((m) => m.id === id.m)?.deletedAt).toBeInstanceOf(
      Date,
    );
    expect(await removeMark(db, id.u, id.m, {}, 'web')).toEqual({
      ok: false,
      message: 'Entry quiz not found.',
    });
    expect(await skipDate(db, id.u, id.m, '2026-10-21', 'web')).toEqual({
      ok: false,
      message: 'Entry quiz not found.',
    });
    expect(await auditRows('class_mark.remove', id.m)).toHaveLength(1);
    // A removed mark cannot be edited or unskipped.
    expect(
      await editMark(
        db,
        id.u,
        id.m,
        { note: 'x' },
        { expectedVersion: 2 },
        'web',
      ),
    ).toEqual({ ok: false, message: 'Entry quiz not found.' });
    expect(await unskipDate(db, id.u, id.m, '2026-10-21', 'web')).toEqual({
      ok: false,
      message: 'Entry quiz not found.',
    });
    expect(await auditRows('class_mark.edit', id.m)).toHaveLength(1);

    expect(await restoreMark(db, id.u, id.m, 'web')).toEqual({
      ok: false,
      message: 'Only an admin can restore an entry quiz.',
    });
    // An all-groups mark is on, so a group mark would never show.
    expect(await restoreMark(db, id.admin, id.m, 'web')).toEqual({
      ok: false,
      message: ALREADY_ON_ALL,
    });
    expect((await removeMark(db, id.u, id.mAll, {}, 'web')).ok).toBe(true);
    const back = await restoreMark(db, id.admin, id.m, 'web');
    expect(back).toEqual({
      ok: true,
      message: 'Entry quiz restored.',
      id: id.m,
      version: 3,
    });
    expect((await listMarks(db, [id.lab])).map((m) => m.id)).toEqual([id.m]);
    expect((await auditRows('class_mark.restore', id.m))[0]).toMatchObject({
      userId: id.admin,
      details: { source: 'web' },
    });
    expect(await restoreMark(db, id.admin, id.m, 'web')).toEqual({
      ok: false,
      message: 'Entry quiz not found.',
    });

    // Turn off, turn a new one on, then try to restore the old one.
    expect(await removeMark(db, id.u, id.m, {}, 'web')).toEqual({
      ok: true,
      message: 'Entry quiz turned off.',
      id: id.m,
      version: 4,
    });
    okId(
      await addMark(
        db,
        id.u,
        { classId: id.lab, groupId: id.g2, kind: 'wejsciowka' },
        'web',
      ),
    );
    expect(await restoreMark(db, id.admin, id.m, 'discord')).toEqual({
      ok: false,
      message: ALREADY_ON,
    });
  });

  it('listMarks with no classes is empty', async () => {
    expect(await listMarks(db, [])).toEqual([]);
  });
});
