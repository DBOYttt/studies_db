import { PUBLIC_VIEWS, type PublicView } from '@studies/db/constants';
import { describe, expect, it } from 'vitest';
import {
  buildDesignerLayout,
  clampPosition,
  compactColumns,
  DESIGNER_BOX_WIDTH,
  DESIGNER_DEFAULT_POS,
  type DesignerLayout,
  hoverAfterDrag,
  markerPath,
  parseStoredPositions,
  relationId,
  rowHover,
} from '../lib/designer-layout';
import { SCHEMA_RELATIONS, type SchemaRelation } from '../lib/schema-relations';

// Columns exactly as in the live views (information_schema order).
const columns: Record<PublicView, string[]> = {
  v_subjects: [
    'id',
    'name',
    'code',
    'semester',
    'ects',
    'description',
    'discord_channel_id',
    'created_at',
    'platform_url',
    'unitime_name',
  ],
  v_lecturers: ['id', 'name', 'title', 'email', 'office_hours', 'room'],
  v_classes: [
    'id',
    'subject_id',
    'kind',
    'name',
    'assessment',
    'assessment_note',
    'platform_url',
  ],
  v_class_groups: ['id', 'class_id', 'number', 'name'],
  v_class_lecturers: ['class_id', 'lecturer_id', 'group_id'],
  v_topics: [
    'id',
    'subject_id',
    'class_id',
    'group_id',
    'title',
    'discord_thread_id',
    'created_by',
    'created_at',
  ],
  v_events: [
    'id',
    'kind',
    'title',
    'subject_id',
    'subject_code',
    'subject_name',
    'class_id',
    'group_id',
    'starts_at',
    'ends_at',
    'all_day',
    'place',
    'note',
    'topic_id',
    'created_by',
    'created_at',
  ],
  v_tags: ['id', 'subject_id', 'name', 'discord_tag_id'],
  v_topic_tags: ['topic_id', 'tag_id'],
  v_materials: [
    'id',
    'topic_id',
    'uploader_id',
    'original_filename',
    'mime_type',
    'size_bytes',
    'preview_kind',
    'status',
    'created_at',
  ],
  v_files: [
    'material_id',
    'subject_code',
    'subject_name',
    'class_name',
    'group_name',
    'topic_id',
    'topic_title',
    'filename',
    'mime_type',
    'size_bytes',
    'preview_kind',
    'status',
    'uploader',
    'created_at',
    'subject_id',
    'class_id',
    'group_id',
    'uploader_id',
  ],
  v_users: ['id', 'display_name', 'created_at'],
  v_class_sessions: [
    'id',
    'starts_at',
    'ends_at',
    'subject_id',
    'subject_name',
    'class_id',
    'class_kind',
    'class_name',
    'group_id',
    'group_name',
    'lecturer_id',
    'lecturer_name',
    'room',
    'label',
    'status',
    'kind',
  ],
  v_class_marks: [
    'id',
    'class_id',
    'subject_id',
    'class_kind',
    'class_name',
    'group_id',
    'group_name',
    'kind',
    'note',
    'version',
    'created_by',
    'created_at',
    'updated_at',
  ],
  v_class_mark_skips: ['id', 'mark_id', 'on_date', 'created_by', 'created_at'],
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

const box = (l: DesignerLayout, v: PublicView) => {
  const b = l.boxes.find((x) => x.view === v);
  if (!b) throw new Error(`no box ${v}`);
  return b;
};
const edge = (l: DesignerLayout, id: string) => {
  const e = l.edges.find((x) => x.id === id);
  if (!e) throw new Error(`no edge ${id}`);
  return e;
};
/** Centre y of a visible column row of a box. */
const rowY = (l: DesignerLayout, v: PublicView, c: string) => {
  const b = box(l, v);
  const i = b.columns.findIndex((x) => x.name === c);
  expect(i, `${v}.${c} visible`).toBeGreaterThanOrEqual(0);
  return b.y + 28 + 4 + i * 18 + 9;
};
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const start = (d: string) => nums(d).slice(0, 2);
const end = (d: string) => {
  // Path ends with "H<x>" after a point whose y is the last coordinate pair's y.
  const m = d.match(/(-?[\d.]+),(-?[\d.]+) H(-?[\d.]+)$/);
  if (m) return [Number(m[3]), Number(m[2])];
  return nums(d).slice(-2);
};

/** Straight segments of an H/V/Q path (corners as chords). */
const segments = (d: string) => {
  const out: [number, number, number, number][] = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MHVQ])([^MHVQ]*)/g)) {
    const n = (args.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    let nx = x;
    let ny = y;
    if (cmd === 'M') [nx, ny] = n;
    else if (cmd === 'H') nx = n[0];
    else if (cmd === 'V') ny = n[0];
    else [nx, ny] = n.slice(2);
    if (cmd !== 'M') out.push([x, y, nx, ny]);
    x = nx;
    y = ny;
  }
  return out;
};

const expectNoOverlap = (l: DesignerLayout) => {
  for (const a of l.boxes) {
    for (const b of l.boxes) {
      if (a === b) continue;
      const apart =
        a.x + DESIGNER_BOX_WIDTH <= b.x ||
        b.x + DESIGNER_BOX_WIDTH <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y;
      expect(apart, `${a.view} vs ${b.view}`).toBe(true);
    }
  }
};

describe('compactColumns', () => {
  it('keeps keys and the label column in original order', () => {
    expect(compactColumns('v_topics', columns.v_topics)).toEqual([
      'id',
      'subject_id',
      'class_id',
      'group_id',
      'title',
      'created_by',
    ]);
  });

  it('v_subjects shows both name and code; discord ids are hidden', () => {
    expect(compactColumns('v_subjects', columns.v_subjects)).toEqual([
      'id',
      'name',
      'code',
    ]);
    expect(compactColumns('v_tags', columns.v_tags)).toEqual([
      'id',
      'subject_id',
      'name',
    ]);
  });

  it('only the first present label column', () => {
    expect(compactColumns('v_files', columns.v_files)).toEqual([
      'material_id',
      'topic_id',
      'filename',
      'subject_id',
      'class_id',
      'group_id',
      'uploader_id',
    ]);
    expect(compactColumns('v_lecturers', columns.v_lecturers)).toEqual([
      'id',
      'name',
    ]);
    expect(compactColumns('v_users', columns.v_users)).toEqual([
      'id',
      'display_name',
    ]);
  });
});

describe('buildDesignerLayout', () => {
  it('default layout: every view at its default position, no overlaps, fits 1160px', () => {
    for (const showAll of [false, true]) {
      const l = buildDesignerLayout(columns, { showAll });
      expect(l.boxes.map((b) => b.view)).toEqual([...PUBLIC_VIEWS]);
      for (const b of l.boxes) {
        expect([b.x, b.y]).toEqual(DESIGNER_DEFAULT_POS[b.view]);
      }
      expectNoOverlap(l);
      expect(l.width).toBe(1160);
      expect(l.height).toBeGreaterThanOrEqual(560);
      expect(l.height).toBe(
        Math.max(560, ...l.boxes.map((b) => b.y + b.height + 20)),
      );
    }
  });

  it('v_class_sessions sits in column 5 below v_files', () => {
    const [fx, fy] = DESIGNER_DEFAULT_POS.v_files;
    const [x, y] = DESIGNER_DEFAULT_POS.v_class_sessions;
    expect(x).toBe(fx);
    const all = buildDesignerLayout(columns, { showAll: true });
    expect(y).toBeGreaterThanOrEqual(fy + box(all, 'v_files').height);
  });

  it('default layout: no edge passes through a box (compact and all columns)', () => {
    for (const showAll of [false, true]) {
      const l = buildDesignerLayout(columns, { showAll });
      for (const e of l.edges) {
        for (const [x1, y1, x2, y2] of segments(e.d)) {
          for (const b of l.boxes) {
            // Strict interior: running along or starting on a side is fine.
            const hit =
              Math.max(x1, x2) > b.x + 1 &&
              Math.min(x1, x2) < b.x + DESIGNER_BOX_WIDTH - 1 &&
              Math.max(y1, y2) > b.y + 1 &&
              Math.min(y1, y2) < b.y + b.height - 1;
            expect(hit, `${e.id} through ${b.view} (showAll ${showAll})`).toBe(
              false,
            );
          }
        }
      }
    }
  });

  it('compact by default; showAll restores every column', () => {
    const compact = buildDesignerLayout(columns, {});
    expect(box(compact, 'v_topics').columns.map((c) => c.name)).toEqual([
      'id',
      'subject_id',
      'class_id',
      'group_id',
      'title',
      'created_by',
    ]);
    const all = buildDesignerLayout(columns, { showAll: true });
    const names = box(all, 'v_topics').columns.map((c) => c.name);
    expect(names).toContain('discord_thread_id');
    expect(names).toEqual(columns.v_topics);
  });

  it('box height: header 28 + padding 8 + 18 per visible row + borders', () => {
    const l = buildDesignerLayout(columns, {});
    expect(box(l, 'v_users').height).toBe(28 + 8 + 2 * 18 + 2);
    const all = buildDesignerLayout(columns, { showAll: true });
    expect(box(all, 'v_users').height).toBe(28 + 8 + 3 * 18 + 2);
  });

  it('marks key and label columns', () => {
    const l = buildDesignerLayout(columns, { showAll: true });
    const topics = box(l, 'v_topics').columns;
    expect(topics.filter((c) => c.key).map((c) => c.name)).toEqual([
      'id',
      'subject_id',
      'class_id',
      'group_id',
      'created_by',
    ]);
    expect(topics.filter((c) => c.label).map((c) => c.name)).toEqual(['title']);
    const subjects = box(l, 'v_subjects').columns;
    expect(subjects.filter((c) => c.label).map((c) => c.name)).toEqual([
      'name',
      'code',
    ]);
  });

  it('one edge per relation with FK/PK row names', () => {
    const l = buildDesignerLayout(columns, {});
    expect(l.edges).toHaveLength(SCHEMA_RELATIONS.length);
    const e = edge(l, 'v_class_lecturers.lecturer_id>v_lecturers.id');
    expect(e.fromRow).toBe('lecturer_id');
    expect(e.toRow).toBe('id');
  });

  it('edge runs from the FK row to the PK row as an orthogonal rounded path', () => {
    const l = buildDesignerLayout(columns, {});
    const e = edge(l, 'v_class_lecturers.lecturer_id>v_lecturers.id');
    const fk = box(l, 'v_class_lecturers');
    const pk = box(l, 'v_lecturers');
    // PK box is left of the FK box: leave the FK left side, enter PK right side.
    expect(start(e.d)).toEqual([
      fk.x,
      rowY(l, 'v_class_lecturers', 'lecturer_id'),
    ]);
    expect(end(e.d)).toEqual([
      pk.x + DESIGNER_BOX_WIDTH,
      rowY(l, 'v_lecturers', 'id'),
    ]);
    // Only horizontal/vertical segments joined by quadratic 6px corners.
    expect(e.d).toMatch(
      /^M[\d.]+,[\d.]+( (H|V)[\d.]+| Q[\d.]+,[\d.]+ [\d.]+,[\d.]+)+$/,
    );
    expect(e.d).toBe(
      `M${fk.x},${fk.y + 59} H${fk.x - 10} Q${fk.x - 16},${fk.y + 59} ${fk.x - 16},${fk.y + 65} V${pk.y + 35} Q${fk.x - 16},${pk.y + 41} ${fk.x - 22},${pk.y + 41} H${pk.x + DESIGNER_BOX_WIDTH}`,
    );
  });

  it('markers: many at the FK end, one at the PK end, facing outwards', () => {
    const l = buildDesignerLayout(columns, {});
    const e = edge(l, 'v_class_lecturers.lecturer_id>v_lecturers.id');
    const fk = box(l, 'v_class_lecturers');
    const pk = box(l, 'v_lecturers');
    expect(e.markers.many).toEqual([
      fk.x,
      rowY(l, 'v_class_lecturers', 'lecturer_id'),
      'left',
    ]);
    expect(e.markers.one).toEqual([
      pk.x + DESIGNER_BOX_WIDTH,
      rowY(l, 'v_lecturers', 'id'),
      'right',
    ]);
  });

  it('horizontally overlapping boxes use both right sides with a 24px detour', () => {
    const l = buildDesignerLayout(columns, {
      positions: { v_classes: [20, 300] },
    });
    const e = edge(l, 'v_classes.subject_id>v_subjects.id');
    const right = 20 + DESIGNER_BOX_WIDTH;
    expect(start(e.d)).toEqual([right, rowY(l, 'v_classes', 'subject_id')]);
    expect(end(e.d)).toEqual([right, rowY(l, 'v_subjects', 'id')]);
    // subjects at (20,20): id row y 61; classes at (20,300): subject_id row y 359.
    expect(e.d).toBe(
      `M${right},359 H${right + 18} Q${right + 24},359 ${right + 24},353 V67 Q${right + 24},61 ${right + 18},61 H${right}`,
    );
    expect(e.markers.many[2]).toBe('right');
    expect(e.markers.one[2]).toBe('right');
  });

  it('positions move only that box and grow the canvas', () => {
    const base = buildDesignerLayout(columns, {});
    const l = buildDesignerLayout(columns, {
      positions: { v_files: [900, 700] },
    });
    for (const b of l.boxes) {
      if (b.view === 'v_files') expect([b.x, b.y]).toEqual([900, 700]);
      else
        expect([b.x, b.y]).toEqual([box(base, b.view).x, box(base, b.view).y]);
    }
    const files = box(l, 'v_files');
    expect(l.height).toBe(700 + files.height + 20);
    expect(l.width).toBe(1160);
    const far = buildDesignerLayout(columns, {
      positions: { v_files: [1500, 0] },
    });
    expect(far.width).toBe(1500 + DESIGNER_BOX_WIDTH + 20);
  });

  it('dragged positions survive the showAll toggle and edges re-anchor', () => {
    const positions = { v_files: [600, 500] as [number, number] };
    const compact = buildDesignerLayout(columns, { positions });
    const all = buildDesignerLayout(columns, { positions, showAll: true });
    expect([box(compact, 'v_files').x, box(compact, 'v_files').y]).toEqual([
      600, 500,
    ]);
    expect([box(all, 'v_files').x, box(all, 'v_files').y]).toEqual([600, 500]);
    const id = 'v_files.topic_id>v_topics.id';
    expect(start(edge(compact, id).d)[1]).toBe(500 + 28 + 4 + 1 * 18 + 9);
    expect(start(edge(all, id).d)[1]).toBe(500 + 28 + 4 + 5 * 18 + 9);
    expect(edge(all, id).markers.many[1]).toBe(500 + 28 + 4 + 5 * 18 + 9);
  });

  it('drops relations whose column is missing from the live view', () => {
    const l = buildDesignerLayout(
      { ...columns, v_topics: ['id', 'subject_id'] },
      {},
    );
    expect(l.edges.some((e) => e.id === 'v_topics.created_by>v_users.id')).toBe(
      false,
    );
    expect(
      l.edges.some((e) => e.id === 'v_topics.subject_id>v_subjects.id'),
    ).toBe(true);
  });

  it('highlights views and the relations between them by default', () => {
    const l = buildDesignerLayout(columns, {
      highlight: { views: ['v_subjects', 'v_classes'] },
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
      highlight: {
        views: ['v_files', 'v_materials', 'v_subjects'],
        relations: [r],
      },
    });
    expect(l.edges.filter((e) => e.highlighted).map((e) => e.id)).toEqual([
      relationId(r),
    ]);
  });

  it('nothing highlighted without a highlight', () => {
    const l = buildDesignerLayout(columns, {});
    expect(l.boxes.some((b) => b.highlighted)).toBe(false);
    expect(l.edges.some((e) => e.highlighted)).toBe(false);
  });
});

describe('markerPath', () => {
  it("crow's foot: three prongs from 10px out to the box side", () => {
    expect(markerPath([100, 50, 'left'], 'many')).toBe(
      'M90,50 L100,44 M90,50 L100,50 M90,50 L100,56',
    );
    expect(markerPath([100, 50, 'right'], 'many')).toBe(
      'M110,50 L100,44 M110,50 L100,50 M110,50 L100,56',
    );
  });

  it('one: a single bar 7px out from the box side', () => {
    expect(markerPath([100, 50, 'right'], 'one')).toBe('M107,44 V56');
    expect(markerPath([100, 50, 'left'], 'one')).toBe('M93,44 V56');
  });
});

describe('stored positions', () => {
  it('drops bad entries and rounds', () => {
    expect(
      parseStoredPositions(
        '{"v_files":[10,-5],"nope":[1,1],"v_tags":"x","v_users":[30.4,40]}',
      ),
    ).toEqual({ v_users: [30, 40] });
  });

  it('ignores malformed JSON and non-objects', () => {
    expect(parseStoredPositions('not json')).toEqual({});
    expect(parseStoredPositions(null)).toEqual({});
    expect(parseStoredPositions('[1,2]')).toEqual({});
    expect(parseStoredPositions('null')).toEqual({});
    expect(
      parseStoredPositions('{"v_users":[1,2,3],"v_tags":[1e999,2]}'),
    ).toEqual({});
  });

  it('clampPosition keeps boxes in the positive quadrant', () => {
    expect(clampPosition([-12, 40])).toEqual([0, 40]);
    expect(clampPosition([5, -1])).toEqual([5, 0]);
    expect(clampPosition([7, 9])).toEqual([7, 9]);
    expect(clampPosition([Number.NaN, 9])).toEqual([0, 9]);
    expect(clampPosition([3, Number.POSITIVE_INFINITY])).toEqual([3, 0]);
  });
});

describe('hover helpers', () => {
  const l = buildDesignerLayout(columns);

  it('rowHover: a relation row lights just that row', () => {
    expect(rowHover(l.edges, 'v_files', 'topic_id')).toEqual({
      view: 'v_files',
      row: 'topic_id',
    });
    // PK end of a relation too.
    expect(rowHover(l.edges, 'v_subjects', 'id')).toEqual({
      view: 'v_subjects',
      row: 'id',
    });
  });

  it('rowHover: a row without relations keeps the whole box lit', () => {
    expect(rowHover(l.edges, 'v_subjects', 'name')).toEqual({
      view: 'v_subjects',
    });
  });

  it('hoverAfterDrag: keeps the box lit only for a mouse still over it', () => {
    expect(hoverAfterDrag('v_files', 'mouse', true)).toEqual({
      view: 'v_files',
    });
    expect(hoverAfterDrag('v_files', 'mouse', false)).toBeNull();
    expect(hoverAfterDrag('v_files', 'touch', true)).toBeNull();
    expect(hoverAfterDrag('v_files', 'pen', false)).toBeNull();
  });
});
