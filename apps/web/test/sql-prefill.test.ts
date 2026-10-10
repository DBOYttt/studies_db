import { describe, expect, it } from 'vitest';
import { buildExplorerSql } from '../lib/sql-prefill';

const HEAD =
  'SELECT filename, topic_title, class_name, group_name, created_at FROM v_files';

describe('buildExplorerSql', () => {
  it('minimal selection filters by subject only', () => {
    expect(buildExplorerSql('MECH', {})).toBe(
      `${HEAD} WHERE subject_code = 'MECH' ORDER BY created_at DESC`,
    );
  });
  it('full selection', () => {
    expect(
      buildExplorerSql('MECH', {
        className: 'Laboratorium',
        groupName: 'Gr. 3',
        topicId: 12,
      }),
    ).toBe(
      `${HEAD} WHERE subject_code = 'MECH' AND class_name = 'Laboratorium' AND group_name = 'Gr. 3' AND topic_id = 12 ORDER BY created_at DESC`,
    );
  });
  it('class and group only', () => {
    expect(
      buildExplorerSql('MECH', {
        className: 'Laboratorium',
        groupName: 'Gr. 3',
      }),
    ).toBe(
      `${HEAD} WHERE subject_code = 'MECH' AND class_name = 'Laboratorium' AND group_name = 'Gr. 3' ORDER BY created_at DESC`,
    );
  });
  it('doubles single quotes and escapes backslashes', () => {
    const sql = buildExplorerSql("O'Brien", {
      className: "a'b",
      groupName: 'x\\',
    });
    expect(sql).toContain("subject_code = 'O''Brien'");
    expect(sql).toContain("class_name = 'a''b'");
    expect(sql).toContain("group_name = 'x\\\\'");
  });
  it('uncategorized class selects NULL class_name', () => {
    expect(buildExplorerSql('M', { noClass: true })).toBe(
      `${HEAD} WHERE subject_code = 'M' AND class_name IS NULL ORDER BY created_at DESC`,
    );
  });
  it('ignores a non-integer topic id', () => {
    expect(buildExplorerSql('M', { topicId: Number.NaN })).not.toContain(
      'topic_id',
    );
  });
});
