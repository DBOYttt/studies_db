import type { MyGroupOption, PlanSession } from '@studies/db';
import { ButtonStyle, MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { MAX_COMPONENTS, MAX_OPTIONS, MAX_TEXT } from '../src/ui/limits.js';
import { ephemeral } from '../src/ui/respond.js';
import {
  groupsView,
  notice,
  planDay,
  planWeek,
  studentPanel,
  type View,
} from '../src/ui/views/student.js';

// biome-ignore lint/suspicious/noExplicitAny: walking raw component JSON
type Json = any;

const WEB = 'https://studies.example';

function nodes(view: View): Json[] {
  const out: Json[] = [];
  const walk = (c: Json) => {
    out.push(c);
    for (const child of c.components ?? []) walk(child);
    if (c.accessory) walk(c.accessory);
  };
  for (const c of view.components) walk(c.toJSON());
  return out;
}
const texts = (v: View) =>
  nodes(v)
    .filter((n) => typeof n.content === 'string')
    .map((n) => n.content as string);
const allText = (v: View) => texts(v).join('\n');
const customIds = (v: View) =>
  nodes(v)
    .map((n) => n.custom_id)
    .filter((id): id is string => typeof id === 'string');
const buttons = (v: View) => nodes(v).filter((n) => n.type === 2);
const selects = (v: View) => nodes(v).filter((n) => n.type === 3);

function expectValid(v: View) {
  expect(v.flags).toBe(MessageFlags.IsComponentsV2);
  expect(nodes(v).length).toBeLessThanOrEqual(MAX_COMPONENTS);
  for (const id of customIds(v)) expect(id.length).toBeLessThanOrEqual(100);
  expect(new Set(customIds(v)).size).toBe(customIds(v).length);
  expect(allText(v).length).toBeLessThanOrEqual(MAX_TEXT);
  for (const n of nodes(v)) {
    if (n.type === 1) expect(n.components.length).toBeLessThanOrEqual(5);
    if (n.type === 3) {
      expect(n.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
      for (const o of n.options) {
        expect(o.value.length).toBeLessThanOrEqual(100);
        expect(o.label.length).toBeLessThanOrEqual(100);
      }
    }
  }
}

const wall = (iso: string) => new Date(`${iso}Z`);
let nextId = 1;
function session(
  start: string,
  end: string,
  over: Partial<PlanSession> = {},
): PlanSession {
  return {
    type: 'class',
    id: nextId++,
    startsAt: wall(start),
    endsAt: wall(end),
    subjectId: 1,
    subjectName: 'Analiza matematyczna',
    subjectCode: 'AM1',
    classId: 10,
    classKind: 'laboratorium',
    className: 'Laboratorium',
    groupId: 100,
    groupName: 'Gr. 2',
    lecturerId: 5,
    lecturerName: 'dr Anna Nowak',
    room: 'C-13 1.23',
    label: '',
    status: 'confirmed',
    ...over,
  };
}

describe('studentPanel', () => {
  it('offers the five student actions', () => {
    const v = studentPanel();
    expectValid(v);
    const b = buttons(v);
    expect(b.map((x) => [x.custom_id, x.label])).toEqual([
      ['v1:stu:plan:day', 'Timetable today'],
      ['v1:stu:plan:week', 'This week'],
      ['v1:stu:groups:open', 'My groups'],
      ['v1:stu:login', 'Log in to the website'],
      ['v1:evt:new', 'Add event'],
    ]);
    expect(allText(v)).toContain('Studies DB');
  });
});

describe('planDay', () => {
  const day = wall('2026-10-14T00:00:00');

  it('lists only the given day, in order, with the line format', () => {
    const v = planDay(
      [
        session('2026-10-14T12:15:00', '2026-10-14T13:45:00', {
          subjectCode: 'PO',
          subjectName: 'Programowanie obiektowe',
          className: 'Wykład',
          groupName: null,
          groupId: null,
          room: null,
        }),
        session('2026-10-14T08:00:00', '2026-10-14T09:30:00'),
        session('2026-10-13T08:00:00', '2026-10-13T09:30:00', {
          subjectName: 'Wczoraj',
        }),
        session('2026-10-15T08:00:00', '2026-10-15T09:30:00', {
          subjectName: 'Jutro',
        }),
      ],
      day,
      true,
      WEB,
    );
    expectValid(v);
    const text = allText(v);
    expect(text).toContain('Timetable — Wed 14 Oct');
    expect(text).not.toContain('Wczoraj');
    expect(text).not.toContain('Jutro');
    const first =
      '08:00–09:30 · AM1 Analiza matematyczna · Laboratorium · Gr. 2 · C-13 1.23 · dr Anna Nowak';
    const second =
      '12:15–13:45 · PO Programowanie obiektowe · Wykład · dr Anna Nowak';
    expect(text).toContain(first);
    expect(text).toContain(second);
    expect(text.indexOf(first)).toBeLessThan(text.indexOf(second));
    expect(text).not.toContain('Set My groups');
  });

  it('strikes through cancelled sessions', () => {
    const v = planDay(
      [
        session('2026-10-14T08:00:00', '2026-10-14T09:30:00', {
          status: 'cancelled',
        }),
      ],
      day,
      true,
      WEB,
    );
    expect(allText(v)).toMatch(/~~08:00–09:30 · AM1 .*~~ \(cancelled\)/);
  });

  it('navigates by day and links to the web week', () => {
    const v = planDay([], day, true, WEB);
    const ids = customIds(v);
    expect(ids).toEqual(
      expect.arrayContaining([
        'v1:stu:plan:day:2026-10-13',
        'v1:stu:plan:day',
        'v1:stu:plan:day:2026-10-15',
        'v1:stu:plan:week:2026-W42',
      ]),
    );
    const labels = buttons(v).map((b) => b.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Today', 'Week', 'Open on the website']),
    );
    const link = buttons(v).find((b) => b.url);
    expect(link.url).toBe(`${WEB}/s/plan?week=2026-W42`);
  });

  it('shows "No classes" for an empty day', () => {
    const v = planDay([], day, true, WEB);
    expectValid(v);
    expect(allText(v)).toContain('No classes');
  });

  it('shows the hint without saved groups', () => {
    const v = planDay([], day, false, WEB);
    expect(allText(v)).toContain('Set My groups to see only your classes');
  });

  it('stops at the limits and says how many are left', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      session('2026-10-14T08:00:00', '2026-10-14T09:30:00', {
        subjectName: `Przedmiot ${i} ${'x'.repeat(60)}`,
      }),
    );
    for (const hasGroups of [true, false]) {
      const v = planDay(many, day, hasGroups, WEB);
      expectValid(v);
      const text = allText(v);
      const m = /…and (\d+) more\. Open the website/.exec(text);
      expect(m).not.toBeNull();
      const shown = (text.match(/Przedmiot \d+/g) ?? []).length;
      expect(shown + Number(m?.[1])).toBe(60);
    }
  });

  it('keeps every short day under the component limit', () => {
    for (let n = 0; n <= 40; n++) {
      const list = Array.from({ length: n }, () =>
        session('2026-10-14T08:00:00', '2026-10-14T09:30:00'),
      );
      expectValid(planDay(list, day, n % 2 === 0, WEB));
    }
  });

  it('keeps wall times across the DST change (Review Focus 2)', () => {
    const list = ['2026-10-24', '2026-10-25', '2026-10-26'].map((d) =>
      session(`${d}T08:00:00`, `${d}T09:30:00`, { subjectName: `Dzień ${d}` }),
    );
    for (const d of ['2026-10-24', '2026-10-25', '2026-10-26']) {
      const text = allText(planDay(list, wall(`${d}T00:00:00`), true, WEB));
      expect(text).toContain(`08:00–09:30 · AM1 Dzień ${d}`);
      expect((text.match(/Dzień 2026/g) ?? []).length).toBe(1);
    }
  });
});

describe('planWeek', () => {
  const week = { year: 2026, week: 42 }; // 12.10–18.10

  it('groups sessions by weekday', () => {
    const v = planWeek(
      [
        session('2026-10-12T10:00:00', '2026-10-12T11:30:00', {
          subjectName: 'Poniedziałkowy',
        }),
        session('2026-10-14T08:00:00', '2026-10-14T09:30:00', {
          subjectName: 'Środowy A',
        }),
        session('2026-10-14T12:00:00', '2026-10-14T13:30:00', {
          subjectName: 'Środowy B',
        }),
      ],
      week,
      true,
      WEB,
    );
    expectValid(v);
    const text = allText(v);
    expect(text).toContain('Timetable — week 12 Oct – 18 Oct');
    const mon = text.indexOf('Mon 12 Oct');
    const wed = text.indexOf('Wed 14 Oct');
    expect(mon).toBeGreaterThanOrEqual(0);
    expect(wed).toBeGreaterThan(text.indexOf('Poniedziałkowy'));
    expect(text.indexOf('Środowy A')).toBeGreaterThan(wed);
    expect(text.indexOf('Środowy B')).toBeGreaterThan(
      text.indexOf('Środowy A'),
    );
    // The day block holds both Wednesday sessions together.
    const wedBlock = texts(v).find((t) => t.includes('Wed 14 Oct'));
    expect(wedBlock).toContain('Środowy A');
    expect(wedBlock).toContain('Środowy B');
  });

  it('navigates by week with short ids and links to the web', () => {
    const v = planWeek([], week, false, WEB);
    expectValid(v);
    expect(customIds(v)).toEqual(
      expect.arrayContaining([
        'v1:stu:plan:week:2026-W41',
        'v1:stu:plan:week:2026-W43',
      ]),
    );
    expect(buttons(v).map((b) => b.label)).toContain('Day');
    expect(buttons(v).find((b) => b.url).url).toBe(
      `${WEB}/s/plan?week=2026-W42`,
    );
    expect(allText(v)).toContain('No classes');
    expect(allText(v)).toContain('Set My groups');
  });

  it('"Day" opens today in the current week, else the Monday', () => {
    const dayId = (v: View) =>
      customIds(v).find((id) => id.startsWith('v1:stu:plan:day:'));
    const today = wall('2026-10-14T23:30:00');
    expect(dayId(planWeek([], week, true, WEB, today))).toBe(
      'v1:stu:plan:day:2026-10-14',
    );
    expect(dayId(planWeek([], week, true, WEB))).toBe(
      'v1:stu:plan:day:2026-10-12',
    );
    expect(
      dayId(planWeek([], { year: 2026, week: 43 }, true, WEB, today)),
    ).toBe('v1:stu:plan:day:2026-10-19');
  });

  it('stops at the text limit', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      session('2026-10-13T08:00:00', '2026-10-13T09:30:00', {
        subjectName: `Przedmiot ${i}`,
      }),
    );
    const v = planWeek(many, week, true, WEB);
    expectValid(v);
    const text = allText(v);
    const m = /…and (\d+) more\. Open the website/.exec(text);
    const shown = (text.match(/Przedmiot \d+/g) ?? []).length;
    expect(shown + Number(m?.[1])).toBe(200);
  });
});

describe('plan image', () => {
  const day = wall('2026-10-14T00:00:00');
  const week = { year: 2026, week: 42 };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const two = [
    session('2026-10-14T08:00:00', '2026-10-14T09:30:00'),
    session('2026-10-14T10:00:00', '2026-10-14T11:30:00'),
    session('2026-10-15T10:00:00', '2026-10-15T11:30:00'),
  ];
  const gallery = (v: View) => nodes(v).filter((n) => n.type === 12);

  it('day: the image replaces the text list, with a count line', () => {
    const v = planDay(two, day, true, WEB, png);
    expectValid(v);
    const [g] = gallery(v);
    expect(g.items.map((x: Json) => x.media.url)).toEqual([
      'attachment://plan-2026-10-14.png',
    ]);
    expect(v.files?.map((f) => [f.name, f.attachment])).toEqual([
      ['plan-2026-10-14.png', png],
    ]);
    const text = allText(v);
    expect(text).toContain('Timetable — Wed 14 Oct');
    expect(text).toContain('Classes: 2 · My groups: yes');
    expect(text).not.toContain('08:00–09:30');
    // Same navigation as the text view.
    expect(customIds(v)).toEqual(customIds(planDay(two, day, true, WEB)));
    expect(buttons(v).find((b) => b.url).url).toBe(
      `${WEB}/s/plan?week=2026-W42`,
    );
  });

  it('week: the image and the count, keeping the hint without groups', () => {
    const v = planWeek(two, week, false, WEB, undefined, png);
    expectValid(v);
    expect(gallery(v)[0].items[0].media.url).toBe(
      'attachment://plan-2026-W42.png',
    );
    expect(v.files?.map((f) => f.name)).toEqual(['plan-2026-W42.png']);
    const text = allText(v);
    expect(text).toContain('Classes: 3 · My groups: no');
    expect(text).toContain('Set My groups');
    expect(customIds(v)).toEqual(customIds(planWeek(two, week, false, WEB)));
  });

  it('shows the hidden-by-Moje-grupy note under the image and in the text', () => {
    const note = 'Hidden classes: 3. Fill in My groups';
    const withImg = planDay(two, day, true, WEB, png, 3);
    expectValid(withImg);
    expect(allText(withImg)).toContain(note);
    const textDay = planDay(two, day, true, WEB, null, 3);
    expectValid(textDay);
    expect(allText(textDay)).toContain(note);
    const emptyDay = planDay([], day, true, WEB, null, 3);
    expectValid(emptyDay);
    expect(allText(emptyDay)).toContain(note);
    for (const v of [
      planWeek(two, week, true, WEB, undefined, png, 3),
      planWeek(two, week, true, WEB, undefined, null, 3),
    ]) {
      expectValid(v);
      expect(allText(v)).toContain(note);
    }
    expect(allText(planDay(two, day, true, WEB, png))).not.toContain('Ukryte');
    expect(allText(planWeek(two, week, true, WEB))).not.toContain('Ukryte');
  });

  it('counts active sessions and names the cancelled ones apart', () => {
    const list = [
      ...two,
      session('2026-10-14T12:00:00', '2026-10-14T13:30:00', {
        status: 'cancelled',
      }),
    ];
    expect(allText(planDay(list, day, true, WEB, png))).toContain(
      'Classes: 2 (cancelled: 1) · My groups: yes',
    );
    expect(allText(planWeek(list, week, false, WEB, undefined, png))).toContain(
      'Classes: 3 (cancelled: 1) · My groups: no',
    );
    expect(allText(planDay(two, day, true, WEB, png))).not.toContain(
      'cancelled',
    );
  });

  it('describes every session in the alt text', () => {
    const list = [
      ...two,
      session('2026-10-14T12:00:00', '2026-10-14T13:30:00', {
        subjectCode: 'PO',
        className: 'Wykład',
        groupName: null,
        status: 'cancelled',
      }),
    ];
    const alt = (v: View) => gallery(v)[0].items[0].description as string;
    expect(alt(planDay(list, day, true, WEB, png))).toBe(
      'Timetable — Wed 14 Oct: 08:00–09:30 AM1 Laboratorium Gr. 2; ' +
        '10:00–11:30 AM1 Laboratorium Gr. 2; 12:00–13:30 PO Wykład (cancelled)',
    );
    expect(alt(planWeek(list, week, true, WEB, undefined, png))).toMatch(
      /^Timetable — week 12 Oct – 18 Oct: Wed 14 Oct 08:00–09:30 AM1 Laboratorium Gr\. 2; .*; Thu 15 Oct 10:00–11:30 AM1 Laboratorium Gr\. 2$/,
    );
  });

  it('clips the alt text to 1024 characters', () => {
    const many = Array.from({ length: 80 }, () =>
      session('2026-10-14T08:00:00', '2026-10-14T09:30:00'),
    );
    const a = gallery(planDay(many, day, true, WEB, png))[0].items[0]
      .description as string;
    expect(a).toHaveLength(1024);
    expect(a.endsWith('…')).toBe(true);
  });

  it("a fresh ephemeral reply carries the view's files", () => {
    const v = planDay(two, day, true, WEB, png);
    const payload = ephemeral(v);
    expect(payload.files?.map((f) => f.name)).toEqual(['plan-2026-10-14.png']);
    expect(payload.flags & MessageFlags.Ephemeral).toBeTruthy();
  });

  it('without an image: the text list and no files', () => {
    const v = planDay(two, day, true, WEB, null);
    expect(gallery(v)).toHaveLength(0);
    expect(v.files).toEqual([]);
    expect(allText(v)).toContain('08:00–09:30');
    expect(planWeek(two, week, true, WEB).files).toEqual([]);
  });

  it('an empty day or week says "No classes" and has no image', () => {
    for (const v of [
      planDay([], day, true, WEB, png),
      planWeek([], week, true, WEB, undefined, png),
    ]) {
      expect(gallery(v)).toHaveLength(0);
      expect(v.files).toEqual([]);
      expect(allText(v)).toContain('No classes');
    }
  });
});

describe('groupsView', () => {
  const opt = (
    classId: number,
    subjectName: string,
    className: string,
    groups: number,
  ): MyGroupOption => ({
    classId,
    subjectName,
    className,
    groups: Array.from({ length: groups }, (_, i) => ({
      id: classId * 100 + i + 1,
      name: `Gr. ${i + 1}`,
    })),
  });

  it('shows the reminder toggles with their state and the open subject', () => {
    const options = [opt(1, 'Analiza', 'Laboratorium', 3)];
    const v = groupsView(
      options,
      'Analiza',
      {},
      {
        dayBefore: true,
        hourBefore: false,
      },
    );
    expectValid(v);
    const day = buttons(v).find((b) => b.custom_id === 'v1:stu:rem:day:0:0');
    const hour = buttons(v).find((b) => b.custom_id === 'v1:stu:rem:hour:1:0');
    expect([day?.label, day?.style]).toEqual([
      'Reminder 24 h: on',
      ButtonStyle.Success,
    ]);
    expect([hour?.label, hour?.style]).toEqual([
      'Reminder 1 h: off',
      ButtonStyle.Secondary,
    ]);
    const none = groupsView(options, null, {});
    expect(customIds(none)).toContain('v1:stu:rem:day:1');
  });

  it('lists only subjects with groups and marks the current choice', () => {
    const options = [
      opt(1, 'Analiza', 'Laboratorium', 3),
      opt(2, 'Analiza', 'Ćwiczenia', 2),
      opt(3, 'Bez grup', 'Laboratorium', 0),
      opt(4, 'Fizyka', 'Laboratorium', 2),
    ];
    const v = groupsView(options, 'Analiza', { '1': 102 });
    expectValid(v);
    const [subj, ...classSelects] = selects(v);
    expect(subj.custom_id).toBe('v1:stu:groups:subj');
    expect(subj.options.map((o: Json) => o.label)).toEqual([
      'Analiza',
      'Fizyka',
    ]);
    expect(subj.options.find((o: Json) => o.default)?.label).toBe('Analiza');
    expect(classSelects.map((s) => s.custom_id)).toEqual([
      'v1:stu:groups:set:1',
      'v1:stu:groups:set:2',
    ]);
    const lab = classSelects[0];
    expect(lab.options[0]).toMatchObject({ label: '— none —', value: '0' });
    expect(lab.options.filter((o: Json) => o.default)).toEqual([
      expect.objectContaining({ value: '102' }),
    ]);
    const cw = classSelects[1];
    expect(cw.options.filter((o: Json) => o.default)).toEqual([
      expect.objectContaining({ value: '0' }),
    ]);
    expect(buttons(v).map((b) => [b.custom_id, b.label])).toEqual([
      ['v1:stu:rem:day:1:0', 'Reminder 24 h: off'],
      ['v1:stu:rem:hour:1:0', 'Reminder 1 h: off'],
      ['v1:stu:groups:clear', 'Clear'],
      ['v1:stu:plan:day', 'Show my timetable'],
    ]);
    expect(allText(v)).toContain('Gr. 2');
  });

  it('shows no class selects before a subject is picked', () => {
    const v = groupsView([opt(1, 'Analiza', 'Laboratorium', 3)], null, {});
    expectValid(v);
    expect(selects(v)).toHaveLength(1);
  });

  it('pages 30 subjects under 25 options per select', () => {
    const options = Array.from({ length: 30 }, (_, i) =>
      opt(i + 1, `Przedmiot ${String(i).padStart(2, '0')}`, 'Laboratorium', 2),
    );
    const v = groupsView(options, 'Przedmiot 27', {});
    expectValid(v);
    const subj = selects(v).filter((s) =>
      s.custom_id.startsWith('v1:stu:groups:subj'),
    );
    expect(subj.length).toBe(2);
    const values = subj.flatMap((s) => s.options.map((o: Json) => o.value));
    expect(new Set(values).size).toBe(30);
    expect(
      subj.flatMap((s) => s.options).find((o: Json) => o.default)?.label,
    ).toBe('Przedmiot 27');
  });

  it('pages 30 classes of one subject within the limits', () => {
    const options = Array.from({ length: 30 }, (_, i) =>
      opt(i + 1, 'Analiza', `Laboratorium ${i}`, 30),
    );
    const v = groupsView(options, 'Analiza', {});
    expectValid(v);
    expect(allText(v)).toMatch(/…and \d+ more\. Open the website/);
  });
});

describe('notice', () => {
  it('is a single text view', () => {
    const v = notice('You do not have permission.');
    expectValid(v);
    expect(texts(v)).toEqual(['You do not have permission.']);
  });
});
