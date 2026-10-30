import {
  adminAudit,
  botRequests,
  CANCELLED_MESSAGE,
  classes,
  classLecturers,
  consumeLoginToken,
  createLoginToken,
  type Db,
  ensureClass,
  getPlanSyncStatus,
  lecturers,
  subjects,
  upsertUser,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

let db: Db;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

let failAudit = false;
vi.mock('@studies/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@studies/db')>();
  return {
    ...real,
    writeAudit: (...args: Parameters<typeof real.writeAudit>) => {
      if (failAudit) throw new Error('audit down');
      return real.writeAudit(...args);
    },
  };
});

let cookieSid: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) =>
      n === 'sid' && cookieSid ? { name: n, value: cookieSid } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
const revalidated: string[] = [];
vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => {
    revalidated.push(p);
  },
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));

const A = await import('../lib/admin-actions');

async function login(discordUserId: string) {
  const id = await upsertUser(db, {
    discordUserId,
    displayName: discordUserId,
    avatarUrl: null,
  });
  const r = await consumeLoginToken(db, await createLoginToken(db, id));
  return { id, sid: (r as { sessionToken: string }).sessionToken };
}

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

let admin: { id: number; sid: string };
let student: { id: number; sid: string };

const audits = () => db.select().from(adminAudit);
const lastAudit = async () => {
  const rows = await audits();
  return rows[rows.length - 1];
};

const subjectForm = (o: Record<string, string> = {}) =>
  fd({
    name: 'Analiza',
    code: 'ana1',
    semester: '1',
    ects: '5',
    description: '',
    ...o,
  });

beforeAll(async () => {
  db = await resetTestDb();
  admin = await login('admin-1');
  student = await login('student-1');
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
});
afterAll(() => closeTestDb(db));
beforeEach(() => {
  cookieSid = admin.sid;
  revalidated.length = 0;
});

describe('admin actions: gate', () => {
  it('a non-admin gets notFound from every action', async () => {
    cookieSid = student.sid;
    const all = [
      A.addSubjectAction,
      A.editSubjectAction,
      A.editClassAction,
      A.addLecturerAction,
      A.editLecturerAction,
      A.assignLecturerAction,
      A.setBanAction,
      A.requestPlanSyncAction,
      A.requestBotAction,
      A.cancelBotRequestAction,
    ];
    for (const action of all)
      await expect(action(null, subjectForm())).rejects.toThrow('notFound');
    cookieSid = undefined;
    await expect(A.addSubjectAction(null, subjectForm())).rejects.toThrow(
      'notFound',
    );
    expect(await db.select().from(subjects)).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });
});

describe('admin actions: subjects', () => {
  it('adds a subject and audits subject.add', async () => {
    const r = await A.addSubjectAction(null, subjectForm());
    expect(r).toEqual({ ok: true, message: 'Added subject ANA1 (Analiza).' });
    const [s] = await db.select().from(subjects);
    expect(s).toMatchObject({
      code: 'ANA1',
      name: 'Analiza',
      semester: 1,
      ects: 5,
      description: null,
      discordChannelId: null,
    });
    const a = await lastAudit();
    expect(a).toMatchObject({
      userId: admin.id,
      action: 'subject.add',
      target: 'ANA1',
    });
    expect(a.details).toMatchObject({ source: 'web', channelId: null });
    expect(revalidated).toContain('/admin/subjects');
  });

  it('refuses invalid input with a specific message and no audit', async () => {
    const before = (await audits()).length;
    const cases: [Record<string, string>, string][] = [
      [{ ects: '31' }, 'ECTS must be a whole number from 0 to 30.'],
      [{ ects: '2.5' }, 'ECTS must be a whole number from 0 to 30.'],
      [{ semester: '3' }, 'Semester must be 1 or 2.'],
      [{ name: 'x'.repeat(201) }, 'The name must be at most 200 characters.'],
      [{ name: '  ' }, 'The name cannot be empty.'],
      [{ code: 'A B' }, expect.stringContaining('The code may contain only')],
    ];
    for (const [o, message] of cases)
      expect(await A.addSubjectAction(null, subjectForm(o))).toEqual({
        ok: false,
        message,
      });
    expect(await db.select().from(subjects)).toHaveLength(1);
    expect(await audits()).toHaveLength(before);
  });

  it('a duplicate code is refused without an audit row', async () => {
    const before = (await audits()).length;
    const r = await A.addSubjectAction(null, subjectForm({ code: 'ANA1' }));
    expect(r?.ok).toBe(false);
    expect(await audits()).toHaveLength(before);
  });

  it('edits a subject; an empty field clears it; only changes are audited', async () => {
    await db
      .update(subjects)
      .set({ description: 'Old', platformUrl: 'https://old.example' })
      .where(eq(subjects.code, 'ANA1'));
    const r = await A.editSubjectAction(
      null,
      fd({
        code: 'ana1',
        name: 'Analiza 2',
        semester: '1',
        ects: '6',
        description: '',
        platformUrl: '',
      }),
    );
    expect(r).toEqual({ ok: true, message: 'Updated subject ANA1.' });
    const [s] = await db.select().from(subjects);
    expect(s).toMatchObject({
      name: 'Analiza 2',
      ects: 6,
      description: null,
      platformUrl: null,
    });
    const a = await lastAudit();
    expect(a).toMatchObject({ action: 'subject.edit', target: 'ANA1' });
    expect(a.details).toEqual({
      fields: ['name', 'ects', 'description', 'platformUrl'],
      source: 'web',
    });
    expect(revalidated).toEqual(
      expect.arrayContaining(['/admin/subjects', '/admin/subjects/ANA1']),
    );
  });

  it("an untouched stored value breaking today's limits does not block an edit", async () => {
    await db.insert(subjects).values({
      name: 'Legacy',
      code: 'LEG',
      semester: 2,
      ects: 3,
      description: 'd'.repeat(1500),
      platformUrl: 'ftp://legacy.example',
    });
    const r = await A.editSubjectAction(
      null,
      fd({
        code: 'leg',
        name: 'Legacy',
        semester: '2',
        ects: '4',
        description: 'd'.repeat(1500),
        platformUrl: 'ftp://legacy.example',
      }),
    );
    expect(r).toEqual({ ok: true, message: 'Updated subject LEG.' });
    const [s] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.code, 'LEG'));
    expect(s).toMatchObject({
      ects: 4,
      description: 'd'.repeat(1500),
      platformUrl: 'ftp://legacy.example',
    });
    expect((await lastAudit()).details).toEqual({
      fields: ['ects'],
      source: 'web',
    });
    // A changed overlong description is still refused.
    expect(
      await A.editSubjectAction(
        null,
        fd({
          code: 'LEG',
          name: 'Legacy',
          semester: '2',
          ects: '4',
          description: 'e'.repeat(1001),
          platformUrl: 'ftp://legacy.example',
        }),
      ),
    ).toEqual({
      ok: false,
      message: 'The description must be at most 1000 characters.',
    });
  });

  it('an unchanged form says No changes. and writes no audit row', async () => {
    const before = (await audits()).length;
    expect(
      await A.editSubjectAction(
        null,
        fd({
          code: 'ANA1',
          name: 'Analiza 2',
          semester: '1',
          ects: '6',
          description: '',
          platformUrl: '',
        }),
      ),
    ).toEqual({ ok: true, message: 'No changes.', unchanged: true });
    expect(await audits()).toHaveLength(before);
  });

  it('a CRLF copy of a stored LF description is No changes. (browsers send CRLF)', async () => {
    // 995 chars with LF; the CRLF copy is 1003, past the 1000 limit if
    // measured raw.
    const lf = `${'a'.repeat(490)}\n${'b'.repeat(490)}\n\n${'c'.repeat(12)}`;
    await db.insert(subjects).values({
      name: 'Wielolinijkowy',
      code: 'CRLF',
      semester: 1,
      ects: 2,
      description: lf,
    });
    const before = (await audits()).length;
    const form = {
      code: 'CRLF',
      name: 'Wielolinijkowy',
      semester: '1',
      ects: '2',
      description: lf.replaceAll('\n', '\r\n'),
      platformUrl: '',
    };
    expect(await A.editSubjectAction(null, fd(form))).toEqual({
      ok: true,
      message: 'No changes.',
      unchanged: true,
    });
    expect(await audits()).toHaveLength(before);
    // Another field edited: the description is neither rewritten nor listed.
    expect(await A.editSubjectAction(null, fd({ ...form, ects: '3' }))).toEqual(
      { ok: true, message: 'Updated subject CRLF.' },
    );
    const [s] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.code, 'CRLF'));
    expect(s.description).toBe(lf);
    expect((await lastAudit()).details).toEqual({
      fields: ['ects'],
      source: 'web',
    });
  });

  it('refuses - as a name on add', async () => {
    expect(
      await A.addSubjectAction(null, subjectForm({ name: '-', code: 'DASH' })),
    ).toEqual({ ok: false, message: 'The name cannot be empty.' });
    expect(await A.addLecturerAction(null, fd({ name: ' - ' }))).toEqual({
      ok: false,
      message: 'The name cannot be empty.',
    });
  });

  it('an audit failure after the change still reports success', async () => {
    const before = (await audits()).length;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    failAudit = true;
    try {
      expect(
        await A.addSubjectAction(null, subjectForm({ code: 'AUD' })),
      ).toMatchObject({ ok: true });
      expect(err).toHaveBeenCalled();
    } finally {
      failAudit = false;
      err.mockRestore();
    }
    expect(
      await db.select().from(subjects).where(eq(subjects.code, 'AUD')),
    ).toHaveLength(1);
    expect(await audits()).toHaveLength(before);
  });

  it('refuses a bad URL and an unknown subject', async () => {
    const before = (await audits()).length;
    const base = {
      code: 'ANA1',
      name: 'Analiza 2',
      semester: '1',
      ects: '6',
      description: '',
    };
    expect(
      await A.editSubjectAction(null, fd({ ...base, platformUrl: 'ftp://x' })),
    ).toEqual({ ok: false, message: 'Invalid URL.' });
    expect(
      await A.editSubjectAction(
        null,
        fd({ ...base, code: 'NOPE', platformUrl: '' }),
      ),
    ).toEqual({ ok: false, message: 'Subject NOPE not found.' });
    expect(await audits()).toHaveLength(before);
  });
});

describe('admin actions: classes and lecturers', () => {
  let lecturerId: number;

  it('adds a lecturer and audits lecturer.add', async () => {
    const r = await A.addLecturerAction(
      null,
      fd({
        name: 'Jan Kowalski',
        title: 'dr',
        email: 'JAN@Example.com',
        officeHours: '',
        room: '',
      }),
    );
    expect(r?.ok).toBe(true);
    const [l] = await db.select().from(lecturers);
    lecturerId = l.id;
    expect(l).toMatchObject({
      name: 'Jan Kowalski',
      title: 'dr',
      email: 'jan@example.com',
      officeHours: null,
      room: null,
    });
    const a = await lastAudit();
    expect(a).toMatchObject({ action: 'lecturer.add', target: String(l.id) });
    expect(a.details).toEqual({ name: 'Jan Kowalski', source: 'web' });
    expect(revalidated).toContain('/admin/lecturers');
  });

  it('refuses an overlong lecturer field and a bad email', async () => {
    const before = (await audits()).length;
    expect(
      await A.addLecturerAction(null, fd({ name: 'X', room: 'r'.repeat(101) })),
    ).toEqual({
      ok: false,
      message: 'The room must be at most 100 characters.',
    });
    expect(
      await A.addLecturerAction(null, fd({ name: 'X', email: 'nope' })),
    ).toEqual({ ok: false, message: 'Invalid email address.' });
    expect(await audits()).toHaveLength(before);
  });

  it('edits a lecturer; empty clears', async () => {
    const r = await A.editLecturerAction(
      null,
      fd({
        id: String(lecturerId),
        name: 'Jan Kowalski',
        title: '',
        email: 'jan@example.com',
        officeHours: 'Mon 10-12',
        room: '',
      }),
    );
    expect(r).toEqual({ ok: true, message: 'Updated lecturer Jan Kowalski.' });
    const [l] = await db.select().from(lecturers);
    expect(l).toMatchObject({ title: null, officeHours: 'Mon 10-12' });
    const a = await lastAudit();
    expect(a).toMatchObject({
      action: 'lecturer.edit',
      target: String(lecturerId),
    });
    expect(a.details).toEqual({
      fields: ['title', 'officeHours'],
      source: 'web',
    });
    expect(
      await A.editLecturerAction(null, fd({ id: 'abc', name: 'X' })),
    ).toEqual({ ok: false, message: 'Lecturer not found.' });
  });

  it('a duplicate email on edit is refused without an audit row', async () => {
    const add = await A.addLecturerAction(
      null,
      fd({ name: 'Anna Nowak', email: 'anna@example.com' }),
    );
    expect(add?.ok).toBe(true);
    const before = (await audits()).length;
    expect(
      await A.editLecturerAction(
        null,
        fd({
          id: String(lecturerId),
          name: 'Jan Kowalski',
          email: 'anna@example.com',
          officeHours: 'Mon 10-12',
        }),
      ),
    ).toEqual({
      ok: false,
      message: 'A lecturer with this email address already exists.',
    });
    expect(await audits()).toHaveLength(before);
  });

  it('editing a lecturer revalidates the subject pages', async () => {
    await A.editLecturerAction(
      null,
      fd({ id: String(lecturerId), name: 'Jan K.', officeHours: 'Mon 10-12' }),
    );
    expect(revalidated).toContain('/admin/subjects');
    await A.editLecturerAction(
      null,
      fd({
        id: String(lecturerId),
        name: 'Jan Kowalski',
        officeHours: 'Mon 10-12',
      }),
    );
  });

  it('assigns a lecturer and audits lecturer.assign', async () => {
    const r = await A.assignLecturerAction(
      null,
      fd({
        code: 'ana1',
        lecturerId: String(lecturerId),
        kind: 'laboratorium',
        group: '2',
      }),
    );
    expect(r?.ok).toBe(true);
    expect(await db.select().from(classLecturers)).toHaveLength(1);
    const a = await lastAudit();
    expect(a).toMatchObject({ action: 'lecturer.assign', target: 'ANA1' });
    expect(a.details).toEqual({
      lecturerId,
      classKind: 'laboratorium',
      groupNumber: 2,
      source: 'web',
    });
    expect(
      await A.assignLecturerAction(
        null,
        fd({
          code: 'ANA1',
          lecturerId: String(lecturerId),
          kind: 'laboratorium',
          group: '100',
        }),
      ),
    ).toEqual({
      ok: false,
      message: 'Group must be a whole number from 1 to 99.',
    });
    expect(
      await A.assignLecturerAction(
        null,
        fd({ code: 'ANA1', lecturerId: String(lecturerId), kind: 'zzz' }),
      ),
    ).toEqual({ ok: false, message: 'Unknown class type.' });
  });

  it('edits a class and audits class.edit', async () => {
    const [s] = await db.select().from(subjects);
    await ensureClass(db, s.id, 'wyklad');
    const r = await A.editClassAction(
      null,
      fd({
        code: 'ana1',
        kind: 'wyklad',
        assessment: 'egzamin',
        note: 'Pisemny',
        platformUrl: 'https://upel.example/c/1',
      }),
    );
    expect(r?.ok).toBe(true);
    const [c] = await db
      .select()
      .from(classes)
      .where(eq(classes.kind, 'wyklad'));
    expect(c).toMatchObject({
      assessment: 'egzamin',
      assessmentNote: 'Pisemny',
      platformUrl: 'https://upel.example/c/1',
    });
    const a = await lastAudit();
    expect(a).toMatchObject({ action: 'class.edit', target: 'ANA1' });
    expect(a.details).toEqual({
      kind: 'wyklad',
      fields: ['assessment', 'note', 'platformUrl'],
      source: 'web',
    });
    // An empty assessment clears it.
    expect(
      (
        await A.editClassAction(
          null,
          fd({
            code: 'ANA1',
            kind: 'wyklad',
            assessment: '',
            note: 'Pisemny',
            platformUrl: 'https://upel.example/c/1',
          }),
        )
      )?.ok,
    ).toBe(true);
    const [c2] = await db
      .select()
      .from(classes)
      .where(eq(classes.kind, 'wyklad'));
    expect(c2.assessment).toBeNull();
    expect(
      await A.editClassAction(
        null,
        fd({ code: 'ANA1', kind: 'wyklad', assessment: 'bogus' }),
      ),
    ).toEqual({ ok: false, message: 'Unknown assessment.' });
  });
});

describe('admin actions: missing class', () => {
  it('editClass on a class the subject lacks is refused, no audit', async () => {
    const before = (await audits()).length;
    expect(
      await A.editClassAction(
        null,
        fd({ code: 'ANA1', kind: 'seminarium', assessment: 'egzamin' }),
      ),
    ).toEqual({ ok: false, message: 'Subject ANA1 has no Seminarium class.' });
    expect(await audits()).toHaveLength(before);
  });
});

describe('admin actions: users', () => {
  it('blocks and unblocks another user', async () => {
    const r = await A.setBanAction(
      null,
      fd({ discordUserId: 'student-1', banned: '1' }),
    );
    expect(r).toEqual({ ok: true, message: 'Blocked access to the website.' });
    const [u] = await db.select().from(users).where(eq(users.id, student.id));
    expect(u.isBanned).toBe(true);
    let a = await lastAudit();
    expect(a).toMatchObject({ action: 'user.ban', target: 'student-1' });
    expect(a.details).toEqual({ source: 'web' });
    expect(revalidated).toContain('/admin/users');

    expect(
      (
        await A.setBanAction(
          null,
          fd({ discordUserId: 'student-1', banned: '0' }),
        )
      )?.ok,
    ).toBe(true);
    a = await lastAudit();
    expect(a).toMatchObject({ action: 'user.unban', target: 'student-1' });
  });

  it('unblocking yourself is allowed', async () => {
    expect(
      await A.setBanAction(null, fd({ discordUserId: 'admin-1', banned: '0' })),
    ).toEqual({ ok: true, message: 'Unblocked access to the website.' });
    expect(await lastAudit()).toMatchObject({
      action: 'user.unban',
      target: 'admin-1',
    });
  });

  it('refuses blocking yourself, with no audit row', async () => {
    const before = (await audits()).length;
    expect(
      await A.setBanAction(null, fd({ discordUserId: 'admin-1', banned: '1' })),
    ).toEqual({ ok: false, message: 'You cannot block yourself.' });
    const [u] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(u.isBanned).toBe(false);
    expect(
      await A.setBanAction(null, fd({ discordUserId: 'x', banned: 'yes' })),
    ).toMatchObject({ ok: false });
    expect(
      await A.setBanAction(null, fd({ discordUserId: 'ghost', banned: '1' })),
    ).toEqual({ ok: false, message: 'This user has not used the bot yet.' });
    expect(await audits()).toHaveLength(before);
  });
});

describe('admin actions: sync', () => {
  it('requests a plan sync and audits plan.sync', async () => {
    const r = await A.requestPlanSyncAction(null, new FormData());
    expect(r).toEqual({
      ok: true,
      message:
        'Timetable sync requested (the worker will run it within a minute).',
    });
    expect((await getPlanSyncStatus(db)).requestedAt).not.toBeNull();
    const a = await lastAudit();
    expect(a).toMatchObject({ action: 'plan.sync', target: null });
    expect(a.details).toEqual({ source: 'web' });
    expect(revalidated).toContain('/admin/sync');
  });

  it('queues a bot request once; a second one is refused', async () => {
    const r = await A.requestBotAction(null, fd({ kind: 'setup_dry_run' }));
    expect(r?.ok).toBe(true);
    const [req] = await db.select().from(botRequests);
    expect(req).toMatchObject({
      kind: 'setup_dry_run',
      target: 'guild',
      status: 'queued',
    });
    expect(req.payload).toEqual({ requestedBy: admin.id });
    const a = await lastAudit();
    expect(a).toMatchObject({
      action: 'bot.request',
      target: `bot_request:${req.id}`,
    });
    expect(a.details).toEqual({ kind: 'setup_dry_run', source: 'web' });

    const before = (await audits()).length;
    expect(await A.requestBotAction(null, fd({ kind: 'resync' }))).toEqual({
      ok: false,
      message: 'The bot is already working on a request.',
    });
    expect(
      await A.requestBotAction(null, fd({ kind: 'event_upload' })),
    ).toEqual({ ok: false, message: 'Unknown request.' });
    expect(await audits()).toHaveLength(before);
  });

  it('cancels a queued request and audits bot.request_cancel', async () => {
    const [req] = await db.select().from(botRequests);
    const r = await A.cancelBotRequestAction(null, fd({ id: String(req.id) }));
    expect(r).toEqual({ ok: true, message: CANCELLED_MESSAGE });
    const [after] = await db.select().from(botRequests);
    expect(after).toMatchObject({ status: 'failed', error: CANCELLED_MESSAGE });
    const a = await lastAudit();
    expect(a).toMatchObject({
      action: 'bot.request_cancel',
      target: `bot_request:${req.id}`,
    });
    expect(a.details).toEqual({ source: 'web' });

    const before = (await audits()).length;
    expect(
      (await A.cancelBotRequestAction(null, fd({ id: String(req.id) })))?.ok,
    ).toBe(false);
    expect((await A.cancelBotRequestAction(null, fd({ id: 'x' })))?.ok).toBe(
      false,
    );
    expect(await audits()).toHaveLength(before);
  });

  it('cancels a stuck running request, not a recently started one', async () => {
    await db.delete(botRequests);
    const [res] = await db.insert(botRequests).values({
      kind: 'resync',
      target: 'guild',
      status: 'running',
      payload: { requestedBy: admin.id },
      startedAt: new Date(Date.now() - 60_000),
    });
    const id = res.insertId;
    expect(
      await A.cancelBotRequestAction(null, fd({ id: String(id) })),
    ).toEqual({
      ok: false,
      message: 'Only a request that is waiting or stuck can be cancelled.',
    });
    await db
      .update(botRequests)
      .set({ startedAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(botRequests.id, id));
    expect(
      await A.cancelBotRequestAction(null, fd({ id: String(id) })),
    ).toEqual({ ok: true, message: CANCELLED_MESSAGE });
    const [after] = await db
      .select()
      .from(botRequests)
      .where(eq(botRequests.id, id));
    expect(after).toMatchObject({ status: 'failed', error: CANCELLED_MESSAGE });
    expect(await lastAudit()).toMatchObject({
      action: 'bot.request_cancel',
      target: `bot_request:${id}`,
    });
  });
});
