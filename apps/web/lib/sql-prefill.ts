export type ExplorerSqlSelection = {
  className?: string;
  groupName?: string;
  /** Topics without a class ("Bez kategorii"). Takes precedence over className. */
  noClass?: boolean;
  topicId?: number;
};

/** MariaDB string literal (quotes doubled, backslashes escaped). */
export const lit = (v: string) =>
  `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

/** Read-only SELECT over v_files matching the explorer selection (shown in /sql, never auto-run). */
function selectionWhere(code: string, sel: ExplorerSqlSelection): string[] {
  const where = [`subject_code = ${lit(code)}`];
  if (sel.noClass) where.push('class_name IS NULL');
  else if (sel.className) where.push(`class_name = ${lit(sel.className)}`);
  if (!sel.noClass && sel.className && sel.groupName) {
    where.push(`group_name = ${lit(sel.groupName)}`);
  }
  if (sel.topicId != null && Number.isInteger(sel.topicId)) {
    where.push(`topic_id = ${sel.topicId}`);
  }
  return where;
}

export function buildExplorerSql(
  code: string,
  sel: ExplorerSqlSelection,
): string {
  const where = selectionWhere(code, sel);
  return `SELECT filename, topic_title, class_name, group_name, created_at FROM v_files WHERE ${where.join(' AND ')} ORDER BY created_at DESC`;
}

/** Columns of the subject Pliki grid, in order. */
export const SUBJECT_FILE_COLUMNS = [
  'material_id',
  'topic_title',
  'filename',
  'preview_kind',
  'uploader',
  'created_at',
] as const;

const SORT_COLUMN = {
  topic: 'topic_title',
  filename: 'filename',
  created: 'created_at',
  uploader: 'uploader',
} as const;

export type ExplorerGridQuery = {
  tagId?: number | null;
  q?: string;
  sort?: keyof typeof SORT_COLUMN | null;
  dir?: 'asc' | 'desc' | null;
  page: number;
  perPage: number;
};

/**
 * The query the subject Pliki grid shows: same selection as buildExplorerSql
 * plus tag, filename filter, sort and the page's LIMIT, over the grid columns.
 * It reproduces the grid when run in the SQL console.
 */
export function buildExplorerGridSql(
  code: string,
  sel: ExplorerSqlSelection,
  g: ExplorerGridQuery,
): string {
  const where = selectionWhere(code, sel);
  if (g.tagId != null && Number.isInteger(g.tagId)) {
    where.push(
      `topic_id IN (SELECT topic_id FROM v_topic_tags WHERE tag_id = ${g.tagId})`,
    );
  }
  const q = g.q?.trim();
  if (q) {
    where.push(
      `filename LIKE ${lit(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`,
    );
  }
  const col = g.sort ? SORT_COLUMN[g.sort] : 'created_at';
  const dir = (g.dir ?? (g.sort ? 'asc' : 'desc')).toUpperCase();
  const offset = (Math.max(1, g.page) - 1) * g.perPage;
  return [
    `SELECT ${SUBJECT_FILE_COLUMNS.join(', ')}`,
    'FROM v_files',
    `WHERE ${where.join('\n  AND ')}`,
    `ORDER BY ${col} ${dir}, material_id ${dir}`,
    `LIMIT ${offset}, ${g.perPage}`,
  ].join('\n');
}
