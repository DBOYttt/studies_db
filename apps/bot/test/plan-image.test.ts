import { createCanvas, loadImage } from '@napi-rs/canvas';
import { KIND_COLORS } from '@studies/db/constants';
import type { PlanSession } from '@studies/db/plan';
import { describe, expect, it } from 'vitest';
import {
  DAY_IMAGE_WIDTH,
  dayGeometry,
  renderDayImage,
  renderWeekImage,
  WEEK_IMAGE_WIDTH,
  weekGeometry,
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

  it('marks today and labels days "Pon 12.10"', () => {
    const g = weekGeometry([lab], W42, wall('2026-10-14T12:00:00'));
    expect(g.columns.map((c) => c.label)).toEqual([
      'Pon 12.10',
      'Wt 13.10',
      'Śr 14.10',
      'Czw 15.10',
      'Pt 16.10',
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
