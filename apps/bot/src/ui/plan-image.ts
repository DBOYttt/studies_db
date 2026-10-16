/**
 * The plan as a PNG timetable grid (week and day), drawn with @napi-rs/canvas
 * in the web's dark palette. Layout (slots, lanes, shown days) is shared with
 * the web's WeekView through `@studies/db/plan`.
 *
 * Session times are wall Dates (UTC fields = Europe/Warsaw wall clock): only
 * UTC fields are read, no time zone conversion.
 */
import { fileURLToPath } from 'node:url';
import {
  type Canvas,
  createCanvas,
  GlobalFonts,
  type SKRSContext2D,
} from '@napi-rs/canvas';
import {
  CLASS_NAMES,
  EVENT_KINDS,
  type EventKind,
  KIND_COLORS,
} from '@studies/db/constants';
import {
  DAY_END_MIN,
  DAY_START_MIN,
  type IsoWeek,
  layoutDay,
  type PlanSession,
  SLOT_MIN,
  slotRange,
  weekDays,
} from '@studies/db/plan';

/** Device pixels per layout unit. */
const SCALE = 2;
export const WEEK_IMAGE_WIDTH = 1100;
export const DAY_IMAGE_WIDTH = 700;

/** Web dark palette (apps/web/app/globals.css, prefers-color-scheme: dark). */
const C = {
  page: '#09090b',
  surface: '#18181b',
  line: '#27272a',
  lineStrong: '#3f3f46',
  fg: '#e4e4e7',
  muted: '#a1a1aa',
  faint: '#8e8e98',
  selected: '#1c3349',
  /** --list-hover at 40% over --page, the web's today column. */
  todayCol: '#0e141b',
  accentInk: '#84b9e2',
  errFg: '#fca5a5',
};

/** Event outline colours per kind (dark palette; events are outlined, not filled). */
export const EVENT_COLORS: Record<EventKind, string> = {
  kolokwium: '#e5a04b',
  egzamin: '#e07a7a',
  wyjazd: '#6fb98f',
  zajecia_dodatkowe: '#84b9e2',
  inne: '#a1a1aa',
};

const FONT = 'Geist';
let fontsReady = false;
function ensureFonts(): void {
  if (fontsReady) return;
  for (const w of ['Regular', 'Medium', 'SemiBold']) {
    const path = fileURLToPath(
      new URL(`../../assets/fonts/Geist-${w}.ttf`, import.meta.url),
    );
    if (!GlobalFonts.registerFromPath(path, FONT)) {
      throw new Error(`cannot load font ${path}`);
    }
  }
  fontsReady = true;
}

/* ---------- geometry (device pixels) ---------- */

const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const DAY_NAMES = ['Nd', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
/** `Pon 12.10` */
const dayLabel = (d: Date) =>
  `${DAY_NAMES[d.getUTCDay()]} ${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}`;
const midnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export interface Column {
  day: Date;
  label: string;
  today: boolean;
  x: number;
  w: number;
}
export interface Block {
  session: PlanSession;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Geometry {
  width: number;
  height: number;
  /** Shown wall-clock window, minutes from midnight. */
  startMin: number;
  endMin: number;
  headerH: number;
  gutter: number;
  hourPx: number;
  columns: Column[];
  blocks: Block[];
  /** Height of the all-day strip under the header; 0 without all-day events. */
  stripH: number;
  /** All-day events, stacked per day in the strip. */
  strip: Block[];
}

const isAllDay = (s: PlanSession) => s.type === 'event' && s.allDay === true;
const STRIP_ROW = 22;

/**
 * The sessions' grid window widened by 30 min each side, on half hours, at
 * least 08:00–16:00, within the shared 07:00–20:00 day.
 */
function window(sessions: PlanSession[]): { startMin: number; endMin: number } {
  let lo = 8 * 60;
  let hi = 16 * 60;
  for (const s of sessions) {
    const { from, to } = slotRange(s);
    lo = Math.min(
      lo,
      Math.floor((DAY_START_MIN + from * SLOT_MIN - 30) / 30) * 30,
    );
    hi = Math.max(
      hi,
      Math.ceil((DAY_START_MIN + to * SLOT_MIN + 30) / 30) * 30,
    );
  }
  return {
    startMin: Math.max(lo, DAY_START_MIN),
    endMin: Math.min(hi, DAY_END_MIN),
  };
}

interface Spec {
  width: number;
  gutter: number;
  headerH: number;
  hourPx: number;
  bottom: number;
}
const WEEK_SPEC: Spec = {
  width: WEEK_IMAGE_WIDTH / SCALE,
  gutter: 38,
  headerH: 30,
  hourPx: 46,
  bottom: 4,
};
const DAY_SPEC: Spec = {
  width: DAY_IMAGE_WIDTH / SCALE,
  gutter: 38,
  headerH: 30,
  hourPx: 60,
  bottom: 4,
};

function geometry(
  spec: Spec,
  days: Date[],
  sessions: PlanSession[],
  today: Date | null,
): Geometry {
  const allDay = sessions.filter(isAllDay);
  sessions = sessions.filter((s) => !isAllDay(s));
  const { startMin, endMin } = window(sessions);
  const todayKey = today ? dayKey(today) : null;
  const colW = (spec.width - spec.gutter) / days.length;
  const columns: Column[] = days.map((day, i) => ({
    day,
    label: dayLabel(day),
    today: dayKey(day) === todayKey,
    x: spec.gutter + i * colW,
    w: colW,
  }));
  const rows = Math.max(
    0,
    ...days.map(
      (d) => allDay.filter((s) => dayKey(s.startsAt) === dayKey(d)).length,
    ),
  );
  const stripH = rows > 0 ? rows * STRIP_ROW + 4 : 0;
  const yOf = (min: number) =>
    spec.headerH + stripH + ((min - startMin) / 60) * spec.hourPx;
  const strip: Block[] = [];
  for (const col of columns) {
    allDay
      .filter((s) => dayKey(s.startsAt) === dayKey(col.day))
      .forEach((session, r) => {
        strip.push({
          session,
          x: col.x + 2,
          y: spec.headerH + 2 + r * STRIP_ROW,
          w: col.w - 4,
          h: STRIP_ROW - 2,
        });
      });
  }
  const blocks: Block[] = [];
  for (const col of columns) {
    const key = dayKey(col.day);
    const lanes = layoutDay(sessions.filter((s) => dayKey(s.startsAt) === key));
    for (const { session, col: lane, cols } of lanes) {
      const { from, to } = slotRange(session);
      const laneW = col.w / cols;
      const top = yOf(DAY_START_MIN + from * SLOT_MIN);
      const bottom = yOf(DAY_START_MIN + to * SLOT_MIN);
      blocks.push({
        session,
        x: col.x + lane * laneW + 2,
        y: top + 1,
        w: laneW - 4,
        h: bottom - top - 2,
      });
    }
  }
  const height = Math.ceil(yOf(endMin) + spec.bottom);
  const s = (n: number) => n * SCALE;
  const scaled = (b: Block): Block => ({
    ...b,
    x: s(b.x),
    y: s(b.y),
    w: s(b.w),
    h: s(b.h),
  });
  return {
    width: s(spec.width),
    height: s(height),
    startMin,
    endMin,
    headerH: s(spec.headerH),
    gutter: s(spec.gutter),
    hourPx: s(spec.hourPx),
    columns: columns.map((c) => ({ ...c, x: s(c.x), w: s(c.w) })),
    blocks: blocks.map(scaled),
    stripH: s(stripH),
    strip: strip.map(scaled),
  };
}

/** Week grid geometry, in device pixels. `today` is a wall Date. */
export function weekGeometry(
  sessions: PlanSession[],
  week: IsoWeek,
  today: Date | null,
): Geometry {
  const days = weekDays(sessions, week);
  const keys = new Set(days.map(dayKey));
  const shown = sessions.filter((s) => keys.has(dayKey(s.startsAt)));
  return geometry(WEEK_SPEC, days, shown, today);
}

/** Day column geometry, in device pixels. `day` is a wall Date. */
export function dayGeometry(sessions: PlanSession[], day: Date): Geometry {
  const d = midnight(day);
  const key = dayKey(d);
  const shown = sessions.filter((s) => dayKey(s.startsAt) === key);
  return geometry(DAY_SPEC, [d], shown, null);
}

/* ---------- drawing (layout units; the context is scaled) ---------- */

const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

/** `s` cut with "…" to fit `maxW`; '' when not even "…" fits. */
function ellipsize(ctx: SKRSContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${s.slice(0, mid).trimEnd()}…`).width <= maxW) {
      lo = mid;
    } else hi = mid - 1;
  }
  if (lo === 0) return ctx.measureText('…').width <= maxW ? '…' : '';
  return `${s.slice(0, lo).trimEnd()}…`;
}

interface Line {
  text: string;
  weight: number;
  size: number;
  color: string;
  strike?: boolean;
  /** Event lines: a drawn kind mark before the text (emoji fonts are not a given). */
  mark?: EventKind;
}

/** Draws the kind's mark in a `size` square at (x, y): the image's "symbol". */
function drawMark(
  ctx: SKRSContext2D,
  kind: EventKind,
  x: number,
  y: number,
  size: number,
): void {
  const c = EVENT_COLORS[kind];
  const m = size / 2;
  ctx.save();
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  switch (kind) {
    case 'kolokwium':
      ctx.rect(x + 1.5, y + 1.5, size - 3, size - 3);
      ctx.fill();
      break;
    case 'egzamin':
      ctx.moveTo(x + m, y);
      ctx.lineTo(x + size, y + m);
      ctx.lineTo(x + m, y + size);
      ctx.lineTo(x, y + m);
      ctx.closePath();
      ctx.fill();
      break;
    case 'wyjazd':
      ctx.moveTo(x + m, y + 0.5);
      ctx.lineTo(x + size, y + size - 0.5);
      ctx.lineTo(x, y + size - 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case 'zajecia_dodatkowe':
      ctx.moveTo(x + m, y + 1);
      ctx.lineTo(x + m, y + size - 1);
      ctx.moveTo(x + 1, y + m);
      ctx.lineTo(x + size - 1, y + m);
      ctx.stroke();
      break;
    default:
      ctx.arc(x + m, y + m, m - 1, 0, Math.PI * 2);
      ctx.fill();
  }
  ctx.restore();
}

const kindOf = (s: PlanSession) =>
  s.className ?? (s.classKind ? CLASS_NAMES[s.classKind] : s.label);
const join = (...parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => !!p).join(' · ');

function weekLines(s: PlanSession, ink: string): Line[] {
  const cancelled = s.status === 'cancelled';
  const lines: Line[] = [
    {
      text: s.subjectCode || s.subjectName,
      weight: 600,
      size: 11,
      color: ink,
      strike: cancelled,
    },
  ];
  if (cancelled) {
    lines.push({ text: '(odwołane)', weight: 500, size: 10.5, color: C.errFg });
  }
  const kind = [kindOf(s), s.groupName].filter(Boolean).join(' ');
  if (kind) lines.push({ text: kind, weight: 400, size: 10.5, color: C.fg });
  if (s.room) {
    lines.push({ text: s.room, weight: 400, size: 10.5, color: C.muted });
  }
  if (s.lecturerName) {
    lines.push({
      text: s.lecturerName,
      weight: 400,
      size: 10.5,
      color: C.muted,
    });
  }
  return lines;
}

function dayLines(s: PlanSession, ink: string): Line[] {
  const cancelled = s.status === 'cancelled';
  const lines: Line[] = [
    {
      text: join(`${hhmm(s.startsAt)}–${hhmm(s.endsAt)}`, s.subjectCode),
      weight: 500,
      size: 11.5,
      color: ink,
    },
    {
      text: s.subjectName || s.subjectCode,
      weight: 600,
      size: 13,
      color: C.fg,
      strike: cancelled,
    },
  ];
  if (cancelled) {
    lines.push({ text: '(odwołane)', weight: 500, size: 11.5, color: C.errFg });
  }
  const kind = join(kindOf(s), s.groupName);
  if (kind) lines.push({ text: kind, weight: 400, size: 11.5, color: C.fg });
  const where = join(s.room, s.lecturerName);
  if (where) {
    lines.push({ text: where, weight: 400, size: 11.5, color: C.muted });
  }
  return lines;
}

const eventTitle = (s: PlanSession) => s.eventTitle ?? s.label;

function weekEventLines(s: PlanSession, ink: string): Line[] {
  const lines: Line[] = [
    {
      text: eventTitle(s),
      weight: 600,
      size: 11,
      color: ink,
      mark: s.eventKind ?? 'inne',
    },
  ];
  if (s.subjectCode) {
    lines.push({ text: s.subjectCode, weight: 400, size: 10.5, color: C.fg });
  }
  if (s.room) {
    lines.push({ text: s.room, weight: 400, size: 10.5, color: C.muted });
  }
  return lines;
}

function dayEventLines(s: PlanSession, ink: string): Line[] {
  const time =
    s.endsAt > s.startsAt
      ? `${hhmm(s.startsAt)}–${hhmm(s.endsAt)}`
      : hhmm(s.startsAt);
  const lines: Line[] = [
    { text: time, weight: 500, size: 11.5, color: ink },
    {
      text: eventTitle(s),
      weight: 600,
      size: 13,
      color: C.fg,
      mark: s.eventKind ?? 'inne',
    },
  ];
  const kind = s.eventKind ? EVENT_KINDS[s.eventKind].label : '';
  const what = join(kind, s.subjectCode);
  if (what) lines.push({ text: what, weight: 400, size: 11.5, color: C.fg });
  if (s.room) {
    lines.push({ text: s.room, weight: 400, size: 11.5, color: C.muted });
  }
  return lines;
}

type LinesFn = (s: PlanSession, ink: string) => Line[];
/** Class lines for sessions, event lines for events. */
const linesFor =
  (cls: LinesFn, ev: LinesFn): LinesFn =>
  (s, ink) =>
    s.type === 'event' ? ev(s, ink) : cls(s, ink);

const STRIPE = 3;
const PAD_X = 6;
const PAD_Y = 5;
const LEADING = 1.3;
const OUTLINE = 1.5;

function drawBlock(ctx: SKRSContext2D, b: Block, lines: LinesFn): void {
  const s = b.session;
  const isEvent = s.type === 'event';
  const outline = EVENT_COLORS[s.eventKind ?? 'inne'];
  const colors = isEvent
    ? { bg: C.page, fg: outline }
    : s.classKind
      ? KIND_COLORS.dark[s.classKind]
      : { bg: C.surface, fg: C.faint };
  ctx.save();
  if (s.status === 'cancelled') ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, 4);
  ctx.clip();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  const stripe = isEvent ? OUTLINE : STRIPE;
  ctx.fillStyle = colors.fg;
  if (isEvent) {
    // Outlined: a frame of OUTLINE units, the inside stays the page colour.
    ctx.fillRect(b.x, b.y, b.w, OUTLINE);
    ctx.fillRect(b.x, b.y + b.h - OUTLINE, b.w, OUTLINE);
    ctx.fillRect(b.x, b.y, OUTLINE, b.h);
    ctx.fillRect(b.x + b.w - OUTLINE, b.y, OUTLINE, b.h);
  } else {
    ctx.fillRect(b.x, b.y, STRIPE, b.h);
  }

  // Narrow lanes (several overlapping sessions) get tighter padding.
  const padX = b.w < 48 ? 3 : PAD_X;
  const x = b.x + stripe + padX - 1;
  const maxW = b.w - stripe - padX * 2 + 2;
  const padY = b.h < 30 ? 3 : PAD_Y;
  const bottom = b.y + b.h - padY + 2;
  let y = b.y + padY;
  ctx.textBaseline = 'top';
  for (const [i, l] of lines(s, colors.fg).entries()) {
    const h = l.size * LEADING;
    // The first line is always drawn (clipped), the rest only when whole.
    if (i > 0 && y + h > bottom) break;
    ctx.font = font(l.weight, l.size);
    const markW = l.mark ? l.size * 0.8 + 4 : 0;
    let t = ellipsize(ctx, l.text, maxW - markW);
    // A bare "…" says nothing: the first line (the code) is then cut at the
    // block edge instead, and in a narrow lane, a stub like "W…" ends the
    // block after it.
    if (i === 0 && t.length < 2) t = l.text;
    else if (!t || (i > 0 && t !== l.text && t.length < 4)) break;
    ctx.fillStyle = l.color;
    if (l.mark) drawMark(ctx, l.mark, x, y + l.size * 0.1, l.size * 0.8);
    ctx.fillText(t, x + markW, y);
    if (l.strike) {
      const w = ctx.measureText(t).width;
      ctx.fillRect(x, y + l.size * 0.55, w, Math.max(1, l.size / 12));
    }
    y += h;
  }
  ctx.restore();
}

function draw(g: Geometry, lines: LinesFn): Canvas {
  const canvas = createCanvas(g.width, g.height);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  const W = g.width / SCALE;
  const H = g.height / SCALE;
  const headerH = g.headerH / SCALE;
  const gutter = g.gutter / SCALE;
  const hourPx = g.hourPx / SCALE;
  const stripH = g.stripH / SCALE;
  const yOf = (min: number) =>
    headerH + stripH + ((min - g.startMin) / 60) * hourPx;
  const cols = g.columns.map((c) => ({
    ...c,
    x: c.x / SCALE,
    w: c.w / SCALE,
  }));

  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, W, H);

  // Header row and today's column.
  ctx.fillStyle = C.surface;
  ctx.fillRect(0, 0, W, headerH);
  for (const c of cols) {
    if (!c.today) continue;
    ctx.fillStyle = C.selected;
    ctx.fillRect(c.x, 0, c.w, headerH);
    ctx.fillStyle = C.todayCol;
    ctx.fillRect(c.x, headerH, c.w, H - headerH);
  }

  // Hour lines and labels.
  ctx.fillStyle = C.line;
  for (let m = Math.ceil(g.startMin / 60) * 60; m < g.endMin; m += 60) {
    ctx.fillRect(gutter, yOf(m), W - gutter, 0.5);
  }
  // Labels centred on their line; one at the very top goes just below it.
  ctx.font = font(400, 10);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.faint;
  for (let m = Math.ceil(g.startMin / 60) * 60; m < g.endMin; m += 60) {
    const y = yOf(m);
    const atTop = y - headerH - stripH < 8;
    ctx.textBaseline = atTop ? 'top' : 'middle';
    ctx.fillText(`${pad2(m / 60)}:00`, gutter - 6, atTop ? y + 3 : y);
  }

  // Column rules and day headers.
  for (const c of cols) {
    ctx.fillStyle = C.line;
    ctx.fillRect(c.x, 0, 0.5, H);
  }
  ctx.fillStyle = C.lineStrong;
  ctx.fillRect(0, headerH - 0.5, W, 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const c of cols) {
    const [name, date] = c.label.split(' ');
    ctx.font = font(600, 12);
    ctx.fillStyle = C.fg;
    ctx.fillText(name, c.x + 8, headerH / 2);
    const nameW = ctx.measureText(name).width;
    ctx.font = font(400, 11);
    ctx.fillStyle = c.today ? C.accentInk : C.muted;
    ctx.fillText(date, c.x + 8 + nameW + 5, headerH / 2);
  }

  if (stripH > 0) {
    ctx.fillStyle = C.lineStrong;
    ctx.fillRect(0, headerH + stripH - 0.5, W, 0.5);
  }
  for (const b of [...g.blocks, ...g.strip]) {
    drawBlock(
      ctx,
      {
        ...b,
        x: b.x / SCALE,
        y: b.y / SCALE,
        w: b.w / SCALE,
        h: b.h / SCALE,
      },
      lines,
    );
  }
  return canvas;
}

/** The week as a PNG; null when no session falls on a shown day. */
export async function renderWeekImage(
  sessions: PlanSession[],
  week: IsoWeek,
  today: Date | null,
): Promise<Buffer | null> {
  const g = weekGeometry(sessions, week, today);
  if (g.blocks.length === 0 && g.strip.length === 0) return null;
  ensureFonts();
  return draw(g, linesFor(weekLines, weekEventLines)).encode('png');
}

/** One day as a PNG; null when the day has no sessions. */
export async function renderDayImage(
  sessions: PlanSession[],
  day: Date,
): Promise<Buffer | null> {
  const g = dayGeometry(sessions, day);
  if (g.blocks.length === 0 && g.strip.length === 0) return null;
  ensureFonts();
  return draw(g, linesFor(dayLines, dayEventLines)).encode('png');
}
