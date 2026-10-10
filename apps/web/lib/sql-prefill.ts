export type ExplorerSqlSelection = {
  className?: string;
  groupName?: string;
  /** Topics without a class ("Bez kategorii"). Takes precedence over className. */
  noClass?: boolean;
  topicId?: number;
};

const lit = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

/** Read-only SELECT over v_files matching the explorer selection (shown in /sql, never auto-run). */
export function buildExplorerSql(
  code: string,
  sel: ExplorerSqlSelection,
): string {
  const where = [`subject_code = ${lit(code)}`];
  if (sel.noClass) where.push('class_name IS NULL');
  else if (sel.className) where.push(`class_name = ${lit(sel.className)}`);
  if (!sel.noClass && sel.className && sel.groupName) {
    where.push(`group_name = ${lit(sel.groupName)}`);
  }
  if (sel.topicId != null && Number.isInteger(sel.topicId)) {
    where.push(`topic_id = ${sel.topicId}`);
  }
  return `SELECT filename, topic_title, class_name, group_name, created_at FROM v_files WHERE ${where.join(' AND ')} ORDER BY created_at DESC`;
}
