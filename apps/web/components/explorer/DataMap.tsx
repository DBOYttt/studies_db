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
import {
  BookOpenText,
  DotsThree,
  FileText,
  type Icon,
  Stack,
  TreeStructure,
  UsersThree,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { memo, useMemo } from 'react';
import type { ExplorerParams } from '@/lib/explorer';
import { pluralPl } from '@/lib/format';
import {
  buildDataMapGraph,
  MAP_NODE_HEIGHT,
  MAP_NODE_WIDTH,
  type MapNodeKind,
} from '@/lib/graph-layout';
import type { TreeClass } from '@/lib/queries';

type MapData = {
  label: string;
  count: number;
  kind: MapNodeKind;
  href: string;
  selected: boolean;
};
type FlowNode = Node<MapData, 'map'>;

const ICONS: Record<MapNodeKind, Icon> = {
  subject: BookOpenText,
  class: Stack,
  group: UsersThree,
  topic: FileText,
  more: DotsThree,
};

const MapNodeView = memo(function MapNodeView({ data }: NodeProps<FlowNode>) {
  const IconC = ICONS[data.kind];
  const files = `${data.count} ${pluralPl(data.count, 'plik', 'pliki', 'plików')}`;
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
        aria-label={`${data.label}, ${files}`}
        aria-current={
          data.selected && data.kind !== 'subject' ? 'true' : undefined
        }
        style={{ width: MAP_NODE_WIDTH, height: MAP_NODE_HEIGHT }}
        className={`flex items-center gap-2 rounded-lg border px-2.5 text-left text-xs transition-colors ${
          data.kind === 'subject'
            ? 'border-accent-ink bg-accent-ink font-medium text-on-accent'
            : data.selected
              ? 'border-accent bg-accent/10 text-fg'
              : data.kind === 'more'
                ? 'border-dashed border-line bg-panel text-muted hover:border-accent'
                : 'border-line bg-panel text-fg hover:border-accent'
        }`}
      >
        <IconC
          size={16}
          weight="regular"
          aria-hidden="true"
          className={`shrink-0 ${
            data.kind === 'subject'
              ? ''
              : data.selected
                ? 'text-accent-ink'
                : 'text-muted'
          }`}
        />
        <span className="min-w-0 flex-1 truncate" title={data.label}>
          {data.label}
        </span>
        {data.kind !== 'more' && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
              data.kind === 'subject'
                ? 'bg-on-accent text-accent-ink'
                : 'bg-surface text-muted'
            }`}
          >
            {data.count}
          </span>
        )}
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

const nodeTypes = { map: MapNodeView };

export function DataMap({
  subject,
  tree,
  sel,
}: {
  subject: { code: string; name: string };
  tree: TreeClass[];
  sel: ExplorerParams;
}) {
  const { nodes, edges } = useMemo(() => {
    const g = buildDataMapGraph(subject, tree, sel);
    const nodes: FlowNode[] = g.nodes.map((n) => ({
      id: n.id,
      type: 'map',
      position: n.position,
      draggable: false,
      connectable: false,
      selectable: false,
      data: {
        label: n.label,
        count: n.count,
        kind: n.kind,
        href: n.href,
        selected: n.selected,
      },
    }));
    const edges: Edge[] = g.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      focusable: false,
      style: {
        stroke: e.selected ? 'var(--accent)' : 'var(--border)',
        strokeWidth: e.selected ? 2 : 1.5,
      },
    }));
    return { nodes, edges };
  }, [subject, tree, sel]);

  const router = useRouter();
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-panel px-6 py-12 text-center">
        <TreeStructure size={28} aria-hidden="true" className="text-muted" />
        <p className="font-medium">
          Brak tematów. Oznacz posty na forum tagami klasy i grupy.
        </p>
      </div>
    );
  }

  return (
    <section
      className="data-map h-[70vh] min-h-[420px] overflow-hidden rounded-xl border border-line bg-panel"
      aria-label="Mapa danych przedmiotu"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        // Having a click handler also keeps the nodes interactive
        // (React Flow disables pointer events on non-selectable, non-clickable nodes).
        onNodeClick={(_, node) => router.push(node.data.href)}
        nodesFocusable={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        selectionOnDrag={false}
        fitView
        fitViewOptions={{ padding: 0.15, duration: reduce ? 0 : 200 }}
        minZoom={0.2}
        maxZoom={1.5}
      >
        <Background gap={20} color="var(--border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
