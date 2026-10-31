import { ASSESSMENTS, CLASS_KINDS } from '@studies/db';
import { MessageFlags, type ModalBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { commandDefinitions } from '../src/commands/definitions.js';
import { decodeId } from '../src/ui/ids.js';
import { MAX_COMPONENTS, MAX_OPTIONS, MAX_TEXT } from '../src/ui/limits.js';
import {
  adminPanel,
  assignPicker,
  banConfirm,
  classActions,
  type LecturerCardData,
  lecturerCard,
  lecturerPicker,
  reportView,
  type SubjectCardData,
  setupConfirm,
  statusCard,
  subjectCard,
  subjectPicker,
  type UserCardData,
  userCard,
  userPicker,
} from '../src/ui/views/admin.js';
import {
  classModal,
  lecturerModal,
  prefill,
  subjectModal,
} from '../src/ui/views/modals.js';
import type { View } from '../src/ui/views/parts.js';

// biome-ignore lint/suspicious/noExplicitAny: walking raw component JSON
type Json = any;

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
const allText = (v: View) =>
  nodes(v)
    .filter((n) => typeof n.content === 'string')
    .map((n) => n.content as string)
    .join('\n');
const customIds = (v: View) =>
  nodes(v)
    .map((n) => n.custom_id)
    .filter((id): id is string => typeof id === 'string');
const buttons = (v: View) => nodes(v).filter((n) => n.type === 2);
const selects = (v: View) => nodes(v).filter((n) => n.type === 3);
const button = (v: View, id: string) =>
  buttons(v).find((b) => b.custom_id === id);
const labelsById = (v: View) =>
  buttons(v).map((b) => [b.custom_id, b.label, !!b.disabled]);

function expectValid(v: View) {
  expect(v.flags).toBe(MessageFlags.IsComponentsV2);
  expect(nodes(v).length).toBeLessThanOrEqual(MAX_COMPONENTS);
  const ids = customIds(v);
  for (const id of ids) {
    expect(id.length).toBeLessThanOrEqual(100);
    expect(decodeId(id)?.area).toBe('adm');
  }
  expect(new Set(ids).size).toBe(ids.length);
  expect(allText(v).length).toBeLessThanOrEqual(MAX_TEXT);
  for (const n of nodes(v)) {
    if (n.type === 1) expect(n.components.length).toBeLessThanOrEqual(5);
    if (n.type === 2) expect(n.label.length).toBeLessThanOrEqual(80);
    if (n.type === 3 && n.placeholder)
      expect(n.placeholder.length).toBeLessThanOrEqual(150);
    if (n.type === 3) {
      expect(n.options.length).toBeGreaterThan(0);
      expect(n.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
      for (const o of n.options) {
        expect(o.value.length).toBeLessThanOrEqual(100);
        expect(o.label.length).toBeLessThanOrEqual(100);
      }
    }
  }
}

/** Modal JSON: top-level labels, each holding one field. */
function fields(m: ModalBuilder): Json[] {
  return m.toJSON().components.map((c: Json) => c.component);
}
const field = (m: ModalBuilder, id: string) =>
  fields(m).find((f) => f.custom_id === id);

function expectValidModal(m: ModalBuilder) {
  const json: Json = m.toJSON();
  expect(json.custom_id.length).toBeLessThanOrEqual(100);
  expect(decodeId(json.custom_id)?.area).toBe('adm');
  expect(json.title.length).toBeLessThanOrEqual(45);
  expect(json.components.length).toBeGreaterThan(0);
  expect(json.components.length).toBeLessThanOrEqual(5);
  for (const label of json.components) {
    expect(label.type).toBe(18);
    expect(label.label.length).toBeLessThanOrEqual(45);
    const f = label.component;
    if (f.type === 4 && f.value !== undefined) {
      expect(f.value.length).toBeLessThanOrEqual(f.max_length);
    }
  }
}

const subjects = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    code: `S${String(i).padStart(2, '0')}`,
    name: `Przedmiot ${i}`,
    semester: (i % 7) + 1,
  }));
const lecturers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Prowadzący ${i}`,
    title: i % 2 ? 'dr' : null,
  }));

const AM: SubjectCardData = {
  code: 'AM1',
  name: 'Analiza matematyczna',
  semester: 1,
  ects: 6,
  description: 'Granice, pochodne, całki.',
  platformUrl: 'https://moodle.example/am1',
  channelId: '123456789012345678',
  classes: [
    {
      kind: 'wyklad',
      assessment: 'egzamin',
      assessmentNote: 'pisemny',
      platformUrl: null,
      lecturers: [{ name: 'dr Anna Nowak', groupName: null }],
    },
    {
      kind: 'laboratorium',
      assessment: null,
      assessmentNote: null,
      platformUrl: null,
      lecturers: [
        { name: 'mgr Jan Kowalski', groupName: 'Gr. 1' },
        { name: 'mgr Ewa Lis', groupName: 'Gr. 2' },
      ],
    },
  ],
};

const LECTURER: LecturerCardData = {
  id: 7,
  name: 'Anna Nowak',
  title: 'dr',
  email: 'anna.nowak@example.edu',
  officeHours: 'wt 10–12',
  room: 'C-13 1.23',
};

const USER: UserCardData = {
  discordUserId: '223456789012345678',
  displayName: 'Ola',
  isAdmin: false,
  isBanned: false,
  createdAt: new Date('2026-10-01T10:00:00Z'),
};

/** The slash-command option max length at `cmd sub option`. */
function optionMax(cmd: string, sub: string, option: string): number {
  const c = commandDefinitions.find((d) => d.name === cmd) as Json;
  const s = c.options.find((o: Json) => o.name === sub);
  const o = s.options.find((x: Json) => x.name === option);
  expect(o.max_length).toBeTypeOf('number');
  return o.max_length;
}

describe('adminPanel', () => {
  it('offers the five admin entry points', () => {
    const v = adminPanel();
    expectValid(v);
    expect(buttons(v).map((b) => [b.custom_id, b.label])).toEqual([
      ['v1:adm:status', 'Status and sync'],
      ['v1:adm:subj:list:0', 'Subjects'],
      ['v1:adm:lect:list:0', 'Lecturers'],
      ['v1:adm:user:open', 'Users'],
      ['v1:adm:web', 'Web panel'],
    ]);
  });
});

describe('statusCard', () => {
  it('shows plan text, job counts and pending materials with the actions', () => {
    const v = statusCard({
      planText: 'Last sync: 14.10 08:00 (ok)',
      jobs: { queued: 3, running: 1, failed: 2 },
      pending: 5,
    });
    expectValid(v);
    const t = allText(v);
    expect(t).toContain('Last sync: 14.10 08:00 (ok)');
    expect(t).toMatch(/Queued: 3/);
    expect(t).toMatch(/Running: 1/);
    expect(t).toMatch(/Failed: 2/);
    expect(t).toMatch(/5/);
    expect(buttons(v).map((b) => [b.custom_id, b.label])).toEqual(
      expect.arrayContaining([
        ['v1:adm:plan:sync', 'Sync timetable'],
        ['v1:adm:setup:dry', 'Preview /setup'],
        ['v1:adm:setup:ask', 'Run /setup'],
        ['v1:adm:resync', 'Fetch from Discord'],
        ['v1:adm:status', 'Refresh'],
      ]),
    );
    expect(buttons(v)).toHaveLength(5);
  });

  it('cuts a very long plan text', () => {
    const v = statusCard({
      planText: 'x'.repeat(10_000),
      jobs: { queued: 0, running: 0, failed: 0 },
      pending: 0,
    });
    expectValid(v);
  });
});

describe('setupConfirm', () => {
  it('asks with a danger confirm and a cancel', () => {
    const v = setupConfirm();
    expectValid(v);
    const ok = button(v, 'v1:adm:setup:run');
    expect(ok.label).toBe('Yes, run it');
    expect(ok.style).toBe(4);
    expect(button(v, 'v1:adm:status').label).toBe('Cancel');
  });
});

describe('reportView', () => {
  it('shows the title and text', () => {
    const v = reportView('/setup preview', 'No changes.');
    expectValid(v);
    expect(allText(v)).toContain('/setup preview');
    expect(allText(v)).toContain('No changes.');
  });

  it('cuts long text at MAX_TEXT with "…"', () => {
    const v = reportView('Raport', 'a'.repeat(MAX_TEXT * 2));
    expectValid(v);
    const t = allText(v);
    expect(t.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(t.length).toBeGreaterThan(MAX_TEXT - 100);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('subjectPicker', () => {
  it('pages 30 subjects by 25', () => {
    const all = subjects(30);
    const first = subjectPicker(all, 0);
    expectValid(first);
    const [sel] = selects(first);
    expect(sel.custom_id).toBe('v1:adm:subj:pick');
    expect(sel.options.map((o: Json) => o.value)).toEqual(
      all.slice(0, 25).map((s) => s.code),
    );
    expect(labelsById(first)).toEqual(
      expect.arrayContaining([
        ['v1:adm:subj:list:-1', '◀', true],
        ['v1:adm:subj:list:1', '▶', false],
        ['v1:adm:subj:add', 'Add subject', false],
      ]),
    );

    const last = subjectPicker(all, 1);
    expectValid(last);
    expect(selects(last)[0].options.map((o: Json) => o.value)).toEqual(
      all.slice(25).map((s) => s.code),
    );
    expect(button(last, 'v1:adm:subj:list:0').disabled).toBeFalsy();
    expect(button(last, 'v1:adm:subj:list:2').disabled).toBe(true);
  });

  it('prefixes labels with the semester only past 25 subjects', () => {
    const big = selects(subjectPicker(subjects(30), 0))[0].options[0].label;
    expect(big).toBe('S1 · S00 Przedmiot 0');
    const small = selects(subjectPicker(subjects(25), 0))[0].options[0].label;
    expect(small).toBe('S00 Przedmiot 0');
  });

  it('clamps an out-of-range page and handles one or no pages', () => {
    const v = subjectPicker(subjects(30), 9);
    expect(selects(v)[0].options[0].value).toBe('S25');
    const one = subjectPicker(subjects(3), 0);
    expectValid(one);
    expect(
      buttons(one).filter((b) => b.label === '◀' || b.label === '▶'),
    ).toHaveLength(2);
    expect(
      buttons(one).every((b) => b.label === 'Add subject' || b.disabled),
    ).toBe(true);
    const none = subjectPicker([], 0);
    expectValid(none);
    expect(selects(none)).toHaveLength(0);
    expect(button(none, 'v1:adm:subj:add')).toBeDefined();
  });

  it('clips long names in labels', () => {
    const v = subjectPicker(
      [{ code: 'X', name: 'n'.repeat(300), semester: 1 }],
      0,
    );
    expectValid(v);
  });
});

describe('subjectCard', () => {
  it('shows the subject, its classes and the actions', () => {
    const v = subjectCard(AM);
    expectValid(v);
    const t = allText(v);
    for (const s of [
      'AM1',
      'Analiza matematyczna',
      'Semester 1',
      '6 ECTS',
      '<#123456789012345678>',
      'Wykład',
      'Exam',
      'pisemny',
      'dr Anna Nowak',
      'Laboratorium',
      'mgr Jan Kowalski (Gr. 1)',
    ]) {
      expect(t).toContain(s);
    }
    expect(button(v, 'v1:adm:subj:edit:AM1').label).toBe('Edit');
    const [sel] = selects(v);
    expect(sel.custom_id).toBe('v1:adm:class:pick:AM1');
    expect(sel.options.map((o: Json) => o.value)).toEqual([...CLASS_KINDS]);
  });

  it('says "no forum" without a channel', () => {
    const v = subjectCard({ ...AM, channelId: null, classes: [] });
    expectValid(v);
    expect(allText(v)).toContain('no forum');
  });

  it('stays within the limits with huge content', () => {
    const v = subjectCard({
      ...AM,
      name: 'N'.repeat(200),
      description: 'd'.repeat(5000),
      classes: CLASS_KINDS.map((kind) => ({
        kind,
        assessment: 'zaliczenie' as const,
        assessmentNote: 'n'.repeat(500),
        platformUrl: `https://x.example/${'p'.repeat(480)}`,
        lecturers: Array.from({ length: 30 }, (_, i) => ({
          name: `Prowadzący ${'z'.repeat(150)} ${i}`,
          groupName: `Gr. ${i}`,
        })),
      })),
    });
    expectValid(v);
  });
});

describe('classActions', () => {
  it('offers edit and assign for the class', () => {
    const v = classActions('AM1', 'laboratorium');
    expectValid(v);
    expect(button(v, 'v1:adm:class:edit:AM1:laboratorium').label).toBe(
      'Edit class',
    );
    expect(button(v, 'v1:adm:assign:start:AM1:laboratorium').label).toBe(
      'Assign lecturer',
    );
    expect(allText(v)).toContain('Laboratorium');
  });
});

describe('assignPicker', () => {
  const groups = [
    { number: 1, name: 'Gr. 1' },
    { number: 2, name: 'Gr. 2' },
  ];

  it('first asks for the lecturer', () => {
    const v = assignPicker('AM1', 'laboratorium', lecturers(3), groups);
    expectValid(v);
    const [sel] = selects(v);
    expect(sel.custom_id).toBe('v1:adm:assign:lect:AM1:laboratorium');
    expect(sel.options.map((o: Json) => o.value)).toEqual(['1', '2', '3']);
    expect(sel.options[1].label).toBe('dr Prowadzący 1');
  });

  it('then asks for the group, 0 meaning the whole class', () => {
    const v = assignPicker('AM1', 'laboratorium', lecturers(3), groups, {
      lecturerId: 2,
    });
    expectValid(v);
    const [lect, grp] = selects(v);
    expect(lect.options.find((o: Json) => o.default)?.value).toBe('2');
    expect(grp.custom_id).toBe('v1:adm:assign:grp:AM1:laboratorium:2');
    expect(grp.options.map((o: Json) => [o.value, o.label])).toEqual([
      ['0', 'Whole class'],
      ['1', 'Gr. 1'],
      ['2', 'Gr. 2'],
    ]);
  });

  it('shows 24 groups and a hint for the rest', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      number: i + 1,
      name: `Gr. ${i + 1}`,
    }));
    const v = assignPicker('AM1', 'laboratorium', lecturers(3), many, {
      lecturerId: 2,
    });
    expectValid(v);
    expect(selects(v)[1].options).toHaveLength(25);
    expect(allText(v)).toContain('…and 6 more. Use /lecturer assign');
    const few = assignPicker('AM1', 'laboratorium', lecturers(3), groups, {
      lecturerId: 2,
    });
    expect(allText(few)).not.toContain('more');
  });

  it('pages lecturers by 25 and keeps the chosen one on its page', () => {
    const all = lecturers(30);
    const v = assignPicker('AM1', 'cwiczenia', all, []);
    expectValid(v);
    expect(selects(v)[0].options).toHaveLength(25);
    expect(
      button(v, 'v1:adm:assign:start:AM1:cwiczenia:1').disabled,
    ).toBeFalsy();
    const p1 = assignPicker('AM1', 'cwiczenia', all, [], { page: 1 });
    expectValid(p1);
    expect(selects(p1)[0].options).toHaveLength(5);
    const chosen = assignPicker('AM1', 'cwiczenia', all, [], {
      lecturerId: 28,
    });
    expectValid(chosen);
    expect(selects(chosen)[0].options.find((o: Json) => o.default)?.value).toBe(
      '28',
    );
    expect(selects(chosen)[1].options).toEqual([
      expect.objectContaining({ value: '0', label: 'Whole class' }),
    ]);
  });

  it('caps groups at 24 next to "Whole class"', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      number: i + 1,
      name: `Gr. ${i + 1}`,
    }));
    const v = assignPicker('AM1', 'laboratorium', lecturers(1), many, {
      lecturerId: 1,
    });
    expectValid(v);
  });
});

describe('lecturerPicker / lecturerCard', () => {
  it('pages 30 lecturers by 25', () => {
    const all = lecturers(30);
    const first = lecturerPicker(all, 0);
    expectValid(first);
    const [sel] = selects(first);
    expect(sel.custom_id).toBe('v1:adm:lect:pick');
    expect(sel.options).toHaveLength(25);
    expect(sel.options[0].value).toBe('1');
    expect(button(first, 'v1:adm:lect:list:-1').disabled).toBe(true);
    expect(button(first, 'v1:adm:lect:list:1').disabled).toBeFalsy();
    expect(button(first, 'v1:adm:lect:add').label).toBe('Add lecturer');
    const last = lecturerPicker(all, 1);
    expectValid(last);
    expect(selects(last)[0].options).toHaveLength(5);
    expect(button(last, 'v1:adm:lect:list:2').disabled).toBe(true);
  });

  it('shows the lecturer with an edit button', () => {
    const v = lecturerCard(LECTURER);
    expectValid(v);
    const t = allText(v);
    for (const s of ['dr Anna Nowak', 'anna.nowak@example.edu', 'wt 10–12']) {
      expect(t).toContain(s);
    }
    expect(button(v, 'v1:adm:lect:edit:7').label).toBe('Edit');
  });
});

describe('users', () => {
  it('userPicker is a Discord user select', () => {
    const v = userPicker();
    expectValid(v);
    const sel = nodes(v).find((n) => n.type === 5);
    expect(sel.custom_id).toBe('v1:adm:user:pick');
  });

  it('userCard shows the flags and offers ban or unban', () => {
    const v = userCard(USER, false);
    expectValid(v);
    const t = allText(v);
    expect(t).toContain('Ola');
    expect(t).toContain('1 Oct 2026');
    const ban = button(v, `v1:adm:user:ban:${USER.discordUserId}`);
    expect(ban.label).toBe('Block');
    expect(ban.disabled).toBeFalsy();
    const banned = userCard({ ...USER, isBanned: true }, false);
    expectValid(banned);
    expect(
      button(banned, `v1:adm:user:unban:${USER.discordUserId}`).label,
    ).toBe('Unblock');
  });

  it('userCard disables the ban button for yourself', () => {
    const v = userCard({ ...USER, isAdmin: true }, true);
    expectValid(v);
    expect(button(v, `v1:adm:user:ban:${USER.discordUserId}`).disabled).toBe(
      true,
    );
  });

  it('banConfirm confirms ban or unban, cancel goes back', () => {
    const ban = banConfirm(USER, true);
    expectValid(ban);
    expect(
      button(ban, `v1:adm:user:banok:${USER.discordUserId}`),
    ).toBeDefined();
    expect(button(ban, 'v1:adm:user:open').label).toBe('Cancel');
    const unban = banConfirm(USER, false);
    expectValid(unban);
    expect(
      button(unban, `v1:adm:user:unbanok:${USER.discordUserId}`),
    ).toBeDefined();
  });
});

describe('modals', () => {
  it('subjectModal(): new subject has the code field', () => {
    const m = subjectModal();
    expectValidModal(m);
    expect(m.toJSON().custom_id).toBe('v1:adm:subj:save:new');
    expect(fields(m).map((f) => f.custom_id)).toEqual([
      'name',
      'code',
      'semester',
      'ects',
      'description',
    ]);
  });

  it('subjectModal(): the semester label gives the range', () => {
    const json = JSON.stringify(subjectModal().toJSON());
    expect(json).toContain('"Semester (1–7)"');
    expect(json).not.toContain(' or ');
  });

  it('subjectModal(existing) has no code field and is prefilled', () => {
    const m = subjectModal(AM);
    expectValidModal(m);
    expect(m.toJSON().custom_id).toBe('v1:adm:subj:save:AM1');
    expect(fields(m).map((f) => f.custom_id)).toEqual([
      'name',
      'semester',
      'ects',
      'description',
      'platform_url',
    ]);
    expect(field(m, 'name').value).toBe('Analiza matematyczna');
    expect(field(m, 'semester').value).toBe('1');
    expect(field(m, 'ects').value).toBe('6');
    expect(field(m, 'platform_url').value).toBe('https://moodle.example/am1');
  });

  it('subjectModal clips an over-long stored description to the limit', () => {
    const m = subjectModal({ ...AM, description: 'd'.repeat(3000) });
    expectValidModal(m);
  });

  it('classModal has the assessment select in a label, prefilled', () => {
    const m = classModal('AM1', 'wyklad', {
      assessment: 'egzamin',
      assessmentNote: 'pisemny',
      platformUrl: null,
    });
    expectValidModal(m);
    expect(m.toJSON().custom_id).toBe('v1:adm:class:save:AM1:wyklad');
    const sel = field(m, 'assessment');
    expect(sel.type).toBe(3);
    expect(sel.options.map((o: Json) => o.value)).toEqual([
      'brak',
      ...ASSESSMENTS,
    ]);
    expect(sel.options.filter((o: Json) => o.default)).toEqual([
      expect.objectContaining({ value: 'egzamin' }),
    ]);
    expect(field(m, 'note').value).toBe('pisemny');
    expect(field(m, 'platform_url').value).toBeUndefined();
    const none = classModal('AM1', 'wyklad', {
      assessment: null,
      assessmentNote: null,
      platformUrl: null,
    });
    expect(
      field(none, 'assessment').options.find((o: Json) => o.default)?.value,
    ).toBe('brak');
  });

  it('lecturerModal: new and existing', () => {
    const add = lecturerModal();
    expectValidModal(add);
    expect(add.toJSON().custom_id).toBe('v1:adm:lect:save:new');
    expect(fields(add).map((f) => f.custom_id)).toEqual([
      'name',
      'title',
      'email',
      'office_hours',
      'room',
    ]);
    const edit = lecturerModal(LECTURER);
    expectValidModal(edit);
    expect(edit.toJSON().custom_id).toBe('v1:adm:lect:save:7');
    expect(field(edit, 'email').value).toBe('anna.nowak@example.edu');
  });

  it('field max lengths equal the slash-command option limits', () => {
    const subj = subjectModal(AM);
    const add = subjectModal();
    expect(field(add, 'name').max_length).toBe(
      optionMax('subject', 'add', 'name'),
    );
    expect(field(add, 'code').max_length).toBe(
      optionMax('subject', 'add', 'code'),
    );
    expect(field(add, 'description').max_length).toBe(
      optionMax('subject', 'add', 'description'),
    );
    expect(field(subj, 'name').max_length).toBe(
      optionMax('subject', 'edit', 'name'),
    );
    expect(field(subj, 'description').max_length).toBe(
      optionMax('subject', 'edit', 'description'),
    );
    expect(field(subj, 'platform_url').max_length).toBe(
      optionMax('subject', 'edit', 'platform_url'),
    );

    const cls = classModal('AM1', 'wyklad', {
      assessment: null,
      assessmentNote: null,
      platformUrl: null,
    });
    expect(field(cls, 'note').max_length).toBe(
      optionMax('class', 'edit', 'note'),
    );
    expect(field(cls, 'platform_url').max_length).toBe(
      optionMax('class', 'edit', 'platform_url'),
    );

    for (const m of [lecturerModal(), lecturerModal(LECTURER)]) {
      for (const [id, opt] of [
        ['name', 'name'],
        ['title', 'title'],
        ['email', 'email'],
        ['office_hours', 'office_hours'],
        ['room', 'room'],
      ]) {
        expect(field(m, id).max_length).toBe(
          optionMax('lecturer', 'edit', opt),
        );
        expect(field(m, id).max_length).toBe(optionMax('lecturer', 'add', opt));
      }
    }
  });
});

describe('prefill and display names', () => {
  it('clips prefills without splitting a surrogate pair', () => {
    expect(prefill('a😀', 2)).toBe('a');
    expect(prefill('a😀', 3)).toBe('a😀');
    expect(prefill(null, 5)).toBe('');
    const m = subjectModal({
      code: 'ASD',
      name: 'A',
      semester: 1,
      ects: 5,
      description: `${'a'.repeat(999)}😀`,
      platformUrl: null,
    }).toJSON() as Json;
    const walk = (c: Json): Json[] => [
      c,
      ...(c.components ?? []).flatMap(walk),
      ...(c.component ? walk(c.component) : []),
    ];
    const desc = walk(m).find((n) => n.custom_id === 'description');
    expect(desc.value).toBe('a'.repeat(999));
  });

  it('keeps display names on one line in headings and bold text', () => {
    const u = { ...USER, displayName: 'Ola\n## Hack' };
    expect(allText(userCard(u, false))).toContain('## Ola ## Hack\n');
    expect(allText(banConfirm(u, true))).toContain('**Ola ## Hack**');
  });

  it('shows a user who never used the bot', () => {
    expect(allText(userCard({ ...USER, createdAt: null }, false))).toContain(
      'First use: has not used the bot yet',
    );
  });
});
