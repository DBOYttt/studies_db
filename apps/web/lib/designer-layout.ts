import { PUBLIC_VIEWS, type PublicView } from '@studies/db/constants';
import { SCHEMA_RELATIONS, type SchemaRelation } from './schema-relations';

/** Box geometry of the Projektant diagram (design `BOX` map and edge maths). */
export const DESIGNER_BOX_WIDTH = 190;
export const DESIGNER_HEADER_HEIGHT = 28;
export const DESIGNER_ROW_HEIGHT = 18;
/** Vertical padding of the column list (`padding:4px 0`). */
export const DESIGNER_LIST_PAD = 4;
const MIN_WIDTH = 1200;
const MIN_HEIGHT = 560;
const MARGIN = 20;
const AUTO_GAP_X = 50;
const AUTO_GAP_Y = 40;

/** Fixed box positions (x, y) from the design. */
export const DESIGNER_BOX: Partial<Record<PublicView, [number, number]>> = {
  v_users: [20, 20],
  v_lecturers: [20, 300],
  v_materials: [260, 20],
  v_class_lecturers: [260, 300],
  v_topics: [500, 20],
  v_class_groups: [500, 260],
  v_topic_tags: [500, 420],
  v_subjects: [740, 20],
  v_classes: [740, 240],
  v_tags: [740, 390],
  v_files: [990, 20],
};

export type DesignerHighlight = {
  views: readonly PublicView[];
  /** Highlighted edges; default: every relation whose both ends are in `views`. */
  relations?: readonly SchemaRelation[];
  caption?: string | null;
};

export type DesignerBox = {
  view: PublicView;
  x: number;
  y: number;
  height: number;
  columns: { name: string; key: boolean }[];
  highlighted: boolean;
};

export type DesignerEdge = {
  id: string;
  from: PublicView;
  to: PublicView;
  d: string;
  highlighted: boolean;
};

export type DesignerLayout = {
  width: number;
  height: number;
  boxes: DesignerBox[];
  edges: DesignerEdge[];
};

export const relationId = (r: SchemaRelation) =>
  `${r.from.view}.${r.from.column}>${r.to.view}.${r.to.column}`;

const boxHeight = (n: number) =>
  DESIGNER_HEADER_HEIGHT + 2 * DESIGNER_LIST_PAD + n * DESIGNER_ROW_HEIGHT + 2;

/**
 * Pure layout of the designer: design positions (`positions`, default the
 * design's BOX map), unknown views in rows below, cubic bezier edges between the related column rows. Relations whose
 * column is missing from the live view are dropped.
 */
export function buildDesignerLayout(
  columns: Partial<Record<PublicView, string[]>>,
  highlight?: DesignerHighlight,
  relations: readonly SchemaRelation[] = SCHEMA_RELATIONS,
  positions: Partial<Record<PublicView, [number, number]>> = DESIGNER_BOX,
): DesignerLayout {
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

  const keys = new Map<PublicView, Set<string>>();
  for (const r of live) {
    for (const end of [r.from, r.to]) {
      const s = keys.get(end.view) ?? new Set<string>();
      s.add(end.column);
      keys.set(end.view, s);
    }
  }

  const pos = new Map<PublicView, [number, number]>();
  let fixedBottom = 0;
  for (const v of PUBLIC_VIEWS) {
    const p = positions[v];
    if (!p) continue;
    pos.set(v, p);
    fixedBottom = Math.max(fixedBottom, p[1] + boxHeight(cols(v).length));
  }
  // Views without a design position: rows below the fixed boxes, each row as
  // tall as its tallest box, so tall boxes never overlap the next row.
  const perRow = Math.max(
    1,
    Math.floor((MIN_WIDTH - MARGIN) / (DESIGNER_BOX_WIDTH + AUTO_GAP_X)),
  );
  const missing = PUBLIC_VIEWS.filter((v) => !pos.has(v));
  let autoY = fixedBottom + AUTO_GAP_Y;
  for (let i = 0; i < missing.length; i += perRow) {
    const row = missing.slice(i, i + perRow);
    row.forEach((v, j) => {
      pos.set(v, [MARGIN + j * (DESIGNER_BOX_WIDTH + AUTO_GAP_X), autoY]);
    });
    autoY +=
      Math.max(...row.map((v) => boxHeight(cols(v).length))) + AUTO_GAP_Y;
  }

  const boxes: DesignerBox[] = PUBLIC_VIEWS.map((v) => {
    const [x, y] = pos.get(v) as [number, number];
    const k = keys.get(v);
    return {
      view: v,
      x,
      y,
      height: boxHeight(cols(v).length),
      columns: cols(v).map((name) => ({
        name,
        key: name === 'id' || !!k?.has(name),
      })),
      highlighted: hiViews.has(v),
    };
  });

  const rowY = (v: PublicView, c: string) =>
    (pos.get(v) as [number, number])[1] +
    DESIGNER_HEADER_HEIGHT +
    DESIGNER_LIST_PAD +
    cols(v).indexOf(c) * DESIGNER_ROW_HEIGHT +
    DESIGNER_ROW_HEIGHT / 2;

  const edges: DesignerEdge[] = live.map((r) => {
    const a = r.from.view;
    const b = r.to.view;
    const ax = (pos.get(a) as [number, number])[0];
    const bx = (pos.get(b) as [number, number])[0];
    const y1 = rowY(a, r.from.column);
    const y2 = rowY(b, r.to.column);
    let x1: number;
    let x2: number;
    if (bx > ax) {
      x1 = ax + DESIGNER_BOX_WIDTH;
      x2 = bx;
    } else if (bx < ax) {
      x1 = ax;
      x2 = bx + DESIGNER_BOX_WIDTH;
    } else {
      x1 = ax + DESIGNER_BOX_WIDTH;
      x2 = bx + DESIGNER_BOX_WIDTH;
    }
    const same = bx === ax;
    const dx = same ? 40 : (x2 - x1) / 2;
    const c2 = x2 - (same ? -40 : dx);
    return {
      id: relationId(r),
      from: a,
      to: b,
      d: `M${x1},${y1} C${x1 + dx},${y1} ${c2},${y2} ${x2},${y2}`,
      highlighted: hiRels.has(relationId(r)),
    };
  });

  const width = Math.max(
    MIN_WIDTH,
    ...boxes.map((b) => b.x + DESIGNER_BOX_WIDTH + MARGIN),
  );
  const height = Math.max(
    MIN_HEIGHT,
    ...boxes.map((b) => b.y + b.height + MARGIN),
  );
  return { width, height, boxes, edges };
}
