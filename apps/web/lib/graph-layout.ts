import dagre from '@dagrejs/dagre';
import { PUBLIC_VIEWS, type PublicView } from '@studies/db/constants';
import { type ExplorerParams, explorerHref } from './explorer';
import { pluralPl } from './format';
import type { TreeClass, TreeTopic } from './queries';
import { SCHEMA_RELATIONS } from './schema-relations';

export type MapNodeKind = 'subject' | 'class' | 'group' | 'topic' | 'more';

export type MapNode = {
  id: string;
  label: string;
  count: number;
  kind: MapNodeKind;
  href: string;
  selected: boolean;
  position: { x: number; y: number };
};

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  selected: boolean;
};

export const MAP_NODE_WIDTH = 180;
export const MAP_NODE_HEIGHT = 44;
export const MAX_TOPICS_PER_PARENT = 15;

type Draft = Omit<MapNode, 'position'>;

/** Pure graph builder: subject -> classes -> groups -> topics, dagre LR layout. */
export function buildDataMapGraph(
  subject: { code: string; name: string },
  tree: TreeClass[],
  sel: ExplorerParams,
): { nodes: MapNode[]; edges: MapEdge[] } {
  const drafts: Draft[] = [];
  const edges: MapEdge[] = [];
  const selectedIds = new Set<string>();

  const add = (d: Draft) => {
    drafts.push(d);
    if (d.selected) selectedIds.add(d.id);
  };
  const link = (source: string, target: string) =>
    edges.push({ id: `${source}>${target}`, source, target, selected: false });

  const addTopics = (
    parentId: string,
    moreKey: string,
    topics: TreeTopic[],
    classKind: TreeClass['kind'],
    group: number | null,
    parentSelected: boolean,
  ) => {
    for (const t of topics.slice(0, MAX_TOPICS_PER_PARENT)) {
      add({
        id: `t:${t.id}`,
        label: t.title,
        count: t.fileCount,
        kind: 'topic',
        href: explorerHref(subject.code, {
          classKind,
          ...(group != null ? { group } : {}),
          topic: t.id,
        }),
        selected: parentSelected && sel.topic === t.id,
      });
      link(parentId, `t:${t.id}`);
    }
    const rest = topics.length - MAX_TOPICS_PER_PARENT;
    if (rest > 0) {
      const rows = topics.slice(MAX_TOPICS_PER_PARENT);
      add({
        id: `m:${moreKey}`,
        label: `+ ${rest} ${pluralPl(rest, 'temat', 'tematy', 'tematów')}`,
        count: rows.reduce((n, t) => n + t.fileCount, 0),
        kind: 'more',
        href: explorerHref(subject.code, {
          classKind,
          ...(group != null ? { group } : {}),
        }),
        selected: false,
      });
      link(parentId, `m:${moreKey}`);
    }
  };

  add({
    id: 's',
    label: subject.name,
    count: tree.reduce((n, c) => n + c.fileCount, 0),
    kind: 'subject',
    href: explorerHref(subject.code, {}),
    selected: true,
  });

  for (const c of tree) {
    const cid = `c:${c.kind}`;
    const cSel = sel.classKind === c.kind;
    add({
      id: cid,
      label: c.name,
      count: c.fileCount,
      kind: 'class',
      href: explorerHref(subject.code, { classKind: c.kind }),
      selected: cSel,
    });
    link('s', cid);
    for (const g of c.groups) {
      const gid = `g:${g.id}`;
      const gSel = cSel && sel.group === g.number;
      add({
        id: gid,
        label: g.name,
        count: g.fileCount,
        kind: 'group',
        href: explorerHref(subject.code, {
          classKind: c.kind,
          group: g.number,
        }),
        selected: gSel,
      });
      link(cid, gid);
      addTopics(gid, String(g.id), g.topics, c.kind, g.number, gSel);
    }
    addTopics(cid, c.kind, c.topics, c.kind, null, cSel && sel.group == null);
  }

  for (const e of edges) {
    e.selected = selectedIds.has(e.source) && selectedIds.has(e.target);
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const d of drafts) {
    g.setNode(d.id, { width: MAP_NODE_WIDTH, height: MAP_NODE_HEIGHT });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const nodes = drafts.map((d) => {
    const p = g.node(d.id);
    return {
      ...d,
      position: {
        x: p.x - MAP_NODE_WIDTH / 2,
        y: p.y - MAP_NODE_HEIGHT / 2,
      },
    };
  });
  return { nodes, edges };
}

export type SchemaNode = {
  id: PublicView;
  columns: string[];
  keyColumns: string[];
  highlighted: boolean;
  width: number;
  height: number;
  position: { x: number; y: number };
};

export type SchemaEdge = {
  id: string;
  source: PublicView;
  target: PublicView;
  fromColumn: string;
  toColumn: string;
  highlighted: boolean;
};

export const SCHEMA_NODE_WIDTH = 230;
export const SCHEMA_HEADER_HEIGHT = 36;
export const SCHEMA_ROW_HEIGHT = 20;
const SCHEMA_PAD = 12;

/** Pure graph builder for the schema diagram: one node per view, dagre LR. */
export function buildSchemaGraph(
  columns: Record<PublicView, string[]>,
  highlight: PublicView[],
): { nodes: SchemaNode[]; edges: SchemaEdge[] } {
  const hi = new Set<PublicView>(highlight);
  const keys = new Map<PublicView, Set<string>>();
  const mark = (v: PublicView, c: string) => {
    const s = keys.get(v) ?? new Set<string>();
    s.add(c);
    keys.set(v, s);
  };
  for (const r of SCHEMA_RELATIONS) {
    mark(r.from.view, r.from.column);
    mark(r.to.view, r.to.column);
  }

  const edges: SchemaEdge[] = SCHEMA_RELATIONS.map((r) => ({
    id: `${r.from.view}.${r.from.column}>${r.to.view}.${r.to.column}`,
    source: r.from.view,
    target: r.to.view,
    fromColumn: r.from.column,
    toColumn: r.to.column,
    highlighted: hi.has(r.from.view) && hi.has(r.to.view),
  }));

  const sizes = PUBLIC_VIEWS.map((v) => ({
    id: v,
    height:
      SCHEMA_HEADER_HEIGHT +
      (columns[v]?.length ?? 0) * SCHEMA_ROW_HEIGHT +
      SCHEMA_PAD,
  }));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const s of sizes) {
    g.setNode(s.id, { width: SCHEMA_NODE_WIDTH, height: s.height });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const nodes: SchemaNode[] = sizes.map((s) => {
    const p = g.node(s.id);
    const cols = columns[s.id] ?? [];
    return {
      id: s.id,
      columns: cols,
      keyColumns: cols.filter((c) => keys.get(s.id)?.has(c)),
      highlighted: hi.has(s.id),
      width: SCHEMA_NODE_WIDTH,
      height: s.height,
      position: {
        x: p.x - SCHEMA_NODE_WIDTH / 2,
        y: p.y - s.height / 2,
      },
    };
  });
  return { nodes, edges };
}
