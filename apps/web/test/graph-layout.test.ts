import { describe, expect, it } from 'vitest';
import { buildDataMapGraph } from '../lib/graph-layout';
import type { TreeClass, TreeTopic } from '../lib/queries';

const subject = { code: 'MECH', name: 'Mechanika' };
const noSel = {
  classKind: null,
  group: null,
  topic: null,
  file: null,
  tab: 'map',
} as const;

const topic = (id: number, fileCount = 1): TreeTopic => ({
  id,
  title: `Temat ${id}`,
  fileCount,
});

const cls = (over: Partial<TreeClass>): TreeClass => ({
  id: 1,
  kind: 'cwiczenia',
  name: 'Ćwiczenia',
  fileCount: 0,
  lecturers: [],
  groups: [],
  topics: [],
  ...over,
});

const tree = (): TreeClass[] => [
  cls({
    kind: 'cwiczenia',
    fileCount: 5,
    groups: [
      {
        id: 10,
        number: 1,
        name: 'Grupa 1',
        fileCount: 3,
        topics: [topic(100, 2), topic(101, 1)],
      },
      {
        id: 11,
        number: 2,
        name: 'Grupa 2',
        fileCount: 2,
        topics: [topic(102, 2)],
      },
    ],
  }),
  cls({
    id: null,
    kind: 'none',
    name: 'Uncategorized',
    fileCount: 1,
    topics: [topic(200, 1)],
  }),
];

describe('buildDataMapGraph', () => {
  it('builds nodes and edges for the tree', () => {
    const g = buildDataMapGraph(subject, tree(), noSel);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      [
        's',
        'c:cwiczenia',
        'c:none',
        'g:10',
        'g:11',
        't:100',
        't:101',
        't:102',
        't:200',
      ].sort(),
    );
    expect(g.edges).toHaveLength(g.nodes.length - 1);
    expect(g.nodes.find((n) => n.id === 'g:10')?.count).toBe(3);
    expect(g.nodes.find((n) => n.id === 's')?.count).toBe(6);
  });

  it('links nodes to explorer hrefs', () => {
    const g = buildDataMapGraph(subject, tree(), noSel);
    const href = (id: string) => g.nodes.find((n) => n.id === id)?.href;
    expect(href('s')).toBe('/subjects/MECH');
    expect(href('c:cwiczenia')).toBe('/subjects/MECH?class=cwiczenia');
    expect(href('g:10')).toBe('/subjects/MECH?class=cwiczenia&group=1');
    expect(href('t:100')).toBe(
      '/subjects/MECH?class=cwiczenia&group=1&topic=100',
    );
    expect(href('t:200')).toBe('/subjects/MECH?class=none&topic=200');
  });

  it('marks the selection path', () => {
    const g = buildDataMapGraph(subject, tree(), {
      ...noSel,
      classKind: 'cwiczenia',
      group: 1,
      topic: 101,
    });
    const sel = g.nodes
      .filter((n) => n.selected)
      .map((n) => n.id)
      .sort();
    expect(sel).toEqual(['c:cwiczenia', 'g:10', 's', 't:101']);
    const selEdges = g.edges
      .filter((e) => e.selected)
      .map((e) => e.id)
      .sort();
    expect(selEdges).toHaveLength(3);
    expect(g.edges.find((e) => e.target === 't:100')?.selected).toBe(false);
  });

  it('only the subject is selected with no selection', () => {
    const g = buildDataMapGraph(subject, tree(), noSel);
    expect(g.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(['s']);
  });

  it('collapses groups with more than 15 topics into a more node', () => {
    const many = Array.from({ length: 18 }, (_, i) => topic(300 + i));
    const t = [
      cls({
        fileCount: 18,
        groups: [
          { id: 20, number: 3, name: 'Grupa 3', fileCount: 18, topics: many },
        ],
      }),
    ];
    const g = buildDataMapGraph(subject, t, noSel);
    expect(g.nodes.filter((n) => n.kind === 'topic')).toHaveLength(15);
    const more = g.nodes.find((n) => n.kind === 'more');
    expect(more?.id).toBe('m:20');
    expect(more?.label).toBe('+ 3 topics');
    expect(more?.href).toBe('/subjects/MECH?class=cwiczenia&group=3');
    expect(
      g.edges.some((e) => e.source === 'g:20' && e.target === 'm:20'),
    ).toBe(true);
  });

  it('collapses class-level topics and exactly 15 stay whole', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => topic(400 + i));
    const g15 = buildDataMapGraph(
      subject,
      [cls({ id: null, kind: 'none', topics: fifteen })],
      noSel,
    );
    expect(g15.nodes.some((n) => n.kind === 'more')).toBe(false);
    const g20 = buildDataMapGraph(
      subject,
      [
        cls({
          id: null,
          kind: 'none',
          topics: [
            ...fifteen,
            ...Array.from({ length: 5 }, (_, i) => topic(500 + i)),
          ],
        }),
      ],
      noSel,
    );
    const more = g20.nodes.find((n) => n.kind === 'more');
    expect(more?.id).toBe('m:none');
    expect(more?.label).toBe('+ 5 topics');
    expect(more?.href).toBe('/subjects/MECH?class=none');
  });

  it('gives finite, distinct positions', () => {
    const g = buildDataMapGraph(subject, tree(), noSel);
    const keys = new Set<string>();
    for (const n of g.nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
      keys.add(`${n.position.x},${n.position.y}`);
    }
    expect(keys.size).toBe(g.nodes.length);
    const x = (id: string) =>
      g.nodes.find((n) => n.id === id)?.position.x ?? Number.NaN;
    expect(x('s')).toBeLessThan(x('c:cwiczenia'));
    expect(x('c:cwiczenia')).toBeLessThan(x('g:10'));
  });

  it('handles an empty tree', () => {
    const g = buildDataMapGraph(subject, [], noSel);
    expect(g.nodes.map((n) => n.id)).toEqual(['s']);
    expect(g.edges).toEqual([]);
  });
});
