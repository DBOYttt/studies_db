'use client';

import {
  ArrowCounterClockwise,
  ArrowsInLineHorizontal,
  Key,
  Minus,
  Plus,
  Table,
} from '@phosphor-icons/react';
import type { PublicView } from '@studies/db/constants';
import Link from 'next/link';
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildDesignerLayout,
  clampPosition,
  DESIGNER_BOX_WIDTH,
  DESIGNER_HEADER_HEIGHT,
  DESIGNER_ROW_HEIGHT,
  type DesignerEdge,
  type DesignerHighlight,
  type DesignerHover,
  hoverAfterDrag,
  markerPath,
  parseStoredPositions,
  rowHover,
} from '@/lib/designer-layout';
import { plural } from '@/lib/format';

/** localStorage key shared by /schema and the subject Schemat tab. */
const STORAGE_KEY = 'studiesdb.schemaLayout.v1';
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;
/** Pointer movement (screen px) below which a press is a click. */
const DRAG_THRESHOLD = 4;
const KEY_STEP = 16;
const KEY_STEP_BIG = 64;

type Positions = Partial<Record<PublicView, [number, number]>>;
type Hover = DesignerHover;
type Drag = {
  view: PublicView;
  pointerId: number;
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  zoom: number;
  moved: boolean;
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const roundZoom = (z: number) => Math.round(z * 10) / 10;

function loadPositions(): Positions {
  try {
    return parseStoredPositions(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function savePositions(p: Positions) {
  try {
    if (Object.keys(p).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable (private mode, quota): keep the layout in memory.
  }
}

/** Does the hover state light this edge (whole box, or one column row)? */
function edgeHot(e: DesignerEdge, hover: Hover): boolean {
  if (!hover) return false;
  if (hover.row) {
    return (
      (e.from === hover.view && e.fromRow === hover.row) ||
      (e.to === hover.view && e.toRow === hover.row)
    );
  }
  return e.from === hover.view || e.to === hover.view;
}

const toolBtn =
  'inline-flex h-[26px] min-w-[26px] items-center justify-center gap-1.5 rounded border border-line-strong bg-page px-2 text-fg transition-colors duration-150 hover:border-accent hover:text-accent-ink active:translate-y-px disabled:pointer-events-none disabled:opacity-40';

/**
 * phpMyAdmin "Projektant": table boxes (key and label columns by default,
 * all with "Show all columns") with orthogonal edges between related
 * column rows, crow's foot at the FK end and a bar at the PK end.
 *
 * - Zoom: `−` / `+` (0.6–1.5), "Dopasuj" fits the container width (0.6–1,
 *   re-fitted on resize until zoomed by hand); below 0.6 the canvas scrolls.
 * - Drag a box by its header (mouse, pen, touch); under 4px it is a click
 *   that opens /tables/<view>. Arrow keys move a focused header (Shift: 64).
 *   Positions persist in localStorage; "Reset layout" clears them.
 * - Hover/focus a box to light its edges and joined rows (others dim);
 *   hover a key row to light just its relation(s).
 * - `highlight` marks the current selection in the accent colour and shows
 *   its caption above the diagram.
 */
export function DesignerDiagram({
  columns,
  highlight,
}: {
  columns: Partial<Record<PublicView, string[]>>;
  highlight?: DesignerHighlight;
}) {
  const [positions, setPositions] = useState<Positions>({});
  const posRef = useRef<Positions>({});
  const [showAll, setShowAll] = useState(false);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [avail, setAvail] = useState<number | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [dragging, setDragging] = useState<{
    view: PublicView;
    zoom: number;
  } | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const viewport = useRef<HTMLElement>(null);

  const setPos = (next: Positions, persist: boolean) => {
    posRef.current = next;
    setPositions(next);
    if (persist) savePositions(next);
  };

  useEffect(() => {
    const stored = loadPositions();
    posRef.current = stored;
    setPositions(stored);
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    setAvail(el.clientWidth);
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => buildDesignerLayout(columns, { highlight, positions, showAll }),
    [columns, highlight, positions, showAll],
  );

  const fit = avail === null ? 1 : clamp(avail / layout.width, ZOOM_MIN, 1);
  // While dragging the zoom is frozen so the box stays under the pointer
  // even if the canvas grows.
  const zoom = dragging?.zoom ?? manualZoom ?? fit;

  const zoomBy = (d: number) =>
    setManualZoom(roundZoom(clamp(zoom + d, ZOOM_MIN, ZOOM_MAX)));

  const boxPos = (view: PublicView): [number, number] => {
    const b = layout.boxes.find((x) => x.view === view);
    return b ? [b.x, b.y] : [0, 0];
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>, view: PublicView) => {
    if (e.button !== 0) return;
    suppressClick.current = false;
    const [ox, oy] = boxPos(view);
    drag.current = {
      view,
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox,
      oy,
      zoom,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragging({ view: d.view, zoom: d.zoom });
      setHover({ view: d.view });
    }
    const p = clampPosition([
      Math.round(d.ox + dx / d.zoom),
      Math.round(d.oy + dy / d.zoom),
    ]);
    setPos({ ...posRef.current, [d.view]: p }, false);
  };

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (d.moved) {
      suppressClick.current = true;
      setDragging(null);
      savePositions(posRef.current);
      const box = e.currentTarget.closest('[role="group"]');
      setHover(hoverAfterDrag(d.view, e.pointerType, !!box?.matches(':hover')));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, view: PublicView) => {
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const dv = delta[e.key];
    if (!dv) return;
    e.preventDefault();
    const [x, y] = boxPos(view);
    setPos(
      { ...posRef.current, [view]: clampPosition([x + dv[0], y + dv[1]]) },
      true,
    );
  };

  const reset = () => {
    setPos({}, false);
    savePositions({});
  };

  // Hover: lit edges, the rows at their ends, and the boxes they touch.
  const hot = new Set(
    layout.edges.filter((e) => edgeHot(e, hover)).map((e) => e.id),
  );
  const hotRows = new Set<string>();
  const hotViews = new Set<PublicView>(hover ? [hover.view] : []);
  for (const e of layout.edges) {
    if (!hot.has(e.id)) continue;
    hotRows.add(`${e.from}.${e.fromRow}`);
    hotRows.add(`${e.to}.${e.toRow}`);
    hotViews.add(e.from);
    hotViews.add(e.to);
  }
  const dim = hover !== null;
  // Lit edges last so they are drawn on top.
  const rank = (e: DesignerEdge) => (hot.has(e.id) ? 2 : e.highlighted ? 1 : 0);
  const edges = [...layout.edges].sort((a, b) => rank(a) - rank(b));
  const caption = highlight?.caption;
  const zoomPct = Math.round(zoom * 100);

  return (
    <div className="flex flex-col gap-3">
      {caption && (
        <p className="inline-flex items-center gap-2 self-start rounded-full border border-accent bg-selected px-3 py-1 font-mono text-xs text-fg">
          <Key size={12} weight="fill" aria-hidden className="text-key" />
          {caption}
        </p>
      )}
      <div
        role="toolbar"
        aria-label="Schema view"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]"
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            className={toolBtn}
            disabled={zoom <= ZOOM_MIN + 1e-9}
            onClick={() => zoomBy(-ZOOM_STEP)}
          >
            <Minus size={12} weight="bold" aria-hidden />
          </button>
          <output
            aria-label="Zoom level"
            className="w-[44px] text-center font-mono text-xs text-muted tabular-nums"
          >
            {zoomPct}%
          </output>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            className={toolBtn}
            disabled={zoom >= ZOOM_MAX - 1e-9}
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            <Plus size={12} weight="bold" aria-hidden />
          </button>
          <button
            type="button"
            className={`${toolBtn} ml-1`}
            aria-pressed={manualZoom === null}
            onClick={() => setManualZoom(null)}
          >
            <ArrowsInLineHorizontal size={13} aria-hidden />
            Fit
          </button>
        </div>
        <button type="button" className={toolBtn} onClick={reset}>
          <ArrowCounterClockwise size={13} aria-hidden />
          Reset layout
        </button>
        <span className="hidden flex-1 sm:block" />
        <label className="flex cursor-pointer items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Show all columns
        </label>
      </div>
      <section
        ref={viewport}
        aria-label="Database schema"
        className="shrink-0 overflow-auto rounded-md border border-line-strong bg-bar"
        style={{
          backgroundImage:
            'radial-gradient(var(--border-strong) 1px, transparent 1px)',
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
        }}
      >
        <div
          className="relative"
          style={{ width: layout.width * zoom, height: layout.height * zoom }}
        >
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `scale(${zoom})`,
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              className="absolute inset-0"
              aria-hidden
            >
              {edges.map((e) => {
                const isHot = hot.has(e.id);
                const accent = isHot || e.highlighted;
                return (
                  <g
                    key={e.id}
                    data-edge={e.id}
                    fill="none"
                    stroke={accent ? 'var(--accent)' : 'var(--edge)'}
                    strokeWidth={accent ? 2 : 1.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={dim && !isHot ? 0.25 : 1}
                    className="transition-opacity duration-150"
                  >
                    <path d={e.d} />
                    <path d={markerPath(e.markers.many, 'many')} />
                    <path d={markerPath(e.markers.one, 'one')} />
                  </g>
                );
              })}
            </svg>
            {layout.boxes.map((b) => {
              const isDragged = dragging?.view === b.view;
              const active = b.highlighted || hover?.view === b.view;
              const faded = dim && !hotViews.has(b.view);
              return (
                // biome-ignore lint/a11y/useSemanticElements: a fieldset would change the box layout; role="group" only names the draggable box.
                <div
                  key={b.view}
                  role="group"
                  aria-label={`${b.view}, drag the header to move`}
                  onMouseEnter={() => setHover({ view: b.view })}
                  onMouseLeave={() => {
                    if (!drag.current) setHover(null);
                  }}
                  onFocus={() => setHover({ view: b.view })}
                  onBlur={() => setHover(null)}
                  style={{ left: b.x, top: b.y, width: DESIGNER_BOX_WIDTH }}
                  className={`absolute overflow-hidden rounded-md border bg-panel transition-[opacity,box-shadow,border-color] duration-150 ${
                    active ? 'border-accent' : 'border-line-strong'
                  } ${b.highlighted ? 'ring-1 ring-accent' : ''} ${
                    faded ? 'opacity-25' : ''
                  } ${
                    isDragged
                      ? 'z-10 shadow-[0_8px_24px_-6px_rgba(15,40,70,0.35)]'
                      : 'shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                  }`}
                >
                  <Link
                    href={`/tables/${b.view}`}
                    aria-label={`Table ${b.view}, ${plural(b.columns.length, 'column', 'columns')}`}
                    aria-current={b.highlighted ? 'true' : undefined}
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    onPointerDown={(e) => onPointerDown(e, b.view)}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(e) => onKeyDown(e, b.view)}
                    onClick={(e) => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        e.preventDefault();
                      }
                    }}
                    style={{ height: DESIGNER_HEADER_HEIGHT }}
                    className={`flex touch-none items-center gap-1.5 border-b border-line-strong px-2 font-mono text-xs font-semibold text-accent-ink select-none hover:text-accent-ink-hover ${
                      isDragged ? 'cursor-grabbing' : 'cursor-grab'
                    } ${b.highlighted ? 'bg-selected' : 'bg-box-head'}`}
                  >
                    <Table size={14} aria-hidden className="shrink-0" />
                    <span className="truncate">{b.view}</span>
                  </Link>
                  <ul className="m-0 list-none py-1 pl-0">
                    {b.columns.map((c) => {
                      const lit = hotRows.has(`${b.view}.${c.name}`);
                      return (
                        <li
                          key={c.name}
                          onMouseEnter={() =>
                            setHover(rowHover(layout.edges, b.view, c.name))
                          }
                          onMouseLeave={() => {
                            if (!drag.current) setHover({ view: b.view });
                          }}
                          style={{ height: DESIGNER_ROW_HEIGHT }}
                          className={`flex items-center gap-[5px] px-2 font-mono text-[11px] ${
                            lit
                              ? 'bg-selected font-semibold text-accent-ink'
                              : c.key || c.label
                                ? 'text-fg'
                                : 'text-faint'
                          }`}
                        >
                          <span className="flex w-[11px] shrink-0 justify-center">
                            {c.key && (
                              <Key
                                size={10}
                                weight="fill"
                                aria-hidden
                                className="text-key"
                              />
                            )}
                          </span>
                          <span className="truncate">{c.name}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
