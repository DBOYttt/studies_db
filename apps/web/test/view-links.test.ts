import { describe, expect, it } from 'vitest';
import {
  cellHref,
  classHref,
  type LinkContext,
  lecturerHref,
  tagHref,
  topicHref,
  userHref,
} from '../lib/view-links';

const ctx: LinkContext = {
  subjects: new Map([[2, 'MECH']]),
  classes: new Map([[5, { code: 'MECH', kind: 'cwiczenia' as const }]]),
  groups: new Map([
    [7, { code: 'MECH', kind: 'cwiczenia' as const, number: 3 }],
  ]),
};
const at = (view: string, cols: string[], row: unknown[], name: string) =>
  cellHref(view as never, cols, row, cols.indexOf(name), ctx);

describe('href builders', () => {
  it('build entity paths', () => {
    expect(lecturerHref(1)).toBe('/lecturers/1');
    expect(userHref(1)).toBe('/users/1');
    expect(tagHref(1)).toBe('/tags/1');
    expect(topicHref(1)).toBe('/topics/1');
    expect(classHref(ctx, 5)).toBe('/subjects/MECH?class=cwiczenia');
    expect(classHref(ctx, 99)).toBeNull();
  });
});

describe('cellHref', () => {
  it('v_subjects id, name, code -> subject', () => {
    const cols = ['id', 'name', 'code'];
    const row = [2, 'Mechanika', 'MECH'];
    for (const c of cols) {
      expect(at('v_subjects', cols, row, c)).toBe('/subjects/MECH');
    }
  });
  it('v_class_lecturers', () => {
    const cols = ['class_id', 'lecturer_id', 'group_id'];
    expect(at('v_class_lecturers', cols, [5, 1, 7], 'class_id')).toBe(
      '/subjects/MECH?class=cwiczenia',
    );
    expect(at('v_class_lecturers', cols, [5, 1, 7], 'lecturer_id')).toBe(
      '/lecturers/1',
    );
    expect(at('v_class_lecturers', cols, [5, 1, 7], 'group_id')).toBe(
      '/subjects/MECH?class=cwiczenia&group=3',
    );
    expect(at('v_class_lecturers', cols, [5, 1, null], 'group_id')).toBeNull();
  });
  it('v_topics', () => {
    const cols = ['id', 'title', 'created_by'];
    expect(at('v_topics', cols, [9, 'T', 4], 'created_by')).toBe('/users/4');
    expect(at('v_topics', cols, [9, 'T', 4], 'id')).toBe('/topics/9');
    expect(at('v_topics', cols, [9, 'T', 4], 'title')).toBe('/topics/9');
  });
  it('v_files same-row lookups', () => {
    const cols = [
      'subject_code',
      'class_name',
      'group_name',
      'topic_title',
      'uploader',
      'subject_id',
      'class_id',
      'group_id',
      'uploader_id',
      'topic_id',
    ];
    const row = ['MECH', 'Ćw', 'Gr', 'T', 'Ann', 2, 5, 7, 4, 11];
    expect(at('v_files', cols, row, 'subject_code')).toBe('/subjects/MECH');
    expect(at('v_files', cols, row, 'class_name')).toBe(
      '/subjects/MECH?class=cwiczenia',
    );
    expect(at('v_files', cols, row, 'group_name')).toBe(
      '/subjects/MECH?class=cwiczenia&group=3',
    );
    expect(at('v_files', cols, row, 'uploader')).toBe('/users/4');
    expect(at('v_files', cols, row, 'topic_title')).toBe('/topics/11');
    const bad = [...row];
    bad[6] = 99;
    expect(at('v_files', cols, bad, 'class_name')).toBeNull();
  });
  it('v_files tolerates a column subset', () => {
    expect(at('v_files', ['class_name'], ['Ćw'], 'class_name')).toBeNull();
    expect(at('v_files', ['uploader'], ['Ann'], 'uploader')).toBeNull();
  });
  it('v_tags', () => {
    const cols = ['id', 'subject_id', 'name'];
    expect(at('v_tags', cols, [3, 2, 'K'], 'name')).toBe('/tags/3');
    expect(at('v_tags', cols, [3, 2, 'K'], 'subject_id')).toBe(
      '/subjects/MECH',
    );
  });
  it('v_classes / v_class_groups / v_lecturers / v_users labels', () => {
    expect(at('v_classes', ['id', 'name'], [5, 'Ćw'], 'name')).toBe(
      '/subjects/MECH?class=cwiczenia',
    );
    expect(at('v_class_groups', ['id', 'name'], [7, 'G'], 'id')).toBe(
      '/subjects/MECH?class=cwiczenia&group=3',
    );
    expect(at('v_lecturers', ['id', 'name'], [1, 'J'], 'name')).toBe(
      '/lecturers/1',
    );
    expect(
      at('v_users', ['id', 'display_name'], [4, 'A'], 'display_name'),
    ).toBe('/users/4');
  });
  it('other columns have no link', () => {
    expect(
      at('v_users', ['id', 'created_at'], [4, 'x'], 'created_at'),
    ).toBeNull();
  });
});
