import { readFileSync } from 'node:fs';
import {
  classes,
  classGroups,
  type Db,
  getMyGroups,
  IMPORT_MAX_BYTES,
  NO_CLASSES_MESSAGE,
  NOT_A_CALENDAR_MESSAGE,
  subjects,
  upsertUser,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

let db: Db;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// The signed-in user; null means "no session" (requireUser redirects).
let current: { id: number } | null = null;
vi.mock('@/lib/session', () => ({
  requireUser: async () => {
    if (!current) throw new Error('redirect:/login-info');
    return { id: current.id, discordUserId: 'x', displayName: 'X' };
  },
}));
const revalidated: string[] = [];
vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => {
    revalidated.push(p);
  },
}));

const { previewGroupImportAction, applyGroupImportAction } = await import(
  '../lib/group-import-actions'
);
const { readIcsFile } = await import('../lib/group-import');

const fixture = readFileSync(
  new URL('../../../packages/db/test/fixtures/personal.ics', import.meta.url),
  'utf8',
);
const URL_HOST = 'plan.agh.edu.pl';
const SECRET_URL = `https://${URL_HOST}/UniTime/export?token=s3cret-token`;

let classCw: number;
let gr1: number;
let gr2: number;
let nextUser = 0;

/** A fresh user per test, so the rate limiter never carries over. */
async function signIn() {
  nextUser++;
  const id = await upsertUser(db, {
    discordUserId: `gi-web-${nextUser}`,
    displayName: `U${nextUser}`,
    avatarUrl: null,
  });
  current = { id };
  return id;
}

function form(fields: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const icsFile = (text: string, name = 'personal.ics') =>
  new File([text], name, { type: 'text/calendar' });

beforeAll(async () => {
  db = await resetTestDb();
  const [{ id: s }] = await db
    .insert(subjects)
    .values({
      name: 'Chemia ogólna',
      code: 'CH',
      semester: 1,
      ects: 1,
      discordChannelId: 'gi-web-ch',
      unitimeName: 'Chemia ogólna (1rok)',
    })
    .$returningId();
  [{ id: classCw }] = await db
    .insert(classes)
    .values({ subjectId: s, kind: 'cwiczenia', name: 'Ćwiczenia' })
    .$returningId();
  [{ id: gr1 }] = await db
    .insert(classGroups)
    .values({ classId: classCw, number: 1, name: 'Gr. 1' })
    .$returningId();
  [{ id: gr2 }] = await db
    .insert(classGroups)
    .values({ classId: classCw, number: 2, name: 'Gr. 2' })
    .$returningId();
});
afterEach(() => {
  vi.unstubAllGlobals();
  current = null;
});
afterAll(async () => {
  await closeTestDb(db);
});

describe('readIcsFile', () => {
  it('reads a small file and refuses a missing or too large one', async () => {
    expect(await readIcsFile(icsFile('BEGIN:VCALENDAR'))).toBe(
      'BEGIN:VCALENDAR',
    );
    expect(await readIcsFile(null)).toEqual({ error: expect.any(String) });
    expect(
      await readIcsFile(icsFile('x'.repeat(IMPORT_MAX_BYTES + 1))),
    ).toEqual({ error: 'The file is too large (max 2 MB).' });
  });
});

describe('previewGroupImportAction', () => {
  it('needs a signed-in user', async () => {
    current = null;
    await expect(
      previewGroupImportAction(form({ file: icsFile(fixture) })),
    ).rejects.toThrow('redirect:');
    await expect(applyGroupImportAction([])).rejects.toThrow('redirect:');
  });

  it('refuses a link from another host with the guard message', async () => {
    await signIn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await previewGroupImportAction(
      form({ url: 'https://evil.example.com/x.ics' }),
    );
    expect(r).toEqual({
      ok: false,
      error: `Only links from ${URL_HOST} can be imported.`,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a file over 2 MiB', async () => {
    await signIn();
    const r = await previewGroupImportAction(
      form({ file: icsFile('x'.repeat(IMPORT_MAX_BYTES + 1)) }),
    );
    expect(r).toEqual({
      ok: false,
      error: 'The file is too large (max 2 MB).',
    });
  });

  it('refuses an html file', async () => {
    await signIn();
    const r = await previewGroupImportAction(
      form({ file: icsFile('<html><body>Hi</body></html>', 'x.html') }),
    );
    expect(r).toEqual({ ok: false, error: NOT_A_CALENDAR_MESSAGE });
  });

  it('asks for a link or a file when both are empty', async () => {
    await signIn();
    const r = await previewGroupImportAction(
      form({ url: '  ', file: icsFile('') }),
    );
    expect(r.ok).toBe(false);
  });

  it('previews a valid file, without the link anywhere in the result', async () => {
    await signIn();
    const r = await previewGroupImportAction(
      form({ url: SECRET_URL, file: icsFile(fixture) }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notice).toBeNull();
    expect(r.preview.matched).toEqual([
      expect.objectContaining({
        classId: classCw,
        groupId: gr2,
        subjectName: 'Chemia ogólna',
        groupName: 'Gr. 2',
        currentGroupId: null,
      }),
    ]);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/"url"/);
    expect(json).not.toContain('s3cret-token');
  });

  it('fetches an allowed link and never returns or echoes it', async () => {
    await signIn();
    const fetchSpy = vi.fn(
      async () =>
        new Response(fixture, {
          status: 200,
          headers: { 'content-type': 'text/calendar; charset=utf-8' },
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const r = await previewGroupImportAction(form({ url: ` ${SECRET_URL} ` }));
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(r.ok).toBe(true);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/"url"/);
    expect(json).not.toContain('s3cret-token');
  });

  it('passes a host-only fetch error through and hides the link', async () => {
    await signIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(`connect failed for ${SECRET_URL}`);
      }),
    );
    const r = await previewGroupImportAction(form({ url: SECRET_URL }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain(URL_HOST);
    expect(r.error).not.toContain('s3cret-token');
  });

  it('turns any other error into a generic message', async () => {
    await signIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // A body that blows up mid-read with the URL in the message.
        return {
          status: 200,
          headers: new Headers({ 'content-type': 'text/calendar' }),
          body: {
            getReader() {
              throw new Error(`boom ${SECRET_URL}`);
            },
          },
        } as unknown as Response;
      }),
    );
    const r = await previewGroupImportAction(form({ url: SECRET_URL }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).not.toContain('s3cret-token');
  });

  it('gives the no-classes notice for a calendar without classes', async () => {
    await signIn();
    const empty =
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Personal Schedule\r\nEND:VCALENDAR\r\n';
    const r = await previewGroupImportAction(form({ file: icsFile(empty) }));
    expect(r).toMatchObject({ ok: true, notice: NO_CLASSES_MESSAGE });
  });

  it('allows 6 imports per 10 minutes, then refuses', async () => {
    await signIn();
    for (let i = 0; i < 6; i++) {
      const r = await previewGroupImportAction(
        form({ file: icsFile(fixture) }),
      );
      expect(r.ok).toBe(true);
    }
    const r = await previewGroupImportAction(form({ file: icsFile(fixture) }));
    expect(r).toEqual({
      ok: false,
      error: 'Too many imports. Try again in a few minutes.',
    });
  });
});

describe('applyGroupImportAction', () => {
  it('refuses anything but a short array of id pairs', async () => {
    await signIn();
    const invalid = { ok: false, error: 'Invalid selection.' };
    expect(await applyGroupImportAction('x')).toEqual(invalid);
    expect(await applyGroupImportAction(null)).toEqual(invalid);
    expect(
      await applyGroupImportAction(
        Array.from({ length: 101 }, () => ({ classId: classCw, groupId: gr1 })),
      ),
    ).toEqual(invalid);
    expect(
      await applyGroupImportAction([{ classId: '1', groupId: gr1 }]),
    ).toEqual(invalid);
    expect(
      await applyGroupImportAction([{ classId: classCw, groupId: 1.5 }]),
    ).toEqual(invalid);
  });

  it('saves the pairs, merges and revalidates both plan pages', async () => {
    const userId = await signIn();
    revalidated.length = 0;
    const r = await applyGroupImportAction([
      { classId: classCw, groupId: gr2 },
    ]);
    expect(r).toEqual({ ok: true, set: 1 });
    expect(await getMyGroups(db, userId)).toEqual({ [classCw]: gr2 });
    expect(revalidated).toEqual(expect.arrayContaining(['/plan', '/s/plan']));
  });

  it('skips a group of another class without throwing', async () => {
    await signIn();
    const r = await applyGroupImportAction([
      { classId: classCw + 999, groupId: gr1 },
    ]);
    expect(r).toEqual({ ok: true, set: 0 });
  });
});
