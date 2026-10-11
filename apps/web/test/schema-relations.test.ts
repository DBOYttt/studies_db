import { type Db, PUBLIC_VIEWS } from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchemaGraph } from '../lib/graph-layout';
import { SCHEMA_RELATIONS, selectionPath } from '../lib/schema-relations';

const { RO_POOL_OPTIONS } = await import('../lib/db');
const { listViewColumns } = await import('../lib/tables');

let db: Db;
let pool: mysql.Pool;
let columns: Awaited<ReturnType<typeof listViewColumns>>;

beforeAll(async () => {
  db = await resetTestDb();
  pool = mysql.createPool({
    ...RO_POOL_OPTIONS,
    uri: testRoUrl(),
    connectionLimit: 2,
  });
  columns = await listViewColumns(pool);
});

afterAll(async () => {
  await pool.end();
  await closeTestDb(db);
});

const base = {
  classKind: null,
  group: null,
  topic: null,
  file: null,
  tab: 'schema',
} as const;

describe('SCHEMA_RELATIONS drift guard', () => {
  it('has 15 relations', () => {
    expect(SCHEMA_RELATIONS).toHaveLength(15);
  });

  it('every endpoint column exists in the live views', () => {
    for (const r of SCHEMA_RELATIONS) {
      expect(columns[r.from.view], `${r.from.view}.${r.from.column}`).toContain(
        r.from.column,
      );
      expect(columns[r.to.view], `${r.to.view}.${r.to.column}`).toContain(
        r.to.column,
      );
    }
  });
});

describe('selectionPath', () => {
  it('always includes v_subjects', () => {
    expect(selectionPath(base, {}).views).toEqual(['v_subjects']);
  });

  it('subject only', () => {
    expect(selectionPath(base, { subject: 'Mechanika' })).toEqual({
      views: ['v_subjects'],
      caption: 'Mechanika jest w v_subjects',
    });
  });

  it('class', () => {
    expect(
      selectionPath(
        { ...base, classKind: 'laboratorium' },
        { subject: 'Mechanika', className: 'Laboratorium' },
      ),
    ).toEqual({
      views: ['v_subjects', 'v_classes'],
      caption: 'Laboratorium jest w v_classes',
    });
  });

  it('group', () => {
    expect(
      selectionPath(
        { ...base, classKind: 'laboratorium', group: 3 },
        { className: 'Laboratorium', groupName: 'Gr. 3' },
      ),
    ).toEqual({
      views: ['v_subjects', 'v_classes', 'v_class_groups'],
      caption: 'Gr. 3 jest w v_class_groups',
    });
  });

  it('topic', () => {
    const p = selectionPath(
      { ...base, classKind: 'laboratorium', group: 3, topic: 7 },
      { topicTitle: 'Drgania' },
    );
    expect(p.views).toEqual([
      'v_subjects',
      'v_classes',
      'v_class_groups',
      'v_topics',
    ]);
    expect(p.caption).toBe('Temat jest w v_topics');
  });

  it('file', () => {
    const p = selectionPath(
      { ...base, classKind: 'laboratorium', topic: 7, file: 9 },
      { filename: 'a.pdf' },
    );
    expect(p.views).toEqual([
      'v_subjects',
      'v_classes',
      'v_topics',
      'v_materials',
      'v_files',
    ]);
    expect(p.caption).toBe('Plik jest w v_materials i v_files');
  });
});

describe('buildSchemaGraph', () => {
  it('has a node for every public view and an edge per relation', () => {
    const g = buildSchemaGraph(columns, []);
    expect(g.nodes.map((n) => n.id).sort()).toEqual([...PUBLIC_VIEWS].sort());
    expect(g.edges).toHaveLength(SCHEMA_RELATIONS.length);
    expect(g.edges.every((e) => !e.highlighted)).toBe(true);
    expect(g.nodes.every((n) => !n.highlighted)).toBe(true);
  });

  it('node height grows with column count', () => {
    const g = buildSchemaGraph(columns, []);
    const a = g.nodes.find((n) => n.id === 'v_files');
    const b = g.nodes.find((n) => n.id === 'v_tags');
    expect(a?.height).toBeGreaterThan(b?.height ?? Infinity);
    expect(a?.height).toBeGreaterThan(columns.v_files.length * 16);
  });

  it('marks relation columns', () => {
    const g = buildSchemaGraph(columns, []);
    const n = g.nodes.find((x) => x.id === 'v_classes');
    expect(n?.keyColumns).toContain('subject_id');
    expect(n?.keyColumns).toContain('id');
  });

  it('highlights edges whose both ends are highlighted', () => {
    const g = buildSchemaGraph(columns, ['v_subjects', 'v_classes']);
    const hi = g.edges.filter((e) => e.highlighted);
    expect(hi).toHaveLength(1);
    expect(hi[0].source).toBe('v_classes');
    expect(hi[0].target).toBe('v_subjects');
    expect(
      g.nodes
        .filter((n) => n.highlighted)
        .map((n) => n.id)
        .sort(),
    ).toEqual(['v_classes', 'v_subjects']);
  });
});
