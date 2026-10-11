'use client';

import { Key, Table } from '@phosphor-icons/react';
import type { PublicView } from '@studies/db/constants';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  buildDesignerLayout,
  DESIGNER_BOX_WIDTH,
  DESIGNER_HEADER_HEIGHT,
  DESIGNER_ROW_HEIGHT,
  type DesignerHighlight,
} from '@/lib/designer-layout';
import { pluralPl } from '@/lib/format';

/**
 * phpMyAdmin "Projektant" (design lines 310-328): fixed table boxes with
 * their live columns and bezier edges between related column rows. Hovering
 * (or focusing) a box highlights it and its edges; a box links to
 * /tables/<view>. `highlight` marks the current selection in the accent
 * colour and shows its caption above the diagram.
 */
export function DesignerDiagram({
  columns,
  highlight,
}: {
  columns: Partial<Record<PublicView, string[]>>;
  highlight?: DesignerHighlight;
}) {
  const layout = useMemo(
    () => buildDesignerLayout(columns, highlight),
    [columns, highlight],
  );
  const [hover, setHover] = useState<PublicView | null>(null);
  const isOn = (e: {
    from: PublicView;
    to: PublicView;
    highlighted: boolean;
  }) =>
    e.highlighted || (hover !== null && (e.from === hover || e.to === hover));
  // Active edges last so they are drawn on top.
  const edges = [...layout.edges].sort(
    (a, b) => Number(isOn(a)) - Number(isOn(b)),
  );
  const caption = highlight?.caption;

  return (
    <div className="flex flex-col gap-3">
      {caption && (
        <p className="inline-flex items-center gap-2 self-start rounded-full border border-accent bg-selected px-3 py-1 font-mono text-xs text-fg">
          <Key size={12} weight="fill" aria-hidden className="text-key" />
          {caption}
        </p>
      )}
      <section
        aria-label="Schemat bazy danych"
        className="shrink-0 overflow-auto rounded-md border border-line-strong bg-bar"
        style={{
          backgroundImage:
            'radial-gradient(var(--border-strong) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        <div
          className="relative"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            className="absolute inset-0"
            aria-hidden
          >
            {edges.map((e) => {
              const on = isOn(e);
              return (
                <path
                  key={e.id}
                  d={e.d}
                  fill="none"
                  stroke={on ? 'var(--accent)' : 'var(--edge)'}
                  strokeWidth={on ? 2 : 1.25}
                />
              );
            })}
          </svg>
          {layout.boxes.map((b) => {
            const active = b.highlighted || hover === b.view;
            return (
              <Link
                key={b.view}
                href={`/tables/${b.view}`}
                aria-label={`Tabela ${b.view}, ${b.columns.length} ${pluralPl(b.columns.length, 'kolumna', 'kolumny', 'kolumn')}`}
                aria-current={b.highlighted ? 'true' : undefined}
                onMouseEnter={() => setHover(b.view)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(b.view)}
                onBlur={() => setHover(null)}
                style={{ left: b.x, top: b.y, width: DESIGNER_BOX_WIDTH }}
                className={`absolute overflow-hidden rounded-md border bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.06)] ${
                  active ? 'border-accent' : 'border-line-strong'
                } ${b.highlighted ? 'ring-1 ring-accent' : ''}`}
              >
                <span
                  style={{ height: DESIGNER_HEADER_HEIGHT }}
                  className={`flex items-center gap-1.5 border-b border-line-strong px-2 font-mono text-xs font-semibold text-accent-ink ${
                    b.highlighted ? 'bg-selected' : 'bg-box-head'
                  }`}
                >
                  <Table size={14} aria-hidden className="shrink-0" />
                  <span className="truncate">{b.view}</span>
                </span>
                <span className="block py-1">
                  {b.columns.map((c) => (
                    <span
                      key={c.name}
                      style={{ height: DESIGNER_ROW_HEIGHT }}
                      className={`flex items-center gap-[5px] px-2 font-mono text-[11px] ${
                        c.key ? 'text-fg' : 'text-faint'
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
                    </span>
                  ))}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
