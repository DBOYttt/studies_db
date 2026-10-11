import { PUBLIC_VIEWS, type PublicView } from '@studies/db/constants';
import { describe, expect, it } from 'vitest';
import {
  buildDesignerLayout,
  DESIGNER_BOX,
  relationId,
} from '../lib/designer-layout';
import { SCHEMA_RELATIONS, type SchemaRelation } from '../lib/schema-relations';

// Columns as in the live views (relation endpoints included).
const columns: Record<PublicView, string[]> = {
  v_subjects: ['id', 'name', 'code', 'semester', 'ects', 'description'],
  v_lecturers: ['id', 'name', 'title', 'email'],
  v_classes: ['id', 'subject_id', 'kind', 'name'],
  v_class_groups: ['id', 'class_id', 'number', 'name'],
  v_class_lecturers: ['class_id', 'lecturer_id', 'group_id'],
  v_topics: ['id', 'subject_id', 'class_id', 'group_id', 'title', 'created_by'],
  v_tags: ['id', 'subject_id', 'name'],
  v_topic_tags: ['topic_id', 'tag_id'],
  v_materials: ['id', 'topic_id', 'uploader_id', 'original_filename'],
  v_files: ['material_id', 'subject_code', 'topic_id', 'filename'],
  v_users: ['id', 'display_name'],
};

const rel = (
  fv: PublicView,
  fc: string,
  tv: PublicView,
  tc: string,
): SchemaRelation => ({
  from: { view: fv, column: fc },
  to: { view: tv, column: tc },
});

describe('buildDesignerLayout', () => {
  it('places every public view at the design position', () => {
    const l = buildDesignerLayout(columns);
    expect(l.boxes.map((b) => b.view)).toEqual([...PUBLIC_VIEWS]);
    for (const b of l.boxes) {
      expect([b.x, b.y]).toEqual(DESIGNER_BOX[b.view]);
    }
    expect(l.width).toBe(1200);
    expect(l.height).toBe(560);
  });

  it('box height: header 28 + padding 8 + 18 per row + borders', () => {
    const l = buildDesignerLayout(columns);
    const users = l.boxes.find((b) => b.view === 'v_users');
    expect(users?.height).toBe(28 + 8 + 2 * 18 + 2);
  });

  it('one edge per relation, design bezier maths', () => {
    const l = buildDesignerLayout(columns);
    expect(l.edges).toHaveLength(SCHEMA_RELATIONS.length);
    // v_classes (740,240) subject_id row 1 -> v_subjects (740,20) id row 0: same x.
    const same = l.edges.find(
      (e) => e.id === 'v_classes.subject_id>v_subjects.id',
    );
    expect(same?.d).toBe('M930,299 C970,299 970,61 930,61');
    // v_materials (260,20) topic_id row 1 -> v_topics (500,20) id row 0: right.
    const right = l.edges.find(
      (e) => e.id === 'v_materials.topic_id>v_topics.id',
    );
    expect(right?.d).toBe('M450,79 C475,79 475,61 500,61');
    // v_files (990,20) topic_id row 2 -> v_topics (500,20): left.
    const left = l.edges.find((e) => e.id === 'v_files.topic_id>v_topics.id');
    expect(left?.d).toBe('M990,97 C840,97 840,61 690,61');
  });

  it('marks id and relation columns as keys', () => {
    const l = buildDesignerLayout(columns);
    const topics = l.boxes.find((b) => b.view === 'v_topics');
    const keys = topics?.columns.filter((c) => c.key).map((c) => c.name);
    expect(keys).toEqual([
      'id',
      'subject_id',
      'class_id',
      'group_id',
      'created_by',
    ]);
  });

  it('drops relations whose column is missing from the live view', () => {
    const l = buildDesignerLayout({
      ...columns,
      v_topics: ['id', 'subject_id'],
    });
    expect(l.edges.some((e) => e.id === 'v_topics.created_by>v_users.id')).toBe(
      false,
    );
    expect(
      l.edges.some((e) => e.id === 'v_topics.subject_id>v_subjects.id'),
    ).toBe(true);
  });

  it('highlights views and the relations between them by default', () => {
    const l = buildDesignerLayout(columns, {
      views: ['v_subjects', 'v_classes'],
    });
    expect(l.boxes.filter((b) => b.highlighted).map((b) => b.view)).toEqual([
      'v_subjects',
      'v_classes',
    ]);
    expect(l.edges.filter((e) => e.highlighted).map((e) => e.id)).toEqual([
      'v_classes.subject_id>v_subjects.id',
    ]);
  });

  it('uses explicit highlight relations when given', () => {
    const r = rel('v_files', 'material_id', 'v_materials', 'id');
    const l = buildDesignerLayout(columns, {
      views: ['v_files', 'v_materials', 'v_subjects'],
      relations: [r],
    });
    expect(l.edges.filter((e) => e.highlighted).map((e) => e.id)).toEqual([
      relationId(r),
    ]);
  });

  it('nothing highlighted without a highlight', () => {
    const l = buildDesignerLayout(columns);
    expect(l.boxes.some((b) => b.highlighted)).toBe(false);
    expect(l.edges.some((e) => e.highlighted)).toBe(false);
  });

  it('grows the canvas for tall boxes', () => {
    const many = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const l = buildDesignerLayout({
      ...columns,
      v_files: ['material_id', ...many],
    });
    const files = l.boxes.find((b) => b.view === 'v_files');
    expect(l.height).toBe((files?.y ?? 0) + (files?.height ?? 0) + 20);
  });
  it('stacks views without a design position in rows by box height', () => {
    const many = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const cols = { ...columns, v_subjects: ['id', ...many] };
    // Only v_users keeps a fixed position; the other 10 views are placed.
    const l = buildDesignerLayout(cols, undefined, SCHEMA_RELATIONS, {
      v_users: [20, 20],
    });
    const users = l.boxes.find((b) => b.view === 'v_users');
    const placed = l.boxes.filter((b) => b.view !== 'v_users');
    const rows = [...new Set(placed.map((b) => b.y))].sort((a, b) => a - b);
    expect(rows).toHaveLength(3); // 4 + 4 + 2 per row
    expect(rows[0]).toBe((users?.y ?? 0) + (users?.height ?? 0) + 40);
    const first = placed.filter((b) => b.y === rows[0]);
    expect(rows[1]).toBe(
      rows[0] + Math.max(...first.map((b) => b.height)) + 40,
    );
    // No two boxes overlap.
    for (const a of l.boxes) {
      for (const b of l.boxes) {
        if (a === b) continue;
        const apart =
          a.x + 190 <= b.x ||
          b.x + 190 <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart, `${a.view} vs ${b.view}`).toBe(true);
      }
    }
    expect(l.height).toBeGreaterThanOrEqual(
      Math.max(...l.boxes.map((b) => b.y + b.height)),
    );
  });
});
