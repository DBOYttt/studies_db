import type { PlanSession } from '@studies/db';
import { MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { MAX_COMPONENTS, MAX_OPTIONS, MAX_TEXT } from '../src/ui/limits.js';
import {
  deleteConfirm,
  type EventCardData,
  eventCard,
  eventModal,
  linkView,
  placementView,
} from '../src/ui/views/events.js';
import { planDay, planWeek, type View } from '../src/ui/views/student.js';

// biome-ignore lint/suspicious/noExplicitAny: walking raw component JSON
type Json = any;

function nodes(v: View): Json[] {
  const out: Json[] = [];
  const walk = (c: Json) => {
    out.push(c);
    for (const child of c.components ?? []) walk(child);
    if (c.accessory) walk(c.accessory);
  };
  for (const c of v.components) walk(c.toJSON());
  return out;
}
const allText = (v: View) =>
  nodes(v)
    .filter((n) => typeof n.content === 'string')
    .map((n) => n.content as string)
    .join('\n');

function expectValid(v: View) {
  expect(v.flags).toBe(MessageFlags.IsComponentsV2);
  expect(nodes(v).length).toBeLessThanOrEqual(MAX_COMPONENTS);
  expect(allText(v).length).toBeLessThanOrEqual(MAX_TEXT);
  for (const n of nodes(v)) {
    if (n.custom_id) expect(n.custom_id.length).toBeLessThanOrEqual(100);
    if (n.type === 1) expect(n.components.length).toBeLessThanOrEqual(5);
    if (n.type === 3) expect(n.options.length).toBeLessThanOrEqual(MAX_OPTIONS);
  }
}

const wall = (iso: string) => new Date(`${iso}Z`);
const card = (over: Partial<EventCardData> = {}): EventCardData => ({
  id: 7,
  kind: 'kolokwium',
  title: 'Kolokwium z całek',
  subjectCode: 'AM1',
  subjectName: 'Analiza matematyczna',
  placement: 'Laboratorium · Gr. 2',
  startsAt: wall('2026-10-20T10:00:00'),
  endsAt: wall('2026-10-20T11:30:00'),
  allDay: false,
  place: 'C-13 1.23',
  note: 'Przynieść kalkulator',
  createdByName: 'Ala',
  updatedByName: 'Ola',
  materials: [],
  webBaseUrl: 'https://x.pl/',
  postUrl: 'https://discord.com/channels/1/2',
  ...over,
});

describe('eventCard', () => {
  it('shows the details and the buttons', () => {
    const v = eventCard(card());
    expectValid(v);
    const t = allText(v);
    expect(t).toContain('📝 Kolokwium z całek');
    expect(t).toContain('wt 20.10.2026 10:00–11:30');
    expect(t).toContain('C-13 1.23');
    expect(t).toContain('Dodał(a): Ala');
    expect(t).toContain('ostatnio edytował(a): Ola');
    const b = nodes(v).filter((n) => n.type === 2);
    expect(b.map((x) => x.label)).toEqual([
      'Zajęcia/grupa',
      'Powiąż posty',
      'Edytuj',
      'Usuń',
      'Otwórz post',
      'Otwórz na stronie',
    ]);
    expect(b[4].url).toBe('https://discord.com/channels/1/2');
    expect(b[5].url).toBe('https://x.pl/s/wydarzenia/7');
  });

  it('omits "Otwórz post" without a post and disables class/links without a subject', () => {
    const v = eventCard(
      card({ postUrl: null, subjectCode: null, subjectName: null }),
    );
    const b = nodes(v).filter((n) => n.type === 2);
    expect(b.map((x) => x.label)).not.toContain('Otwórz post');
    expect(b[0].disabled).toBe(true);
    expect(b[1].disabled).toBe(true);
  });

  it('stays within the limits with 30 materials: 15 lines, then "…i N więcej"', () => {
    const materials = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      filename: `${'x'.repeat(120)}-${i}.pdf`,
      previewKind: i % 2 ? 'pdf' : 'none',
    }));
    const v = eventCard(card({ materials, note: 'n'.repeat(1000) }));
    expectValid(v);
    const t = allText(v);
    expect(t).toContain('Materiały (30)');
    expect(t.match(/^• /gm)?.length).toBeLessThanOrEqual(15);
    expect(t).toContain('…i 15 więcej — otwórz na stronie');
    expect(t).toContain('https://x.pl/files/2/preview');
    expect(t).toContain('https://x.pl/files/1/original');
  });

  it('says how many materials do not fit in the text budget', () => {
    const materials = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      filename: `${'y'.repeat(200)}${i}`,
      previewKind: 'pdf',
    }));
    const v = eventCard(
      card({ materials, note: 'n'.repeat(1000), title: 't'.repeat(100) }),
    );
    expectValid(v);
  });

  it('all-day events say so', () => {
    const v = eventCard(card({ allDay: true, endsAt: null }));
    expect(allText(v)).toContain('(cały dzień)');
  });
});

describe('eventModal', () => {
  const subs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ code: `S${i}`, name: `P${i}` }));
  const json = (m: ReturnType<typeof eventModal>) => m.toJSON() as Json;

  it('has five components with the planned ids', () => {
    const j = json(eventModal(null, subs(3)));
    expect(j.custom_id).toBe('v1:evt:save:new');
    expect(j.components).toHaveLength(5);
    const inner = j.components.map((c: Json) => c.component.custom_id);
    expect(inner).toEqual(['kind', 'title', 'subject', 'when', 'place_note']);
    const sel = j.components[2].component;
    expect(sel.options[0].label).toBe('— brak —');
    expect(sel.options).toHaveLength(4);
  });

  it('offers a code text field past 24 subjects', () => {
    const j = json(eventModal(null, subs(25)));
    expect(j.components).toHaveLength(5);
    expect(j.components[2].component.type).toBe(4);
    const j24 = json(eventModal(null, subs(24)));
    expect(j24.components[2].component.options).toHaveLength(25);
  });

  it('prefills an edit', () => {
    const j = json(
      eventModal(9, subs(3), {
        kind: 'egzamin',
        title: 'Egzamin',
        subjectCode: 'S1',
        startsAt: wall('2026-11-02T09:00:00'),
        endsAt: wall('2026-11-02T10:00:00'),
        allDay: false,
        place: 'A1',
        note: 'dużo pracy',
      }),
    );
    expect(j.custom_id).toBe('v1:evt:save:9');
    const c = j.components.map((x: Json) => x.component);
    expect(c[0].options.find((o: Json) => o.default).value).toBe('egzamin');
    expect(c[1].value).toBe('Egzamin');
    expect(c[2].options.find((o: Json) => o.default).value).toBe('S1');
    expect(c[3].value).toBe('02.11.2026 09:00-10:00');
    expect(c[4].value).toBe('A1\ndużo pracy');
  });
});

describe('pickers', () => {
  it('delete confirmation', () => {
    const v = deleteConfirm(5, 'X');
    expectValid(v);
    expect(
      nodes(v)
        .filter((n) => n.type === 2)
        .map((b) => b.custom_id),
    ).toEqual(['v1:evt:delok:5', 'v1:evt:show:5']);
  });

  it('class/group select stays within 25 options', () => {
    const classes = Array.from({ length: 4 }, (_, c) => ({
      classId: c + 1,
      className: `K${c}`,
      groups: Array.from({ length: 9 }, (_, g) => ({
        id: c * 10 + g + 1,
        name: `Gr. ${g + 1}`,
      })),
    }));
    const v = placementView(5, 'X', classes, { classId: null, groupId: null });
    expectValid(v);
    expect(allText(v)).toContain('więcej');
  });

  it('link view toggles with a select and pages', () => {
    const topics = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      title: `Post ${i}`,
      linked: i === 0,
    }));
    const v = linkView(5, 'X', topics, 1, 3, 1);
    expectValid(v);
    const ids = nodes(v)
      .map((n) => n.custom_id)
      .filter(Boolean);
    expect(ids).toEqual([
      'v1:evt:link:5:1',
      'v1:evt:show:5',
      'v1:evt:link:5:0',
      'v1:evt:link:5:2',
    ]);
    expect(nodes(v).find((n) => n.type === 3).options[0].label).toBe(
      '✓ Post 0',
    );
  });
});

describe('plan views list events', () => {
  let n = 100;
  const ev = (start: string, over: Partial<PlanSession> = {}): PlanSession => ({
    type: 'event',
    id: n++,
    startsAt: wall(start),
    endsAt: wall(start),
    subjectId: 0,
    subjectName: '',
    subjectCode: '',
    classId: null,
    classKind: null,
    className: null,
    groupId: null,
    groupName: null,
    lecturerId: null,
    lecturerName: null,
    room: null,
    label: 'Wyjazd integracyjny',
    status: 'confirmed',
    eventKind: 'wyjazd',
    eventTitle: 'Wyjazd integracyjny',
    allDay: false,
    ...over,
  });
  const week = { year: 2026, week: 43 };

  it('day: a "Wydarzenia" select opens the card by event id', () => {
    const e = ev('2026-10-20T10:00:00');
    const v = planDay([e], wall('2026-10-20T00:00:00'), true, 'https://x.pl');
    expectValid(v);
    const sel = nodes(v).find((x) => x.custom_id === 'v1:evt:open');
    expect(sel.placeholder).toBe('Wydarzenia');
    expect(sel.options).toHaveLength(1);
    expect(sel.options[0].value).toBe(String(e.id));
    expect(sel.options[0].label).toBe('🚌 Wyjazd integracyjny');
    expect(allText(v)).toContain('🚌 Wyjazd integracyjny');
  });

  it('week: earliest first, at most 25, "…i N więcej" for the rest', () => {
    const list = Array.from({ length: 30 }, (_, i) =>
      ev(
        `2026-10-${String(20 + (i % 5)).padStart(2, '0')}T${String(8 + (i % 8)).padStart(2, '0')}:00:00`,
      ),
    );
    const v = planWeek(list, week, true, 'https://x.pl');
    expectValid(v);
    const sel = nodes(v).find((x) => x.custom_id === 'v1:evt:open');
    expect(sel.options).toHaveLength(25);
    expect(allText(v)).toContain('…i 5 więcej');
    const vals = sel.options.map((o: Json) => Number(o.value));
    const startOf = (id: number) =>
      list.find((s) => s.id === id)?.startsAt.getTime() as number;
    expect([...vals].sort((a, b) => startOf(a) - startOf(b))).toEqual(vals);
  });

  it('no select without events', () => {
    const v = planWeek([], week, true, 'https://x.pl');
    expect(nodes(v).find((x) => x.custom_id === 'v1:evt:open')).toBeUndefined();
  });
});
