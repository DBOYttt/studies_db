import { CLASS_KINDS, CLASS_NAMES, classifyTags, groupName } from '@studies/db';
import { describe, expect, it } from 'vitest';
import { renderEventsInfoPost } from '../src/setup/info.js';
import {
  desiredTags,
  forumSlug,
  needsSecondPass,
  parseForumName,
  planSetup as planAll,
  secondPassActions,
} from '../src/setup/plan.js';
import type {
  Action,
  ClassSpec,
  GuildSnapshot,
  MaterialSpec,
  SubjectSpec,
} from '../src/setup/types.js';

const cls = (kind: ClassSpec['kind'], groups: number[] = []): ClassSpec => ({
  kind,
  name: CLASS_NAMES[kind],
  assessment: null,
  assessmentNote: null,
  platformUrl: null,
  groups,
  lecturers: [],
});

const ASD: SubjectSpec = {
  id: 1,
  code: 'ASD',
  name: 'Algorytmy i struktury danych',
  semester: 3,
  ects: 6,
  platformUrl: null,
  channelId: null,
  classes: [cls('wyklad'), cls('laboratorium', [1, 2, 3])],
};
const BD: SubjectSpec = {
  id: 2,
  code: 'BD',
  name: 'Bazy danych',
  semester: 3,
  ects: 5,
  platformUrl: null,
  channelId: 'f-bd',
  classes: [cls('wyklad')],
};

const render = (s: SubjectSpec) => `G:${s.code}`;

const isEvents = (a: Action) =>
  a.type === 'ensureEventsForum' ||
  a.type === 'addEventsTags' ||
  a.type === 'upsertEventsInfoPost' ||
  (a.type === 'warn' && a.code === '#wydarzenia');
/** The plan without the #wydarzenia actions (covered in 'planSetup: #wydarzenia'). */
const planWithPanels: typeof planAll = (...args) =>
  planAll(...args).filter((a) => !isEvents(a));

const isPanel = (a: Action) =>
  a.type === 'ensurePanelChannel' ||
  a.type === 'ensurePanelMessage' ||
  a.type === 'syncAdminPanelPerms' ||
  (a.type === 'warn' && a.message.includes('kanałów tekstowych'));
/** The plan without the panel actions (covered in 'planSetup: panels'). */
const planSetup: typeof planWithPanels = (...args) =>
  planWithPanels(...args).filter((a) => !isPanel(a));
const NAME = 'Studies Admin';
const ROLE = { name: NAME, storedId: 'r1' as string | null };

const emptyGuild = (over: Partial<GuildSnapshot> = {}): GuildSnapshot => ({
  categories: [],
  forums: [],
  roles: [],
  callerId: 'u1',
  callerRoleIds: [],
  unreadableForums: [],
  textChannels: [],
  panelChannels: { panel: null, admin: null },
  panelMessages: { panel: null, admin: null },
  ...over,
});
const withRole = (over: Partial<GuildSnapshot> = {}) =>
  emptyGuild({
    roles: [{ id: 'r1', name: NAME }],
    callerRoleIds: ['r1'],
    categories: [{ id: 'c3', name: 'Semestr 3' }],
    ...over,
  });

describe('forumSlug', () => {
  it('builds a lowercase code-name slug', () => {
    expect(forumSlug('ASD', 'Algorytmy i struktury danych')).toBe(
      'asd-algorytmy-i-struktury-danych',
    );
  });
  it('strips diacritics and caps the length at 100', () => {
    const s = forumSlug('JA', `Język angielski — ćwiczenia ${'x'.repeat(200)}`);
    expect(s.length).toBeLessThanOrEqual(100);
    expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(s.startsWith('ja-jezyk-angielski-cwiczenia')).toBe(true);
  });
});

describe('desiredTags', () => {
  it('lists class tags, groups up to the max, then fixed and event tags', () => {
    expect(desiredTags(ASD)).toEqual([
      'Wykład',
      'Laboratorium',
      'Gr. 1',
      'Gr. 2',
      'Gr. 3',
      'Kolokwium',
      'Egzamin',
      'Wyjazd',
      'Zajęcia dodatkowe',
      'Inne',
    ]);
  });
  it('has only fixed tags for a subject without classes', () => {
    expect(desiredTags({ ...ASD, classes: [] })).toEqual([
      'Kolokwium',
      'Egzamin',
      'Wyjazd',
      'Zajęcia dodatkowe',
      'Inne',
    ]);
  });
  it('generates tags that classify back to the same class and group', () => {
    for (const kind of CLASS_KINDS) {
      for (let n = 1; n <= 12; n++) {
        expect(classifyTags([CLASS_NAMES[kind], groupName(n)])).toEqual({
          classKind: kind,
          groupNumber: n,
        });
      }
    }
  });
});

describe('planSetup', () => {
  it('builds everything on an empty guild', () => {
    const actions = planSetup([ASD], emptyGuild(), ROLE, render);
    expect(actions).toEqual<Action[]>([
      { type: 'createRole', name: NAME },
      { type: 'assignRole', roleName: NAME, roleId: null, userId: 'u1' },
      { type: 'createCategory', name: 'Semestr 3' },
      {
        type: 'createForum',
        subjectId: 1,
        code: 'ASD',
        name: 'asd-algorytmy-i-struktury-danych',
        categoryName: 'Semestr 3',
        tags: desiredTags(ASD),
        topic: 'G:ASD',
      },
    ]);
  });

  it('skips role and category actions when they exist', () => {
    const actions = planSetup([ASD], withRole(), ROLE, render);
    expect(actions.map((a) => a.type)).toEqual(['createForum']);
  });

  it('assigns an existing role the caller lacks', () => {
    const actions = planSetup(
      [],
      withRole({ callerRoleIds: [] }),
      ROLE,
      render,
    );
    expect(actions).toEqual([
      { type: 'assignRole', roleName: NAME, roleId: 'r1', userId: 'u1' },
    ]);
  });

  it('uses the stored role id even when another role has the same name', () => {
    const g = withRole({
      roles: [
        { id: 'fake', name: NAME },
        { id: 'r1', name: 'Renamed' },
      ],
    });
    expect(planSetup([], g, ROLE, render)).toEqual([]);
  });

  it('adopts the only role with that name when nothing usable is stored', () => {
    for (const storedId of [null, 'gone']) {
      const g = withRole({ roles: [{ id: 'r7', name: NAME }] });
      expect(planSetup([], g, { name: NAME, storedId }, render)).toEqual([
        { type: 'adoptRole', roleId: 'r7', name: NAME },
        { type: 'assignRole', roleName: NAME, roleId: 'r7', userId: 'u1' },
      ]);
    }
  });

  it('adopts without assigning when the caller already has the role', () => {
    const g = withRole({
      roles: [{ id: 'r7', name: NAME }],
      callerRoleIds: ['r7'],
    });
    expect(planSetup([], g, { name: NAME, storedId: null }, render)).toEqual([
      { type: 'adoptRole', roleId: 'r7', name: NAME },
    ]);
  });

  it('creates the role when the stored one is gone and none has the name', () => {
    const g = withRole({ roles: [{ id: 'x', name: 'Other' }] });
    expect(planSetup([], g, ROLE, render)).toEqual([
      { type: 'createRole', name: NAME },
      { type: 'assignRole', roleName: NAME, roleId: null, userId: 'u1' },
    ]);
  });

  it('warns and neither adopts nor assigns when the name is ambiguous', () => {
    const g = withRole({
      roles: [
        { id: 'a', name: NAME },
        { id: 'b', name: NAME },
      ],
      callerRoleIds: [],
    });
    const actions = planSetup([], g, { name: NAME, storedId: null }, render);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'warn', code: null });
    expect(actions[0].type === 'warn' && actions[0].message).toContain(NAME);
  });

  it('adds only missing tags (ignoring case and diacritics) and updates guidelines', () => {
    const g = withRole({
      forums: [
        {
          id: 'f-bd',
          name: 'bd',
          parentId: null,
          tags: [{ id: '1', name: 'wyklad' }],
          topic: 'old',
        },
      ],
    });
    expect(planSetup([BD], g, ROLE, render)).toEqual([
      {
        type: 'addTags',
        subjectId: 2,
        code: 'BD',
        channelId: 'f-bd',
        tags: ['Kolokwium', 'Egzamin', 'Wyjazd', 'Zajęcia dodatkowe', 'Inne'],
      },
      {
        type: 'setGuidelines',
        subjectId: 2,
        code: 'BD',
        channelId: 'f-bd',
        topic: 'G:BD',
      },
    ]);
  });

  it('warns and skips a linked subject whose channel is missing', () => {
    const actions = planSetup([BD], withRole(), ROLE, render);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'warn', code: 'BD' });
  });

  it('never exceeds 20 tags on an existing forum', () => {
    const tags = Array.from({ length: 18 }, (_, i) => ({
      id: `t${i}`,
      name: `Inny ${i}`,
    }));
    const g = withRole({
      forums: [{ id: 'f-bd', name: 'bd', parentId: null, tags, topic: 'G:BD' }],
    });
    const actions = planSetup([BD], g, ROLE, render);
    const add = actions.find((a) => a.type === 'addTags');
    expect(add?.type === 'addTags' && add.tags).toEqual([
      'Wykład',
      'Kolokwium',
    ]);
    const warn = actions.find((a) => a.type === 'warn');
    expect(warn?.type === 'warn' && warn.message).toContain('Egzamin');
  });

  it('caps a new forum at 20 tags and warns', () => {
    const big = {
      ...ASD,
      classes: [
        cls(
          'laboratorium',
          Array.from({ length: 22 }, (_, i) => i + 1),
        ),
      ],
    };
    const actions = planSetup([big], withRole(), ROLE, render);
    const forum = actions.find((a) => a.type === 'createForum');
    expect(forum?.type === 'createForum' && forum.tags.length).toBe(20);
    expect(actions.some((a) => a.type === 'warn')).toBe(true);
  });

  it('creates each category once and orders subjects by semester then code', () => {
    const s1 = { ...ASD, id: 9, code: 'ZZ', semester: 1 };
    const actions = planSetup(
      [ASD, s1, { ...ASD, id: 8, code: 'AA', semester: 1 }],
      withRole({ categories: [] }),
      ROLE,
      render,
    );
    expect(
      actions.map((a) =>
        a.type === 'createCategory'
          ? a.name
          : a.type === 'createForum'
            ? a.code
            : a.type,
      ),
    ).toEqual(['Semestr 1', 'AA', 'ZZ', 'Semestr 3', 'ASD']);
  });

  it('is a no-op once everything exists', () => {
    const linked = { ...ASD, channelId: 'f-asd' };
    const g = withRole({
      forums: [
        {
          id: 'f-asd',
          name: 'asd-algorytmy-i-struktury-danych',
          parentId: 'c3',
          tags: desiredTags(ASD).map((name, i) => ({ id: `t${i}`, name })),
          topic: 'G:ASD',
        },
      ],
    });
    expect(planSetup([linked], g, ROLE, render)).toEqual([]);
  });
});

describe('parseForumName', () => {
  it('splits code and name at the first dash', () => {
    expect(parseForumName('asd-algorytmy-i-struktury')).toEqual({
      code: 'ASD',
      name: 'Algorytmy i struktury',
    });
  });
  it('uses the whole name as the code when there is no dash', () => {
    expect(parseForumName('fizyka')).toEqual({
      code: 'FIZYKA',
      name: 'Fizyka',
    });
  });
  it('strips diacritics and non-alphanumerics from the code, max 20 chars', () => {
    expect(parseForumName('ćwiczenia_ogólne-x')?.code).toBe('CWICZENIAOGOLNE');
    expect(parseForumName('a'.repeat(30))?.code).toBe('A'.repeat(20));
  });
  it('returns null when no code can be derived', () => {
    expect(parseForumName('🔥-ogień')).toBeNull();
  });
});

describe('planSetup: Discord → DB', () => {
  const unlinkedForum = (
    over: Partial<GuildSnapshot['forums'][number]> = {},
  ) => ({
    id: 'f-new',
    name: 'fiz-fizyka',
    parentId: null,
    tags: [],
    topic: null,
    ...over,
  });

  it('imports an unlinked forum as a subject (semester 1 without a category)', () => {
    const g = withRole({
      forums: [
        unlinkedForum({
          tags: [
            { id: 't1', name: 'Laboratorium' },
            { id: 't2', name: 'Gr. 4' },
            { id: 't3', name: 'lab' },
            { id: 't4', name: 'Wykład' },
          ],
        }),
      ],
    });
    expect(planSetup([], g, ROLE, render)).toEqual([
      {
        type: 'importForum',
        channelId: 'f-new',
        forumName: 'fiz-fizyka',
        code: 'FIZ',
        name: 'Fizyka',
        semester: 1,
        tags: [
          { id: 't1', name: 'Laboratorium' },
          { id: 't2', name: 'Gr. 4' },
          { id: 't3', name: 'lab' },
          { id: 't4', name: 'Wykład' },
        ],
        classKinds: ['wyklad', 'laboratorium'],
      },
    ]);
  });

  it('takes the semester from a Semestr N parent category', () => {
    const g = withRole({ forums: [unlinkedForum({ parentId: 'c3' })] });
    const [a] = planSetup([], g, ROLE, render);
    expect(a).toMatchObject({ type: 'importForum', semester: 3 });
  });

  it('skips with a warning when the code clashes with the DB or another forum', () => {
    const g = withRole({
      forums: [
        unlinkedForum({ id: 'f1', name: 'asd-inne' }),
        unlinkedForum({ id: 'f2', name: 'nowy-a' }),
        unlinkedForum({ id: 'f3', name: 'nowy-b' }),
      ],
    });
    const actions = planSetup([ASD], g, ROLE, render).filter(
      (a) => a.type !== 'createForum' && a.type !== 'createCategory',
    );
    expect(actions.map((a) => a.type)).toEqual(['warn', 'importForum', 'warn']);
    expect(actions[0]).toMatchObject({ code: 'ASD' });
    expect(actions[2]).toMatchObject({ code: 'NOWY' });
  });

  it('does not import a forum that is linked to a subject', () => {
    const linked = { ...ASD, channelId: 'f-asd' };
    const g = withRole({
      forums: [
        {
          id: 'f-asd',
          name: 'asd',
          parentId: 'c3',
          tags: desiredTags(ASD).map((name, i) => ({ id: `t${i}`, name })),
          topic: 'G:ASD',
        },
      ],
    });
    expect(planSetup([linked], g, ROLE, render)).toEqual([]);
  });

  it('adds classes for class tags on a linked forum that the DB lacks', () => {
    const linked = { ...BD };
    const g = withRole({
      forums: [
        {
          id: 'f-bd',
          name: 'bd',
          parentId: null,
          tags: [
            ...desiredTags(BD).map((name, i) => ({ id: `t${i}`, name })),
            { id: 'x1', name: 'Seminarium' },
            { id: 'x2', name: 'Gr. 2' },
          ],
          topic: 'G:BD',
        },
      ],
    });
    expect(planSetup([linked], g, ROLE, render)).toEqual([
      { type: 'addClasses', subjectId: 2, code: 'BD', kinds: ['seminarium'] },
    ]);
  });
});

describe('planSetup: posts', () => {
  const W = 'https://w.example';
  const MiB = 1024 * 1024;
  const forumTags = [
    'Laboratorium',
    'Gr. 1',
    'Kolokwium',
    'Egzamin',
    'Notatki',
    'Zadania',
    'Inne',
  ].map((name, i) => ({ id: `t${i}`, name }));
  const topic = (
    over: Partial<NonNullable<SubjectSpec['topics']>[number]> = {},
  ) => ({
    id: 11,
    title: 'Lab 1',
    threadId: 'seed-thread-1',
    classKind: 'laboratorium' as const,
    group: 1,
    tagNames: ['kolokwium', 'Notatki', 'Zadania', 'Inne', 'Brak'],
    authorName: 'Ola',
    createdAt: new Date('2026-10-05T10:00:00Z'),
    materials: [] as MaterialSpec[],
    ...over,
  });
  const subject = (
    topics: NonNullable<SubjectSpec['topics']>,
  ): SubjectSpec => ({
    ...ASD,
    channelId: 'f-asd',
    classes: [],
    topics,
    sessions: [],
  });
  const guildWith = (
    over: Partial<GuildSnapshot['forums'][number]> = {},
  ): GuildSnapshot =>
    withRole({
      forums: [
        {
          id: 'f-asd',
          name: 'asd',
          parentId: 'c3',
          tags: [...forumTags],
          topic: 'G:ASD',
          threadIds: [],
          infoPost: null,
          ...over,
        },
      ],
    });
  const postsOf = (actions: Action[]) =>
    actions.filter((a) => a.type === 'postTopic');

  it('posts an unposted topic with mapped tags (max 5) and a header line', () => {
    const [p] = postsOf(
      planSetup([subject([topic()])], guildWith(), ROLE, render, {
        webBaseUrl: W,
      }),
    );
    expect(p).toMatchObject({
      type: 'postTopic',
      subjectId: 1,
      code: 'ASD',
      channelId: 'f-asd',
      topicId: 11,
      title: 'Lab 1',
      tagIds: ['t0', 't1', 't2', 't4', 't5'],
    });
    expect(p?.type === 'postTopic' && p.messages).toEqual([
      {
        content: 'Dodane przez Ola · 2026-10-05 (z bazy Studies DB)',
        files: [],
      },
    ]);
  });

  it('chunks files by 10 and links files over 10 MiB', () => {
    const files = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      filename: `f${i + 1}.pdf`,
      storagePath: `originals/${i + 1}.pdf`,
      sizeBytes: 100,
      discordMessageId: 'seed',
    }));
    files.push({
      id: 99,
      filename: 'big.pdf',
      storagePath: 'originals/big.pdf',
      sizeBytes: 11 * MiB,
      discordMessageId: 'seed',
    });
    const [p] = postsOf(
      planSetup(
        [subject([topic({ materials: files })])],
        guildWith(),
        ROLE,
        render,
        { webBaseUrl: W },
      ),
    );
    if (p?.type !== 'postTopic') throw new Error('no post');
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0].files.map((f) => f.materialId)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(p.messages[1].files).toEqual([
      {
        materialId: 11,
        name: 'f11.pdf',
        storagePath: 'originals/11.pdf',
        sizeBytes: 100,
      },
    ]);
    expect(p.messages[0].content).toContain(`${W}/files/99/original`);
    expect(p.messages[0].content).toContain('big.pdf');
  });

  it('keeps each message under 24 MiB of files', () => {
    const sizes = [9, 9, 9, 10, 1, 1, 5];
    const files = sizes.map((mb, i) => ({
      id: i + 1,
      filename: `f${i + 1}.pdf`,
      storagePath: `o/${i + 1}`,
      sizeBytes: Math.round(mb * MiB),
      discordMessageId: 'seed',
    }));
    const [p] = postsOf(
      planSetup(
        [subject([topic({ materials: files })])],
        guildWith(),
        ROLE,
        render,
        { webBaseUrl: W },
      ),
    );
    if (p?.type !== 'postTopic') throw new Error('no post');
    expect(p.messages.map((m) => m.files.map((f) => f.materialId))).toEqual([
      [1, 2],
      [3, 4, 5, 6],
      [7],
    ]);
    for (const m of p.messages) {
      const total = m.files.reduce((n, f) => n + f.sizeBytes, 0);
      expect(total).toBeLessThanOrEqual(24 * MiB);
    }
    expect(p.messages[0].content).toContain('Dodane przez');
    expect(p.messages[1].content).toBe('Pliki (cd.)');
  });

  it('posts a topic whose only file is too big, as a link', () => {
    const [p] = postsOf(
      planSetup(
        [
          subject([
            topic({
              materials: [
                {
                  id: 7,
                  filename: 'video.mp4',
                  storagePath: 'o/v',
                  sizeBytes: 50 * MiB,
                  discordMessageId: 'seed',
                },
              ],
            }),
          ]),
        ],
        guildWith(),
        ROLE,
        render,
        { webBaseUrl: W },
      ),
    );
    expect(p?.type === 'postTopic' && p.messages[0].files).toEqual([]);
    expect(p?.type === 'postTopic' && p.messages[0].content).toContain(
      `${W}/files/7/original`,
    );
  });

  it('posts two topics with the same title separately', () => {
    const posts = postsOf(
      planSetup(
        [subject([topic(), topic({ id: 12, threadId: 'seed-2' })])],
        guildWith(),
        ROLE,
        render,
        { webBaseUrl: W },
      ),
    );
    expect(posts.map((p) => p.type === 'postTopic' && p.topicId)).toEqual([
      11, 12,
    ]);
  });

  it('skips topics already on Discord, forums that are missing, and runs without opts', () => {
    const s = subject([topic({ threadId: 'real-1' })]);
    expect(
      postsOf(
        planSetup([s], guildWith({ threadIds: ['real-1'] }), ROLE, render, {
          webBaseUrl: W,
        }),
      ),
    ).toEqual([]);
    expect(
      postsOf(
        planSetup([subject([topic()])], withRole(), ROLE, render, {
          webBaseUrl: W,
        }),
      ),
    ).toEqual([]);
    expect(
      postsOf(planSetup([subject([topic()])], guildWith(), ROLE, render)),
    ).toEqual([]);
  });

  it('re-sends files missing from a bot-owned thread', () => {
    const MB = MiB;
    const m = (id: number, msg: string, size = 100): MaterialSpec => ({
      id,
      filename: `f${id}.pdf`,
      storagePath: `o/${id}`,
      sizeBytes: size,
      discordMessageId: msg,
    });
    const t = topic({
      threadId: 'th-1',
      materials: [
        m(1, 'th-1'),
        m(2, 'msg-gone'),
        m(3, 'seed-x', 20 * MB),
        m(4, 'msg-2'),
        m(5, 'seed-y', 9 * MB),
        m(6, 'seed-z', 9 * MB),
        m(7, 'seed-w', 9 * MB),
      ],
    });
    const actions = planSetup(
      [subject([t])],
      guildWith({
        threadIds: ['th-1'],
        botThreadMessageIds: { 'th-1': ['th-1', 'msg-2'] },
      }),
      ROLE,
      render,
      { webBaseUrl: W },
    );
    expect(postsOf(actions)).toEqual([]);
    const sends = actions.filter((a) => a.type === 'postFiles');
    expect(sends).toHaveLength(1);
    const [p] = sends;
    expect(p).toMatchObject({
      type: 'postFiles',
      subjectId: 1,
      code: 'ASD',
      topicId: 11,
      threadId: 'th-1',
      title: 'Lab 1',
    });
    if (p?.type !== 'postFiles') throw new Error('no postFiles');
    // The 20 MB file is linked in the starter, never re-sent.
    expect(p.messages.map((x) => x.files.map((f) => f.materialId))).toEqual([
      [2, 5, 6],
      [7],
    ]);
    expect(p.messages.every((x) => x.content === 'Pliki (cd.)')).toBe(true);
  });

  it('does not re-send files for threads it has no message list for', () => {
    const t = topic({
      threadId: 'th-1',
      materials: [
        {
          id: 1,
          filename: 'a.pdf',
          storagePath: 'o/a',
          sizeBytes: 1,
          discordMessageId: 'gone',
        },
      ],
    });
    const plan = (ids?: Record<string, string[]>) =>
      planSetup(
        [subject([t])],
        guildWith({ threadIds: ['th-1'], botThreadMessageIds: ids }),
        ROLE,
        render,
        { webBaseUrl: W },
      ).filter((a) => a.type === 'postFiles');
    expect(plan(undefined)).toEqual([]);
    expect(plan({ other: [] })).toEqual([]);
    expect(plan({ 'th-1': ['gone'] })).toEqual([]);
  });

  it('creates and pins, edits only changed content, never re-pins', () => {
    const s = subject([]);
    const plan = (g: GuildSnapshot) =>
      planSetup([s], g, ROLE, render, { webBaseUrl: W });
    const info = (g: GuildSnapshot) =>
      plan(g).filter((a) => a.type === 'upsertInfoPost');
    const [created] = info(guildWith());
    expect(created).toMatchObject({
      type: 'upsertInfoPost',
      subjectId: 1,
      code: 'ASD',
      channelId: 'f-asd',
      existing: null,
      pin: true,
    });
    const content = created?.type === 'upsertInfoPost' ? created.content : '';
    expect(content).toContain('**Algorytmy i struktury danych** (ASD)');
    const post = { threadId: 'i1', messageId: 'i1', content };
    // Up to date: nothing, whether or not it is pinned.
    expect(info(guildWith({ infoPost: post }))).toEqual([]);
    expect(
      info(guildWith({ infoPost: post, pinnedThreadId: 'other' })),
    ).toEqual([]);
    expect(info(guildWith({ infoPost: { ...post, content: 'old' } }))).toEqual([
      {
        type: 'upsertInfoPost',
        subjectId: 1,
        code: 'ASD',
        channelId: 'f-asd',
        content,
        existing: { threadId: 'i1', messageId: 'i1' },
        pin: false,
      },
    ]);
  });

  it('creates the info post unpinned with a warning when another post is pinned', () => {
    const actions = planSetup(
      [subject([])],
      guildWith({ pinnedThreadId: 'p1' }),
      ROLE,
      render,
      { webBaseUrl: W },
    );
    expect(actions.find((a) => a.type === 'upsertInfoPost')).toMatchObject({
      existing: null,
      pin: false,
    });
    const warn = actions.find((a) => a.type === 'warn');
    expect(warn).toMatchObject({ type: 'warn', code: 'ASD' });
    expect(warn?.type === 'warn' && warn.message).toContain('przypięty');
  });
});

describe('planSetup: unreadable forums', () => {
  const unreadable = { id: 'f-bd', name: 'bd-bazy' };
  it('warns once for a linked subject whose forum is unreadable and does nothing else', () => {
    const actions = planSetup(
      [{ ...BD, topics: [], sessions: [] }],
      withRole({ unreadableForums: [unreadable] }),
      ROLE,
      render,
      { webBaseUrl: 'https://w' },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'warn', code: 'BD' });
    const msg = actions[0].type === 'warn' ? actions[0].message : '';
    expect(msg).toContain('#bd-bazy');
    expect(msg).not.toContain('nie znaleziono');
  });

  it('warns about an unlinked unreadable forum and never imports it', () => {
    const actions = planSetup(
      [],
      withRole({
        unreadableForums: [{ id: 'f-x', name: 'fiz-fizyka' }],
      }),
      ROLE,
      render,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'warn', code: null });
    expect(actions[0].type === 'warn' && actions[0].message).toContain(
      '#fiz-fizyka',
    );
  });
});

describe('secondPassActions', () => {
  it('drops panel actions and warnings the first pass already reported', () => {
    const warn = (message: string): Action => ({
      type: 'warn',
      code: null,
      message,
    });
    const tags: Action = {
      type: 'addTags',
      subjectId: 1,
      code: 'ASD',
      channelId: 'f',
      tags: ['Gr. 1'],
    };
    const second: Action[] = [
      warn('dup'),
      warn('new'),
      {
        type: 'ensurePanelChannel',
        which: 'admin',
        name: 'admin-panel',
        existingId: null,
        parentId: null,
      },
      { type: 'syncAdminPanelPerms', channelId: 'ch-a', roleId: 'r' },
      {
        type: 'ensurePanelMessage',
        which: 'panel',
        channelId: 'c',
        messageId: 'm',
      },
      tags,
    ];
    expect(secondPassActions([warn('dup')], second)).toEqual([
      warn('new'),
      tags,
    ]);
  });
});

describe('needsSecondPass', () => {
  it('is true after a forum was created or imported, false otherwise', () => {
    const forum = planSetup([ASD], withRole(), ROLE, render);
    expect(needsSecondPass(forum)).toBe(true);
    expect(
      needsSecondPass([
        {
          type: 'importForum',
          channelId: 'f',
          forumName: 'x',
          code: 'X',
          name: 'X',
          semester: 1,
          tags: [],
          classKinds: [],
        },
      ]),
    ).toBe(true);
    expect(needsSecondPass([{ type: 'warn', code: null, message: 'm' }])).toBe(
      false,
    );
  });
});

describe('planSetup: panels', () => {
  const panelActions = (actions: Action[]) => actions.filter(isPanel);
  const newChannel = (which: 'panel' | 'admin', parentId: string | null) =>
    ({
      type: 'ensurePanelChannel',
      which,
      name: which === 'panel' ? 'panel' : 'admin-panel',
      existingId: null,
      parentId,
    }) as const;
  const message = (
    which: 'panel' | 'admin',
    channelId: string | null,
    messageId: string | null,
  ) => ({ type: 'ensurePanelMessage', which, channelId, messageId }) as const;

  it('creates both channels and posts both panels on an empty guild, after the role actions', () => {
    const actions = planWithPanels([], emptyGuild(), ROLE, render);
    expect(actions).toEqual<Action[]>([
      { type: 'createRole', name: NAME },
      { type: 'assignRole', roleName: NAME, roleId: null, userId: 'u1' },
      newChannel('panel', null),
      newChannel('admin', null),
      message('panel', null, null),
      message('admin', null, null),
    ]);
  });

  it('only edits the stored messages when both channels exist', () => {
    const g = withRole({
      textChannels: [
        {
          id: 'ch-p',
          name: 'panel',
          parentId: null,
          everyoneCanView: true,
          viewRoleIds: [],
        },
        {
          id: 'ch-a',
          name: 'admin-panel',
          parentId: null,
          everyoneCanView: true,
          viewRoleIds: ['r1'],
        },
      ],
      panelChannels: { panel: 'ch-p', admin: 'ch-a' },
      panelMessages: { panel: 'm-p', admin: 'm-a' },
    });
    expect(planWithPanels([], g, ROLE, render)).toEqual<Action[]>([
      message('panel', 'ch-p', 'm-p'),
      message('admin', 'ch-a', 'm-a'),
    ]);
  });

  it('recreates a stored channel that is gone and posts a new message there', () => {
    const g = withRole({
      textChannels: [
        {
          id: 'ch-a',
          name: 'admin-panel',
          parentId: null,
          everyoneCanView: false,
          viewRoleIds: ['r1'],
        },
      ],
      panelChannels: { panel: 'ch-gone', admin: 'ch-a' },
      panelMessages: { panel: 'm-p', admin: 'm-a' },
    });
    expect(panelActions(planWithPanels([], g, ROLE, render))).toEqual<Action[]>(
      [
        newChannel('panel', null),
        message('panel', null, null),
        message('admin', 'ch-a', 'm-a'),
      ],
    );
  });

  it('adopts the only text channel with the name when nothing usable is stored', () => {
    const g = withRole({
      textChannels: [
        {
          id: 'x1',
          name: 'panel',
          parentId: null,
          everyoneCanView: true,
          viewRoleIds: [],
        },
        {
          id: 'x2',
          name: 'admin-panel',
          parentId: null,
          everyoneCanView: false,
          viewRoleIds: ['r1'],
        },
      ],
    });
    expect(panelActions(planWithPanels([], g, ROLE, render))).toEqual<Action[]>(
      [
        { ...newChannel('panel', null), existingId: 'x1' },
        { ...newChannel('admin', null), existingId: 'x2' },
        message('panel', null, null),
        message('admin', null, null),
      ],
    );
  });

  it('warns and creates nothing when several text channels share the name', () => {
    const g = withRole({
      textChannels: [
        {
          id: 'x1',
          name: 'panel',
          parentId: null,
          everyoneCanView: true,
          viewRoleIds: [],
        },
        {
          id: 'x2',
          name: 'admin-panel',
          parentId: null,
          everyoneCanView: false,
          viewRoleIds: ['r1'],
        },
        {
          id: 'x3',
          name: 'admin-panel',
          parentId: null,
          everyoneCanView: false,
          viewRoleIds: ['r1'],
        },
      ],
    });
    expect(panelActions(planWithPanels([], g, ROLE, render))).toEqual<Action[]>(
      [
        { ...newChannel('panel', null), existingId: 'x1' },
        {
          type: 'warn',
          code: null,
          message:
            'jest kilka kanałów tekstowych o nazwie #admin-panel — panel nie został utworzony; zostaw jeden (albo zmień nazwy pozostałych) i uruchom /setup ponownie',
        },
        message('panel', null, null),
      ],
    );
  });

  const adminChannel = (viewRoleIds: string[]) =>
    ({
      id: 'ch-a',
      name: 'admin-panel',
      parentId: null,
      everyoneCanView: false,
      viewRoleIds,
    }) as const;

  it('re-grants the stored #admin-panel to a role that replaced a deleted one', () => {
    // The stored role r-old is gone; the only role with the name is adopted.
    const adopted = withRole({
      roles: [{ id: 'r2', name: NAME }],
      callerRoleIds: ['r2'],
      textChannels: [adminChannel(['r-old'])],
      panelChannels: { panel: null, admin: 'ch-a' },
      panelMessages: { panel: null, admin: 'm-a' },
    });
    const role = { name: NAME, storedId: 'r-old' };
    expect(
      planWithPanels([], adopted, role, render).filter(
        (a) => a.type === 'syncAdminPanelPerms',
      ),
    ).toEqual([
      { type: 'syncAdminPanelPerms', channelId: 'ch-a', roleId: 'r2' },
    ]);
    // No role with the name either: the role created in this run (null).
    const created = { ...adopted, roles: [], callerRoleIds: [] };
    const actions = planWithPanels([], created, role, render);
    expect(actions.map((a) => a.type)).toEqual([
      'createRole',
      'assignRole',
      'ensurePanelChannel',
      'syncAdminPanelPerms',
      'ensurePanelMessage',
      'ensurePanelMessage',
    ]);
    expect(actions[3]).toEqual({
      type: 'syncAdminPanelPerms',
      channelId: 'ch-a',
      roleId: null,
    });
  });

  it('grants an adopted #admin-panel without the admin role overwrite', () => {
    const g = withRole({
      textChannels: [{ ...adminChannel([]), id: 'x2' }],
    });
    expect(
      planWithPanels([], g, ROLE, render).filter(
        (a) => a.type === 'syncAdminPanelPerms',
      ),
    ).toEqual([{ type: 'syncAdminPanelPerms', channelId: 'x2', roleId: 'r1' }]);
  });

  it('leaves #admin-panel permissions alone when the role is ambiguous', () => {
    const g = emptyGuild({
      roles: [
        { id: 'a', name: NAME },
        { id: 'b', name: NAME },
      ],
      textChannels: [adminChannel([])],
      panelChannels: { panel: null, admin: 'ch-a' },
    });
    const actions = planWithPanels(
      [],
      g,
      { name: NAME, storedId: null },
      render,
    );
    expect(actions.some((a) => a.type === 'syncAdminPanelPerms')).toBe(false);
  });

  it("puts new channels in the first subject's forum category", () => {
    const linked = { ...ASD, channelId: 'f-asd' };
    const g = withRole({
      forums: [
        {
          id: 'f-asd',
          name: 'asd',
          parentId: 'c3',
          tags: [],
          topic: null,
        },
      ],
    });
    const channels = planWithPanels([BD, linked], g, ROLE, render).filter(
      (a) => a.type === 'ensurePanelChannel',
    );
    expect(channels.map((a) => a.parentId)).toEqual(['c3', 'c3']);
  });
});

describe('renderEventsInfoPost', () => {
  it('links the new-event page and the plan', () => {
    const t = renderEventsInfoPost('https://x.pl');
    expect(t).toContain('Dodaj wydarzenie: https://x.pl/s/wydarzenia/nowe');
    expect(t).toContain('Plan zajęć: https://x.pl/s/plan');
    expect(t).not.toMatch(/s\/wydarzenia(\s|$)/);
  });
});

describe('planSetup: #wydarzenia', () => {
  const only = (actions: Action[]) => actions.filter(isEvents);
  const KINDS = ['Kolokwium', 'Egzamin', 'Wyjazd', 'Zajęcia dodatkowe', 'Inne'];
  const eventsForum = (
    over: Partial<GuildSnapshot['forums'][number]> = {},
  ) => ({
    id: 'f-ev',
    name: 'wydarzenia',
    parentId: 'c3',
    tags: KINDS.map((name) => ({ id: `t-${name}`, name })),
    topic: null,
    ...over,
  });
  const opts = { webBaseUrl: 'https://x.pl' };

  it('creates the forum with the five kind tags in the first subject category', () => {
    const g = withRole({
      forums: [
        { id: 'f-bd', name: 'bd', parentId: 'c3', tags: [], topic: null },
      ],
    });
    expect(only(planAll([BD], g, ROLE, render, opts))).toEqual([
      expect.objectContaining({
        type: 'ensureEventsForum',
        code: '#wydarzenia',
        name: 'wydarzenia',
        existingId: null,
        parentId: 'c3',
        tags: KINDS,
      }),
    ]);
    expect(needsSecondPass(only(planAll([BD], g, ROLE, render, opts)))).toBe(
      true,
    );
  });

  it('adopts the only forum with that name and adds missing tags and the info post', () => {
    const g = withRole({
      forums: [eventsForum({ tags: [{ id: 't1', name: 'kolokwium' }] })],
    });
    const actions = only(planAll([], g, ROLE, render, opts));
    expect(actions.map((a) => a.type)).toEqual([
      'ensureEventsForum',
      'addEventsTags',
      'upsertEventsInfoPost',
    ]);
    expect(actions[0]).toMatchObject({ existingId: 'f-ev' });
    expect(actions[1]).toMatchObject({
      tags: ['Egzamin', 'Wyjazd', 'Zajęcia dodatkowe', 'Inne'],
    });
    expect(actions[2]).toMatchObject({ existing: null, pin: true });
    expect(needsSecondPass(actions)).toBe(false);
  });

  it('is a no-op once forum, tags and info post exist (idempotent)', () => {
    const content = renderEventsInfoPost(opts.webBaseUrl);
    const g = withRole({
      eventsForumId: 'f-ev',
      forums: [
        eventsForum({
          infoPost: { threadId: 'th', messageId: 'th', content },
          pinnedThreadId: 'th',
        }),
      ],
    });
    expect(only(planAll([], g, ROLE, render, opts))).toEqual([]);
  });

  it('edits a stale info post and never unpins another pinned post', () => {
    const stale = withRole({
      eventsForumId: 'f-ev',
      forums: [
        eventsForum({
          infoPost: { threadId: 'th', messageId: 'th', content: 'old' },
        }),
      ],
    });
    expect(only(planAll([], stale, ROLE, render, opts))).toEqual([
      expect.objectContaining({
        type: 'upsertEventsInfoPost',
        existing: { threadId: 'th', messageId: 'th' },
        pin: false,
      }),
    ]);
    const pinned = withRole({
      eventsForumId: 'f-ev',
      forums: [eventsForum({ pinnedThreadId: 'other' })],
    });
    const out = only(planAll([], pinned, ROLE, render, opts));
    expect(out[0]).toMatchObject({ existing: null, pin: false });
    expect(out[1]).toMatchObject({ type: 'warn' });
  });

  it('warns when the forum is full and does not import it as a subject', () => {
    const full = Array.from({ length: 20 }, (_, i) => ({
      id: `x${i}`,
      name: `x${i}`,
    }));
    const g = withRole({
      eventsForumId: 'f-ev',
      forums: [eventsForum({ tags: full })],
    });
    const all = planAll([], g, ROLE, render);
    expect(all.some((a) => a.type === 'importForum')).toBe(false);
    expect(only(all)).toEqual([
      expect.objectContaining({
        type: 'warn',
        code: '#wydarzenia',
        message: expect.stringContaining('limit 20'),
      }),
    ]);
  });

  it('warns and picks none when several forums are named wydarzenia', () => {
    const g = withRole({
      forums: [eventsForum(), eventsForum({ id: 'f-ev2' })],
    });
    const all = planAll([], g, ROLE, render);
    expect(only(all)).toHaveLength(1);
    expect(all.some((a) => a.type === 'importForum')).toBe(false);
  });
});
