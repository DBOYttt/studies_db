'use client';

import {
  Background,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Key, Table } from '@phosphor-icons/react';
import type { PublicView } from '@studies/db/constants';
import { useRouter } from 'next/navigation';
import { memo, useMemo } from 'react';
import {
  buildSchemaGraph,
  SCHEMA_HEADER_HEIGHT,
  SCHEMA_ROW_HEIGHT,
} from '@/lib/graph-layout';
import type { SchemaRelation } from '@/lib/schema-relations';

type TableData = {
  view: PublicView;
  columns: string[];
  keyColumns: string[];
  highlighted: boolean;
  width: number;
  height: number;
};
type FlowNode = Node<TableData, 'table'>;

const TableNodeView = memo(function TableNodeView({
  data,
}: NodeProps<FlowNode>) {
  const keys = new Set(data.keyColumns);
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent"
      />
      <button
        type="button"
        aria-label={`Tabela ${data.view}, ${data.columns.length} kolumn`}
        aria-current={data.highlighted ? 'true' : undefined}
        style={{ width: data.width, height: data.height }}
        className={`flex flex-col overflow-hidden rounded-lg border text-left transition-colors ${
          data.highlighted
            ? 'border-accent bg-accent/10'
            : 'border-line bg-panel hover:border-accent'
        }`}
      >
        <span
          style={{ height: SCHEMA_HEADER_HEIGHT }}
          className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 font-mono text-xs font-medium text-fg"
        >
          <Table
            size={14}
            aria-hidden="true"
            className={data.highlighted ? 'text-accent-ink' : 'text-muted'}
          />
          {data.view}
        </span>
        <span className="flex flex-col px-2.5 py-1.5">
          {data.columns.map((c) => (
            <span
              key={c}
              style={{ height: SCHEMA_ROW_HEIGHT }}
              className={`flex items-center gap-1.5 font-mono text-[11px] ${
                keys.has(c) ? 'text-fg' : 'text-muted'
              }`}
            >
              {keys.has(c) ? (
                <Key
                  size={11}
                  aria-hidden="true"
                  className="shrink-0 text-accent-ink"
                />
              ) : (
                <span className="w-[11px] shrink-0" />
              )}
              <span className="truncate">{c}</span>
            </span>
          ))}
        </span>
      </button>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent"
      />
    </>
  );
});

const nodeTypes = { table: TableNodeView };

export function SchemaDiagram({
  columns,
  highlight,
  caption,
}: {
  columns: Record<PublicView, string[]>;
  relations: SchemaRelation[];
  highlight: PublicView[];
  caption: string | null;
}) {
  const router = useRouter();
  const { nodes, edges } = useMemo(() => {
    const g = buildSchemaGraph(columns, highlight);
    const nodes: FlowNode[] = g.nodes.map((n) => ({
      id: n.id,
      type: 'table',
      position: n.position,
      draggable: false,
      connectable: false,
      selectable: false,
      data: {
        view: n.id,
        columns: n.columns,
        keyColumns: n.keyColumns,
        highlighted: n.highlighted,
        width: n.width,
        height: n.height,
      },
    }));
    const edges: Edge[] = g.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      focusable: false,
      zIndex: e.highlighted ? 1 : 0,
      style: {
        stroke: e.highlighted ? 'var(--accent)' : 'var(--border)',
        strokeWidth: e.highlighted ? 2.5 : 1.5,
      },
    }));
    return { nodes, edges };
  }, [columns, highlight]);

  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="space-y-2">
      {caption && (
        <p className="inline-flex items-center gap-2 rounded-full border border-accent bg-accent/10 px-3 py-1 font-mono text-xs text-fg">
          <Key size={12} aria-hidden="true" className="text-accent-ink" />
          {caption}
        </p>
      )}
      <section
        className="data-map h-[70vh] min-h-[420px] overflow-hidden rounded-xl border border-line bg-panel"
        aria-label="Schemat bazy danych"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => router.push(`/tables/${node.id}`)}
          nodesFocusable={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          selectionOnDrag={false}
          fitView
          fitViewOptions={{ padding: 0.1, duration: reduce ? 0 : 200 }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background gap={20} color="var(--border)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </section>
    </div>
  );
}
