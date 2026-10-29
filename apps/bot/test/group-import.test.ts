import {
  classes,
  classGroups,
  classSessions,
  createRateLimiter,
  type Db,
  type GroupImportPreview,
  getMyGroups,
  NO_CLASSES_MESSAGE,
  setSetting,
  subjects,
  users,
} from '@studies/db';
import { closeTestDb, resetTestDb } from '@studies/db/testing';
import { MessageFlags } from 'discord.js';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createInteractionHandler,
  type RouterDeps,
} from '../src/commands/router.js';
import { groupImportSummary } from '../src/ui/group-import.js';
import { decodeId, encodeId } from '../src/ui/ids.js';
import { MAX_TEXT } from '../src/ui/limits.js';
import { parseStudentAction, parseStudentModal } from '../src/ui/student.js';
import { groupImportModal } from '../src/ui/views/modals.js';

// biome-ignore lint/suspicious/noExplicitAny: walking raw component JSON
type Json = any;

const preview = (
  over: Partial<GroupImportPreview> = {},
): GroupImportPreview => ({
  calendarName: null,
  totalEvents: 0,
  matched: [],
  ambiguous: [],
  unmatched: [],
  skipped: { exam: 0, noKind: 0, noGroup: 0 },
  ...over,
});
const matched = (n: number) =>
  Array.from({ length: n }, (_, k) => ({
    classId: k + 1,
    groupId: 100 + k,
    subjectName: `Przedmiot ${k + 1}`,
    className: 'Laboratorium',
    groupName: `Gr. ${k + 1}`,
    currentGroupId: null,
  }));

describe('groupImportSummary', () => {
  it('lists at most 15 groups, then the rest as a count', () => {
    const s = groupImportSummary(preview({ matched: matched(20) }), {
      set: 20,
    });
    const lines = s.split('\n');
    expect(lines[0]).toBe('Saved 20 groups.');
    const bullets = lines.filter((l) => l.startsWith('• '));
    expect(bullets).toHaveLength(15);
    expect(bullets[0]).toBe('• Przedmiot 1 · Laboratorium: Gr. 1');
    expect(lines).toContain('…and 5 more');
  });

  it('adds the ambiguous classes and the unmatched entries', () => {
    const s = groupImportSummary(
      preview({
        matched: matched(1),
        ambiguous: [
          {
            classId: 9,
            subjectName: 'A',
            className: 'B',
            groupNames: ['Gr. 1', 'Gr. 2'],
          },
        ],
        unmatched: [
          { subjectName: 'X', label: 'CWA 1', reason: 'subject' },
          { subjectName: 'Y', label: 'CWA 2', reason: 'class' },
        ],
      }),
      { set: 1 },
    );
    expect(s.split('\n')).toEqual([
      'Saved 1 group.',
      '• Przedmiot 1 · Laboratorium: Gr. 1',
      'Several groups for 1 class; pick them below.',
      '2 entries not matched.',
    ]);
  });

  it('is the no-classes message when nothing matched', () => {
    expect(groupImportSummary(preview(), { set: 0 })).toBe(NO_CLASSES_MESSAGE);
    expect(
      groupImportSummary(
        preview({
          unmatched: [{ subjectName: 'X', label: 'CWA 1', reason: 'subject' }],
        }),
        { set: 0 },
      ),
    ).toBe(NO_CLASSES_MESSAGE);
  });

  it('stays under the text limit', () => {
    const long = matched(15).map((m) => ({
      ...m,
      subjectName: 'S'.repeat(400),
    }));
    const s = groupImportSummary(preview({ matched: long }), { set: 15 });
    expect(s.length).toBeLessThanOrEqual(MAX_TEXT);
  });
});

describe('import ids', () => {
  it('round-trip the button and the modal ids', () => {
    const btn = encodeId('stu', 'groups', 'import');
    const sub = encodeId('stu', 'groups', 'importsubmit');
    expect(btn).toBe('v1:stu:groups:import');
    expect(sub).toBe('v1:stu:groups:importsubmit');
    const b = decodeId(btn);
    const m = decodeId(sub);
    expect(b).toEqual({ area: 'stu', action: 'groups', args: ['import'] });
    expect(m).toEqual({
      area: 'stu',
      action: 'groups',
      args: ['importsubmit'],
    });
    expect(parseStudentAction(b?.action ?? '', b?.args ?? [], [])).toEqual({
      kind: 'groupsImport',
    });
    expect(parseStudentModal(m?.action ?? '', m?.args ?? [], 'x')).toEqual({
      kind: 'groupsImportSubmit',
      url: 'x',
    });
    // The submit id is not a button, and the button id is not a modal.
    expect(parseStudentAction('groups', ['importsubmit'], [])).toBeNull();
    expect(parseStudentModal('groups', ['import'], 'x')).toBeNull();
    expect(parseStudentModal('groups', ['importsubmit', '1'], 'x')).toBeNull();
  });

  it('the modal has one required link field (max 500)', () => {
    const j: Json = groupImportModal().toJSON();
    expect(j.custom_id).toBe('v1:stu:groups:importsubmit');
    const input = j.components[0].component;
    expect(j.components[0].label).toBe('UniTime calendar link');
    expect(input).toMatchObject({ custom_id: 'url', max_length: 500 });
    expect(input.required).toBe(true);
  });
});

/* ---------- the handler ---------- */

let db: Db;
let pool: RouterDeps['pool'];
const id: Record<string, number> = {};

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:Personal Schedule',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Warsaw:20261001T094500',
  'DTEND;TZID=Europe/Warsaw:20261001T104500',
  'STATUS:CONFIRMED',
  'UID:1',
  'SUMMARY:Fizyka (1rok)',
  'DESCRIPTION:Laboratorium 2',
  'DTSTAMP:20260923T111915Z',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const URL_OK = 'https://plan.agh.edu.pl/calendar?q=SECRET';

beforeEach(async () => {
  if (db) await closeTestDb(db);
  db = await resetTestDb();
  pool = (db as unknown as { $client: RouterDeps['pool'] }).$client;
  await setSetting(db, 'admin_role_id', 'r');
  const [s] = await db
    .insert(subjects)
    .values({
      name: 'Fizyka',
      code: 'FIZ',
      semester: 1,
      ects: 5,
      unitimeName: 'Fizyka (1rok)',
    })
    .$returningId();
  const [c] = await db
    .insert(classes)
    .values({ subjectId: s.id, kind: 'laboratorium', name: 'Laboratorium' })
    .$returningId();
  id.cls = c.id;
  for (const n of [1, 2]) {
    const [g] = await db
      .insert(classGroups)
      .values({ classId: c.id, number: n, name: `Gr. ${n}` })
      .$returningId();
    id[`g${n}`] = g.id;
  }
  // The groups view lists classes that have sessions.
  await db.insert(classSessions).values({
    uid: 'u1',
    occurrenceStart: new Date('2026-10-14T10:00:00Z'),
    startsAt: new Date('2026-10-14T10:00:00Z'),
    endsAt: new Date('2026-10-14T11:30:00Z'),
    label: 'L',
    subjectId: s.id,
    classId: c.id,
    groupId: id.g2,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeTestDb(db);
});

const calendarFetch = () =>
  vi.fn(
    async () =>
      new Response(ICS, {
        status: 200,
        headers: { 'content-type': 'text/calendar; charset=utf-8' },
      }),
  );

function handler(fetchImpl: typeof fetch, limiter = createRateLimiter(6, 1e6)) {
  return createInteractionHandler({
    ingest: { db, storageDir: '', fetchBody: vi.fn() },
    client: {} as never,
    config: {
      adminRoleName: 'Studies Admin',
      webBaseUrl: 'https://x.pl',
      discordGuildId: 'G1',
    } as never,
    pool,
    groupImport: {
      fetchImpl,
      limiter,
      env: { UNITIME_IMPORT_HOSTS: 'plan.agh.edu.pl' },
    },
  });
}

function interaction(customId: string, url?: string) {
  const calls: string[] = [];
  const modal = url !== undefined;
  const i: Json = {
    customId,
    values: undefined,
    user: {
      id: 'stud',
      username: 'stud',
      globalName: null,
      displayAvatarURL: () => 'a',
      send: vi.fn(),
    },
    member: { roles: [] },
    message: { flags: { has: (f: number) => f === MessageFlags.Ephemeral } },
    deferred: false,
    replied: false,
    guildId: 'G1',
    fields: { getTextInputValue: (k: string) => (k === 'url' ? url : '') },
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => !modal,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isModalSubmit: () => modal,
    isMessageComponent: () => !modal,
    isRepliable: () => true,
    calls,
  };
  const rec = (name: string, after?: () => void) =>
    vi.fn(async () => {
      calls.push(name);
      after?.();
    });
  i.reply = rec('reply', () => {
    i.replied = true;
  });
  i.deferReply = rec('deferReply', () => {
    i.deferred = true;
  });
  i.deferUpdate = rec('deferUpdate', () => {
    i.deferred = true;
  });
  i.editReply = rec('editReply');
  i.followUp = rec('followUp');
  i.showModal = rec('showModal');
  return i;
}

function nodes(payload: Json): Json[] {
  const out: Json[] = [];
  const walk = (c: Json) => {
    out.push(c);
    for (const child of c.components ?? []) walk(child);
  };
  for (const c of payload?.components ?? [])
    walk(typeof c.toJSON === 'function' ? c.toJSON() : c);
  return out;
}
const textOf = (payload: Json) =>
  nodes(payload)
    .filter((n) => typeof n.content === 'string')
    .map((n) => n.content)
    .join('\n');

const SUBMIT = 'v1:stu:groups:importsubmit';

describe('import from UniTime in #panel', () => {
  it('the button opens the modal', async () => {
    const i = interaction('v1:stu:groups:import');
    await handler(calendarFetch())(i);
    expect(i.calls).toEqual(['showModal']);
    expect(i.showModal.mock.calls[0][0].toJSON().custom_id).toBe(SUBMIT);
  });

  it('saves the groups and replies with the summary and the groups view', async () => {
    const f = calendarFetch();
    const i = interaction(SUBMIT, `  ${URL_OK}  `);
    await handler(f)(i);
    expect(i.calls[0]).toBe('deferReply');
    expect(i.deferReply.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral);
    expect(f).toHaveBeenCalledTimes(1);
    const summary = textOf(i.editReply.mock.calls[0][0]);
    expect(summary).toContain('Saved 1 group.');
    expect(summary).toContain('• Fizyka · Laboratorium: Gr. 2');
    expect(summary).not.toContain('SECRET');
    const groups = textOf(i.followUp.mock.calls[0][0]);
    expect(groups).toContain('## My groups');
    expect(groups).toContain('Fizyka · Laboratorium — **Gr. 2**');
    const [u] = await db.select({ id: users.id }).from(users);
    expect(await getMyGroups(db, u.id)).toEqual({ [id.cls]: id.g2 });
  });

  it('does not save a group that is already saved', async () => {
    const f = calendarFetch();
    await handler(f)(interaction(SUBMIT, URL_OK));
    const i = interaction(SUBMIT, URL_OK);
    await handler(f)(i);
    expect(textOf(i.editReply.mock.calls[0][0])).toContain('Saved 0 groups.');
  });

  it('refuses a banned user (button and submit)', async () => {
    await db
      .insert(users)
      .values({ discordUserId: 'stud', displayName: 'stud', isBanned: true });
    const f = calendarFetch();
    const b = interaction('v1:stu:groups:import');
    await handler(f)(b);
    expect(b.showModal).not.toHaveBeenCalled();
    expect(textOf(b.reply.mock.calls[0][0])).toContain(
      'Your access to the website is blocked.',
    );
    const i = interaction(SUBMIT, URL_OK);
    await handler(f)(i);
    expect(textOf(i.editReply.mock.calls[0][0])).toContain(
      'Your access to the website is blocked.',
    );
    expect(f).not.toHaveBeenCalled();
  });

  it('the 7th import in the window is refused', async () => {
    const f = calendarFetch();
    const h = handler(f, createRateLimiter(6, 10 * 60_000));
    for (let n = 0; n < 6; n++) {
      const i = interaction(SUBMIT, URL_OK);
      await h(i);
      expect(textOf(i.editReply.mock.calls[0][0])).toContain('Saved');
    }
    const i = interaction(SUBMIT, URL_OK);
    await h(i);
    expect(textOf(i.editReply.mock.calls[0][0])).toBe(
      'Too many imports. Try again in a few minutes.',
    );
    expect(f).toHaveBeenCalledTimes(6);
  });

  it('a link from another host gets the guard error and is never fetched', async () => {
    const f = calendarFetch();
    const err = vi.spyOn(console, 'error');
    const i = interaction(SUBMIT, 'https://evil.example/cal?q=SECRET');
    await handler(f)(i);
    expect(textOf(i.editReply.mock.calls[0][0])).toBe(
      'Only links from plan.agh.edu.pl can be imported.',
    );
    expect(f).not.toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).not.toContain('SECRET');
  });

  it('maps fetch and parse failures to the safe messages', async () => {
    const html = vi.fn(
      async () =>
        new Response('<html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const a = interaction(SUBMIT, URL_OK);
    await handler(html)(a);
    expect(textOf(a.editReply.mock.calls[0][0])).toBe(
      'Unexpected response type (text/html) from plan.agh.edu.pl',
    );
    const notCal = vi.fn(
      async () =>
        new Response('hello', {
          status: 200,
          headers: { 'content-type': 'text/calendar' },
        }),
    );
    const b = interaction(SUBMIT, URL_OK);
    await handler(notCal)(b);
    expect(textOf(b.editReply.mock.calls[0][0])).toBe(
      'That is not a UniTime calendar (.ics).',
    );
  });
});
