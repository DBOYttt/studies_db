import { PUBLIC_VIEWS, type PublicView } from '@studies/db/constants';
import { SCHEMA_RELATIONS, type SchemaRelation } from './schema-relations';

/** Box geometry of the Projektant diagram. */
export const DESIGNER_BOX_WIDTH = 190;
export const DESIGNER_HEADER_HEIGHT = 28;
export const DESIGNER_ROW_HEIGHT = 18;
/** Vertical padding of the column list (`padding:4px 0`). */
export const DESIGNER_LIST_PAD = 4;
const MIN_WIDTH = 1160;
const MIN_HEIGHT = 560;
const MARGIN = 20;
/** Horizontal run of an edge out of the FK box before turning. */
const EDGE_STUB = 16;
/** Detour past the right sides when the boxes overlap horizontally. */
const EDGE_DETOUR = 24;
const CORNER = 6;

/**
 * Default box positions (x, y), left to right along the data flow (spec §3):
 * subjects | classes, tags | groups, topic tags, lecturers |
 * class lecturers, users, topics | materials, files, class sessions. The y
 * values leave room for every box with all columns shown, so nothing
 * overlaps in either mode, and keep horizontal corridors free so no edge
 * crosses a box: the id rows y 61 (v_subjects), 141 (v_classes), 211
 * (v_class_groups) and 451 (v_lecturers) stay clear in every column
 * between their box and column 5, where v_class_sessions links to all four.
 */
export const DESIGNER_DEFAULT_POS: Record<PublicView, [number, number]> = {
  v_subjects: [20, 20],
  v_classes: [250, 100],
  v_tags: [250, 290],
  v_class_groups: [480, 170],
  v_topic_tags: [480, 310],
  v_lecturers: [480, 410],
  v_class_lecturers: [710, 230],
  v_users: [710, 340],
  v_topics: [710, 470],
  v_materials: [940, 20],
  v_files: [940, 250],
  v_class_sessions: [940, 640],
};

export type DesignerHighlight = {
  views: readonly PublicView[];
  /** Highlighted edges; default: every relation whose both ends are in `views`. */
  relations?: readonly SchemaRelation[];
  caption?: string | null;
};

export type DesignerColumn = { name: string; key: boolean; label: boolean };

export type DesignerBox = {
  view: PublicView;
  x: number;
  y: number;
  height: number;
  /** Visible columns (compact or all). */
  columns: DesignerColumn[];
  highlighted: boolean;
};

/** Side of the box the marker sits on (the edge leaves/enters that side). */
export type MarkerDir = 'left' | 'right';
export type DesignerMarker = [number, number, MarkerDir];

export type DesignerEdge = {
  id: string;
  from: PublicView;
  to: PublicView;
  /** FK column (row in `from`). */
  fromRow: string;
  /** Referenced PK column (row in `to`). */
  toRow: string;
  /** Orthogonal path (H/V segments, rounded corners) from FK row to PK row. */
  d: string;
  /** Crow's foot at the FK end, single bar at the PK end. */
  markers: { many: DesignerMarker; one: DesignerMarker };
  highlighted: boolean;
};

/** What the pointer/focus is on: a whole box, or one of its rows. */
export type DesignerHover = { view: PublicView; row?: string } | null;

/**
 * Hover state for a row: the row itself when it is an end of some relation,
 * otherwise the whole box (a relation-less row would light nothing and dim
 * the entire diagram).
 */
export function rowHover(
  edges: DesignerEdge[],
  view: PublicView,
  row: string,
): DesignerHover {
  const related = edges.some(
    (e) =>
      (e.from === view && e.fromRow === row) ||
      (e.to === view && e.toRow === row),
  );
  return related ? { view, row } : { view };
}

/**
 * Hover state once a drag ends: keep the box lit only for a mouse that is
 * still over it. Touch never fires `mouseleave`, and a mouse can end the drag
 * outside the box, so anything else clears the dimming.
 */
export function hoverAfterDrag(
  view: PublicView,
  pointerType: string,
  stillOver: boolean,
): DesignerHover {
  return pointerType === 'mouse' && stillOver ? { view } : null;
}

export type DesignerLayout = {
  width: number;
  height: number;
  boxes: DesignerBox[];
  edges: DesignerEdge[];
};

export type DesignerLayoutOptions = {
  highlight?: DesignerHighlight;
  /** Per-view overrides of `DESIGNER_DEFAULT_POS` (e.g. dragged positions). */
  positions?: Partial<Record<PublicView, [number, number]>>;
  /** Show every column instead of keys + label. */
  showAll?: boolean;
};

export const relationId = (r: SchemaRelation) =>
  `${r.from.view}.${r.from.column}>${r.to.view}.${r.to.column}`;

const LABELS = [
  'name',
  'code',
  'title',
  'display_name',
  'original_filename',
  'filename',
];

/** `id`, `*_id` (except `discord_*`), `created_by`, `material_id`. */
const isKeyColumn = (c: string) =>
  c === 'id' ||
  c === 'created_by' ||
  c === 'material_id' ||
  (c.endsWith('_id') && !c.startsWith('discord_'));

/** Label columns of a view: first present of LABELS (v_subjects: name and code). */
function labelColumns(view: PublicView, all: readonly string[]): Set<string> {
  if (view === 'v_subjects') {
    return new Set(['name', 'code'].filter((c) => all.includes(c)));
  }
  const first = LABELS.find((c) => all.includes(c));
  return new Set(first ? [first] : []);
}

/** Compact column list: keys plus the label column(s), in original order. */
export function compactColumns(view: PublicView, all: string[]): string[] {
  const labels = labelColumns(view, all);
  return all.filter((c) => isKeyColumn(c) || labels.has(c));
}

/** Non-finite coordinates (NaN, Infinity) become 0; negatives clamp to 0. */
export const clampPosition = ([x, y]: [number, number]): [number, number] => [
  Number.isFinite(x) ? Math.max(0, x) : 0,
  Number.isFinite(y) ? Math.max(0, y) : 0,
];

const VIEW_SET = new Set<string>(PUBLIC_VIEWS);

/**
 * Stored layout (`{ [view]: [x, y] }` JSON). Malformed JSON, unknown views
 * and entries that are not two finite non-negative numbers are dropped;
 * coordinates are rounded.
 */
export function parseStoredPositions(
  raw: string | null,
): Partial<Record<PublicView, [number, number]>> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: Partial<Record<PublicView, [number, number]>> = {};
  for (const [view, p] of Object.entries(data)) {
    if (!VIEW_SET.has(view) || !Array.isArray(p) || p.length !== 2) continue;
    const [x, y] = p;
    const ok = (n: unknown): n is number =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (!ok(x) || !ok(y)) continue;
    out[view as PublicView] = [Math.round(x), Math.round(y)];
  }
  return out;
}

const boxHeight = (n: number) =>
  DESIGNER_HEADER_HEIGHT + 2 * DESIGNER_LIST_PAD + n * DESIGNER_ROW_HEIGHT + 2;

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * Orthogonal path (x1,y1) -> horizontal to xm -> vertical to y2 ->
 * horizontal to x2, with quadratic corners of up to CORNER px.
 */
function orthoPath(
  x1: number,
  y1: number,
  xm: number,
  y2: number,
  x2: number,
): string {
  if (y1 === y2) return `M${x1},${y1} H${x2}`;
  const sa = sign(xm - x1);
  const sv = sign(y2 - y1);
  const sb = sign(x2 - xm);
  const r = Math.min(
    CORNER,
    Math.abs(y2 - y1) / 2,
    Math.abs(xm - x1),
    Math.abs(x2 - xm),
  );
  return [
    `M${x1},${y1}`,
    `H${xm - sa * r}`,
    `Q${xm},${y1} ${xm},${y1 + sv * r}`,
    `V${y2 - sv * r}`,
    `Q${xm},${y2} ${xm + sb * r},${y2}`,
    `H${x2}`,
  ].join(' ');
}

/**
 * Pure layout of the designer: default positions overridden by `positions`
 * (clamped to x, y >= 0), compact or full column lists, orthogonal edges
 * between the related column rows. Relations whose column is missing from
 * the live view are dropped. The canvas is the max box extent + 20 (min
 * 1160x560).
 */
export function buildDesignerLayout(
  columns: Partial<Record<PublicView, string[]>>,
  opts: DesignerLayoutOptions = {},
  relations: readonly SchemaRelation[] = SCHEMA_RELATIONS,
): DesignerLayout {
  const { highlight, positions = {}, showAll = false } = opts;
  const cols = (v: PublicView) => columns[v] ?? [];
  const live = relations.filter(
    (r) =>
      cols(r.from.view).includes(r.from.column) &&
      cols(r.to.view).includes(r.to.column),
  );
  const hiViews = new Set<PublicView>(highlight?.views ?? []);
  const hiRels = new Set(
    (
      highlight?.relations ??
      live.filter((r) => hiViews.has(r.from.view) && hiViews.has(r.to.view))
    ).map(relationId),
  );

  const relCols = new Map<PublicView, Set<string>>();
  for (const r of live) {
    for (const end of [r.from, r.to]) {
      const s = relCols.get(end.view) ?? new Set<string>();
      s.add(end.column);
      relCols.set(end.view, s);
    }
  }

  const byView = new Map<PublicView, DesignerBox>();
  const boxes: DesignerBox[] = PUBLIC_VIEWS.map((v) => {
    const all = cols(v);
    const visible = showAll ? all : compactColumns(v, all);
    const labels = labelColumns(v, all);
    const rc = relCols.get(v);
    const [x, y] = clampPosition(positions[v] ?? DESIGNER_DEFAULT_POS[v]);
    const b: DesignerBox = {
      view: v,
      x,
      y,
      height: boxHeight(visible.length),
      columns: visible.map((name) => ({
        name,
        key: isKeyColumn(name) || !!rc?.has(name),
        label: labels.has(name),
      })),
      highlighted: hiViews.has(v),
    };
    byView.set(v, b);
    return b;
  });

  /** Centre y of a visible row; a hidden column anchors to the header. */
  const rowY = (b: DesignerBox, c: string) => {
    const i = b.columns.findIndex((col) => col.name === c);
    if (i < 0) return b.y + DESIGNER_HEADER_HEIGHT / 2;
    return (
      b.y +
      DESIGNER_HEADER_HEIGHT +
      DESIGNER_LIST_PAD +
      i * DESIGNER_ROW_HEIGHT +
      DESIGNER_ROW_HEIGHT / 2
    );
  };

  const W = DESIGNER_BOX_WIDTH;
  const edges: DesignerEdge[] = live.map((r) => {
    const a = byView.get(r.from.view) as DesignerBox;
    const b = byView.get(r.to.view) as DesignerBox;
    const y1 = rowY(a, r.from.column);
    const y2 = rowY(b, r.to.column);
    let x1: number;
    let x2: number;
    let xm: number;
    let fromDir: MarkerDir;
    let toDir: MarkerDir;
    if (a.x < b.x + W && b.x < a.x + W) {
      // Overlapping horizontally: both right sides, detour to the right.
      x1 = a.x + W;
      x2 = b.x + W;
      xm = Math.max(x1, x2) + EDGE_DETOUR;
      fromDir = 'right';
      toDir = 'right';
    } else if (b.x > a.x) {
      x1 = a.x + W;
      x2 = b.x;
      xm = x1 + EDGE_STUB;
      fromDir = 'right';
      toDir = 'left';
    } else {
      x1 = a.x;
      x2 = b.x + W;
      xm = x1 - EDGE_STUB;
      fromDir = 'left';
      toDir = 'right';
    }
    return {
      id: relationId(r),
      from: a.view,
      to: b.view,
      fromRow: r.from.column,
      toRow: r.to.column,
      d: orthoPath(x1, y1, xm, y2, x2),
      markers: { many: [x1, y1, fromDir], one: [x2, y2, toDir] },
      highlighted: hiRels.has(relationId(r)),
    };
  });

  const width = Math.max(MIN_WIDTH, ...boxes.map((b) => b.x + W + MARGIN));
  const height = Math.max(
    MIN_HEIGHT,
    ...boxes.map((b) => b.y + b.height + MARGIN),
  );
  return { width, height, boxes, edges };
}

/**
 * End marker shape at a box side: a crow's foot ("many", three prongs
 * meeting 10px out, within the straight part of the edge stub) or a single
 * bar 7px out ("one").
 */
export function markerPath(
  [x, y, dir]: DesignerMarker,
  kind: 'many' | 'one',
): string {
  const o = dir === 'right' ? 1 : -1;
  if (kind === 'one') return `M${x + o * 7},${y - 6} V${y + 6}`;
  const t = x + o * 10;
  return `M${t},${y} L${x},${y - 6} M${t},${y} L${x},${y} M${t},${y} L${x},${y + 6}`;
}
