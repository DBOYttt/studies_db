import type { Db } from '@studies/db';
import { closeTestDb, resetTestDb, testRoUrl } from '@studies/db/testing';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  it('has 16 relations', () => {
    expect(SCHEMA_RELATIONS).toHaveLength(16);
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
    expect(selectionPath(base, { subject: 'Mechanika', subjectId: 1 })).toEqual(
      {
        views: ['v_subjects'],
        caption: 'Mechanika jest w v_subjects (id 1)',
      },
    );
  });

  it('class', () => {
    expect(
      selectionPath(
        { ...base, classKind: 'laboratorium' },
        {
          subject: 'Mechanika',
          subjectId: 1,
          className: 'Laboratorium',
          classId: 4,
        },
      ),
    ).toEqual({
      views: ['v_subjects', 'v_classes'],
      caption: 'Laboratorium jest w v_classes (id 4)',
    });
  });

  it('group', () => {
    expect(
      selectionPath(
        { ...base, classKind: 'laboratorium', group: 3 },
        {
          className: 'Laboratorium',
          classId: 4,
          groupName: 'Gr. 3',
          groupId: 7,
        },
      ),
    ).toEqual({
      views: ['v_subjects', 'v_classes', 'v_class_groups'],
      caption: 'Gr. 3 jest w v_class_groups (id 7)',
    });
  });

  it('topic', () => {
    const p = selectionPath(
      { ...base, classKind: 'laboratorium', group: 3, topic: 7 },
      { groupName: 'Gr. 3', groupId: 7 },
    );
    expect(p.views).toEqual([
      'v_subjects',
      'v_classes',
      'v_class_groups',
      'v_topics',
    ]);
    expect(p.caption).toBe('Temat jest w v_topics (id 7)');
  });

  it('file', () => {
    const p = selectionPath(
      { ...base, classKind: 'laboratorium', topic: 7, file: 9 },
      {},
    );
    expect(p.views).toEqual([
      'v_subjects',
      'v_classes',
      'v_topics',
      'v_materials',
      'v_files',
    ]);
    expect(p.caption).toBe('Plik jest w v_materials i v_files (id 9)');
  });

  it('omits the id suffix when the id is unknown', () => {
    expect(selectionPath(base, {}).caption).toBe('Przedmiot jest w v_subjects');
  });
});
