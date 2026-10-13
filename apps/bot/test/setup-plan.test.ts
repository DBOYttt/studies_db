import { CLASS_KINDS, CLASS_NAMES, classifyTags, groupName } from '@studies/db';
import { describe, expect, it } from 'vitest';
import {
  desiredTags,
  forumSlug,
  parseForumName,
  planSetup,
} from '../src/setup/plan.js';
import type {
  Action,
  ClassSpec,
  GuildSnapshot,
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
const ROLE = 'Studies Admin';

const emptyGuild = (over: Partial<GuildSnapshot> = {}): GuildSnapshot => ({
  categories: [],
  forums: [],
  roles: [],
  callerId: 'u1',
  callerRoleIds: [],
  ...over,
});
const withRole = (over: Partial<GuildSnapshot> = {}) =>
  emptyGuild({
    roles: [{ id: 'r1', name: ROLE }],
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
  it('lists class tags, groups up to the max, then fixed tags', () => {
    expect(desiredTags(ASD)).toEqual([
      'Wykład',
      'Laboratorium',
      'Gr. 1',
      'Gr. 2',
      'Gr. 3',
      'Kolokwium',
      'Egzamin',
    ]);
  });
  it('has only fixed tags for a subject without classes', () => {
    expect(desiredTags({ ...ASD, classes: [] })).toEqual([
      'Kolokwium',
      'Egzamin',
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
      { type: 'createRole', name: ROLE },
      { type: 'assignRole', roleName: ROLE, userId: 'u1' },
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
      { type: 'assignRole', roleName: ROLE, userId: 'u1' },
    ]);
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
        tags: ['Kolokwium', 'Egzamin'],
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
