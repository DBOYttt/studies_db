import { createCanvas, loadImage } from '@napi-rs/canvas';
import { EXAM_COLORS, KIND_COLORS } from '@studies/db/constants';
import type { PlanSession } from '@studies/db/plan';
import { describe, expect, it } from 'vitest';
import {
  DAY_IMAGE_WIDTH,
  dayGeometry,
  dayLines,
  EVENT_COLORS,
  renderDayImage,
  renderWeekImage,
  WEEK_IMAGE_WIDTH,
  weekGeometry,
  weekLines,
} from '../src/ui/plan-image.js';

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
    label: 'L',
    status: 'confirmed',
    ...over,
  };
}

const W42 = { year: 2026, week: 42 };
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngSize = (b: Buffer) => ({
  width: b.readUInt32BE(16),
  height: b.readUInt32BE(20),
});
const hex = (rgba: Uint8ClampedArray) =>
  `#${[...rgba.slice(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

async function pixel(png: Buffer, x: number, y: number): Promise<string> {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return hex(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
}

describe('renderWeekImage', () => {
  const lab = session('2026-10-14T10:00:00', '2026-10-14T11:30:00', {
    lecturerName: null,
    room: null,
  });

  it('is a PNG of the week width', async () => {
    const png = await renderWeekImage([lab], W42, wall('2026-10-14T12:00:00'));
    expect(png).not.toBeNull();
    expect([...(png as Buffer).subarray(0, 8)]).toEqual(PNG);
    expect(pngSize(png as Buffer).width).toBe(WEEK_IMAGE_WIDTH);
  });

  it('nothing to draw for an empty week', async () => {
    expect(await renderWeekImage([], W42, null)).toBeNull();
  });

  it('fills a block with its class-kind colour at its place', async () => {
    const png = (await renderWeekImage([lab], W42, null)) as Buffer;
    const g = weekGeometry([lab], W42, null);
    const [b] = g.blocks;
    expect(b.session).toBe(lab);
    // Wednesday is the third column.
    expect(b.x).toBeGreaterThan(g.columns[2].x - 1);
    expect(b.x + b.w).toBeLessThan(g.columns[2].x + g.columns[2].w + 1);
    expect(pngSize(png).height).toBe(g.height);
    // Bottom-right corner area: no text there.
    expect(await pixel(png, b.x + b.w - 6, b.y + b.h - 6)).toBe(
      KIND_COLORS.dark.laboratorium.bg,
    );
    // The left accent stripe is the ink colour.
    expect(await pixel(png, b.x + 2, b.y + b.h / 2)).toBe(
      KIND_COLORS.dark.laboratorium.fg,
    );
  });

  it('places overlapping sessions side by side', () => {
    const a = session('2026-10-14T08:00:00', '2026-10-14T10:00:00');
    const b = session('2026-10-14T09:00:00', '2026-10-14T10:30:00');
    const [ba, bb] = weekGeometry([a, b], W42, null).blocks;
    expect(ba.w).toBeCloseTo(bb.w);
    expect(bb.x).toBeGreaterThanOrEqual(ba.x + ba.w);
  });

  it('shows Saturday only when a session falls on it', () => {
    expect(weekGeometry([lab], W42, null).columns).toHaveLength(5);
    const sat = session('2026-10-17T09:00:00', '2026-10-17T10:00:00');
    expect(weekGeometry([lab, sat], W42, null).columns).toHaveLength(6);
  });

  it('marks today and labels days "Mon 12 Oct"', () => {
    const g = weekGeometry([lab], W42, wall('2026-10-14T12:00:00'));
    expect(g.columns.map((c) => c.label)).toEqual([
      'Mon 12 Oct',
      'Tue 13 Oct',
      'Wed 14 Oct',
      'Thu 15 Oct',
      'Fri 16 Oct',
    ]);
    expect(g.columns.map((c) => c.today)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('shows at least 08:00–16:00, else the sessions ± 30 min within 07:00–20:00', () => {
    expect(weekGeometry([lab], W42, null)).toMatchObject({
      startMin: 480,
      endMin: 960,
    });
    const early = session('2026-10-13T07:15:00', '2026-10-13T08:00:00');
    const late = session('2026-10-15T18:00:00', '2026-10-15T19:45:00');
    expect(weekGeometry([early, late], W42, null)).toMatchObject({
      startMin: 420,
      endMin: 1200,
    });
    const mid = session('2026-10-15T15:30:00', '2026-10-15T17:00:00');
    expect(weekGeometry([lab, mid], W42, null)).toMatchObject({
      startMin: 480,
      endMin: 1050,
    });
  });
});

describe('renderDayImage', () => {
  const day = wall('2026-10-14T00:00:00');
  it('is a PNG of the day width with the sessions of that day only', async () => {
    const s = session('2026-10-14T10:00:00', '2026-10-14T11:30:00');
    const other = session('2026-10-15T10:00:00', '2026-10-15T11:30:00');
    const png = (await renderDayImage([s, other], day)) as Buffer;
    expect([...png.subarray(0, 8)]).toEqual(PNG);
    expect(pngSize(png).width).toBe(DAY_IMAGE_WIDTH);
    expect(dayGeometry([s, other], day).blocks.map((b) => b.session)).toEqual([
      s,
    ]);
  });

  it('nothing to draw for an empty day', async () => {
    const other = session('2026-10-15T10:00:00', '2026-10-15T11:30:00');
    expect(await renderDayImage([other], day)).toBeNull();
  });

  it('fills a block in its class-kind colour', async () => {
    const s = session('2026-10-14T10:00:00', '2026-10-14T11:30:00', {
      classKind: 'wyklad',
      className: 'Wykład',
    });
    const png = (await renderDayImage([s], day)) as Buffer;
    const [b] = dayGeometry([s], day).blocks;
    expect(await pixel(png, b.x + b.w - 6, b.y + b.h - 6)).toBe(
      KIND_COLORS.dark.wyklad.bg,
    );
  });
});

describe('events in the plan image', () => {
  const ev = (
    start: string,
    end: string,
    over: Partial<PlanSession> = {},
  ): PlanSession =>
    session(start, end, {
      type: 'event',
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
      room: 'Aula',
      label: 'Kolokwium z całek',
      eventKind: 'kolokwium',
      eventTitle: 'Kolokwium z całek',
      allDay: false,
      ...over,
    });
  const timed = ev('2026-10-14T10:00:00', '2026-10-14T12:00:00');
  const allDay = ev('2026-10-15T00:00:00', '2026-10-16T00:00:00', {
    allDay: true,
    eventKind: 'wyjazd',
  });

  it('outlines a timed event in its kind colour and leaves the inside dark', async () => {
    const png = (await renderWeekImage([timed], W42, null)) as Buffer;
    expect(png).not.toBeNull();
    const g = weekGeometry([timed], W42, null);
    const [b] = g.blocks;
    expect(g.stripH).toBe(0);
    expect(await pixel(png, b.x + 1, b.y + b.h / 2)).toBe(
      EVENT_COLORS.kolokwium,
    );
    expect(await pixel(png, b.x + b.w / 2, b.y + 1)).toBe(
      EVENT_COLORS.kolokwium,
    );
    // Inside, bottom-right: the page colour, not a class fill.
    expect(await pixel(png, b.x + b.w - 8, b.y + b.h - 8)).toBe('#09090b');
  });

  it('draws all-day events in a strip above the hours', async () => {
    const g = weekGeometry([timed, allDay], W42, null);
    expect(g.stripH).toBeGreaterThan(0);
    expect(g.strip).toHaveLength(1);
    // Not a timed block, and the grid starts below the strip.
    expect(g.blocks).toHaveLength(1);
    const [s] = g.strip;
    expect(s.y).toBeGreaterThanOrEqual(g.headerH);
    expect(s.y + s.h).toBeLessThanOrEqual(g.headerH + g.stripH);
    expect(g.blocks[0].y).toBeGreaterThanOrEqual(g.headerH + g.stripH);
    const png = (await renderWeekImage([timed, allDay], W42, null)) as Buffer;
    expect(pngSize(png).height).toBe(g.height);
    expect(await pixel(png, s.x + 1, s.y + s.h / 2)).toBe(EVENT_COLORS.wyjazd);
  });

  it('an all-day event alone still renders, in week and day', async () => {
    expect(await renderWeekImage([allDay], W42, null)).not.toBeNull();
    expect(
      await renderDayImage([allDay], wall('2026-10-15T00:00:00')),
    ).not.toBeNull();
    expect(
      dayGeometry([allDay], wall('2026-10-15T00:00:00')).strip,
    ).toHaveLength(1);
  });
});

describe('class and group labels', () => {
  it('pass through unchanged in the text lines', () => {
    const s = session('2026-10-14T10:00:00', '2026-10-14T11:30:00', {
      classKind: 'laboratorium',
      className: 'Laboratorium',
      groupName: 'Gr. 2',
    });
    const texts = (l: { text: string }[]) => l.map((x) => x.text);
    expect(texts(weekLines(s, '#fff'))).toContain('Laboratorium Gr. 2');
    expect(texts(dayLines(s, '#fff')).join('|')).toContain('Laboratorium');
    expect(texts(dayLines(s, '#fff')).join('|')).toContain('Gr. 2');
  });
});

describe('timetable assessments', () => {
  const texts = (l: { text: string }[]) => l.map((x) => x.text);
  const lab = (over: Partial<PlanSession> = {}) =>
    session('2026-10-14T10:00:00', '2026-10-14T11:30:00', over);
  const test = {
    kind: 'test' as const,
    eventIds: [7],
    titles: ['Kolokwium 1'],
  };
  const quiz = { kind: 'entry_quiz' as const, markId: 3, note: null };

  it('week: the class line carries the badges, unchanged without them', () => {
    expect(texts(weekLines(lab(), '#fff'))).toContain('Laboratorium Gr. 2');
    expect(texts(weekLines(lab({ badges: [test] }), '#fff'))).toContain(
      'Laboratorium Gr. 2 · Test',
    );
    expect(texts(weekLines(lab({ badges: [quiz] }), '#fff'))).toContain(
      'Laboratorium Gr. 2 · Entry quiz',
    );
    expect(texts(weekLines(lab({ badges: [test, quiz] }), '#fff'))).toContain(
      'Laboratorium Gr. 2 · Test · Entry quiz',
    );
    const two = { ...test, eventIds: [7, 8], titles: ['A', 'B'] };
    expect(texts(weekLines(lab({ badges: [two] }), '#fff'))).toContain(
      'Laboratorium Gr. 2 · 2 tests',
    );
  });

  it('day: one extra line per badge, the class line unchanged', () => {
    const t = texts(dayLines(lab({ badges: [test, quiz] }), '#fff'));
    expect(t).toContain('Laboratorium · Gr. 2');
    expect(t).toContain('Test: Kolokwium 1');
    expect(t).toContain('Entry quiz');
    expect(texts(dayLines(lab(), '#fff'))).not.toContain('Entry quiz');
  });

  const exam = (over: Partial<PlanSession> = {}) =>
    lab({
      sessionKind: 'exam',
      classId: null,
      classKind: null,
      className: null,
      groupId: null,
      groupName: null,
      label: 'Egzamin',
      ...over,
    });

  it('exam sessions are labelled "Exam"', () => {
    expect(texts(weekLines(exam(), '#fff'))).toContain('Exam');
    expect(texts(weekLines(exam({ groupName: 'Gr. 1' }), '#fff'))).toContain(
      'Exam Gr. 1',
    );
    expect(texts(dayLines(exam(), '#fff'))).toContain('Exam');
  });

  it('exam blocks are filled in the exam colour, with a legend', async () => {
    const x = exam();
    const png = (await renderWeekImage([x], W42, null)) as Buffer;
    const g = weekGeometry([x], W42, null);
    const [b] = g.blocks;
    expect(await pixel(png, b.x + b.w - 6, b.y + b.h - 6)).toBe(
      EXAM_COLORS.dark.bg,
    );
    expect(await pixel(png, b.x + 2, b.y + b.h / 2)).toBe(EXAM_COLORS.dark.fg);
    expect(g.legendH).toBeGreaterThan(0);
    expect(pngSize(png).height).toBe(g.height);
    // No exam, no legend.
    expect(weekGeometry([lab()], W42, null).legendH).toBe(0);
  });

  it('a timed egzamin event is filled in the exam colour too', async () => {
    const e = lab({
      type: 'event',
      eventKind: 'egzamin',
      eventTitle: 'Egzamin',
      allDay: false,
      classId: null,
      groupId: null,
    });
    const png = (await renderDayImage(
      [e],
      wall('2026-10-14T00:00:00'),
    )) as Buffer;
    const [b] = dayGeometry([e], wall('2026-10-14T00:00:00')).blocks;
    expect(await pixel(png, b.x + b.w - 6, b.y + b.h - 6)).toBe(
      EXAM_COLORS.dark.bg,
    );
  });
});
