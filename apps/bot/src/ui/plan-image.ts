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
import { CLASS_NAMES, KIND_COLORS } from '@studies/db/constants';
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
}

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
  const yOf = (min: number) =>
    spec.headerH + ((min - startMin) / 60) * spec.hourPx;
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
  return {
    width: s(spec.width),
    height: s(height),
    startMin,
    endMin,
    headerH: s(spec.headerH),
    gutter: s(spec.gutter),
    hourPx: s(spec.hourPx),
    columns: columns.map((c) => ({ ...c, x: s(c.x), w: s(c.w) })),
    blocks: blocks.map((b) => ({
      ...b,
      x: s(b.x),
      y: s(b.y),
      w: s(b.w),
      h: s(b.h),
    })),
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

const STRIPE = 3;
const PAD_X = 6;
const PAD_Y = 5;
const LEADING = 1.3;

function drawBlock(
  ctx: SKRSContext2D,
  b: Block,
  lines: (s: PlanSession, ink: string) => Line[],
): void {
  const s = b.session;
  const colors = s.classKind
    ? KIND_COLORS.dark[s.classKind]
    : { bg: C.surface, fg: C.faint };
  ctx.save();
  if (s.status === 'cancelled') ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, 4);
  ctx.clip();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = colors.fg;
  ctx.fillRect(b.x, b.y, STRIPE, b.h);

  // Narrow lanes (several overlapping sessions) get tighter padding.
  const padX = b.w < 48 ? 3 : PAD_X;
  const x = b.x + STRIPE + padX - 1;
  const maxW = b.w - STRIPE - padX * 2 + 2;
  const bottom = b.y + b.h - PAD_Y + 2;
  let y = b.y + PAD_Y;
  ctx.textBaseline = 'top';
  for (const [i, l] of lines(s, colors.fg).entries()) {
    const h = l.size * LEADING;
    // The first line is always drawn (clipped), the rest only when whole.
    if (i > 0 && y + h > bottom) break;
    ctx.font = font(l.weight, l.size);
    let t = ellipsize(ctx, l.text, maxW);
    // A bare "…" says nothing: the first line (the code) is then cut at the
    // block edge instead, and in a narrow lane, a stub like "W…" ends the
    // block after it.
    if (i === 0 && t.length < 2) t = l.text;
    else if (!t || (i > 0 && t !== l.text && t.length < 4)) break;
    ctx.fillStyle = l.color;
    ctx.fillText(t, x, y);
    if (l.strike) {
      const w = ctx.measureText(t).width;
      ctx.fillRect(x, y + l.size * 0.55, w, Math.max(1, l.size / 12));
    }
    y += h;
  }
  ctx.restore();
}

function draw(
  g: Geometry,
  lines: (s: PlanSession, ink: string) => Line[],
): Canvas {
  const canvas = createCanvas(g.width, g.height);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  const W = g.width / SCALE;
  const H = g.height / SCALE;
  const headerH = g.headerH / SCALE;
  const gutter = g.gutter / SCALE;
  const hourPx = g.hourPx / SCALE;
  const yOf = (min: number) => headerH + ((min - g.startMin) / 60) * hourPx;
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
    const atTop = y - headerH < 8;
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

  for (const b of g.blocks) {
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
  if (g.blocks.length === 0) return null;
  ensureFonts();
  return draw(g, weekLines).encode('png');
}

/** One day as a PNG; null when the day has no sessions. */
export async function renderDayImage(
  sessions: PlanSession[],
  day: Date,
): Promise<Buffer | null> {
  const g = dayGeometry(sessions, day);
  if (g.blocks.length === 0) return null;
  ensureFonts();
  return draw(g, dayLines).encode('png');
}
