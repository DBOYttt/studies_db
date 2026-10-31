export interface ExampleQuery {
  name: string;
  /** Plain SQL, also offered as an example in the read-only console. */
  sql: string;
  /**
   * The same report for one semester, with a single `?` for the semester
   * (bound by `reportQuery`, never interpolated). Events without a subject
   * stay in, as everywhere else.
   */
  semesterSql: string;
}

/**
 * A one-row derived table with the current Warsaw wall time (`wall_now`) at
 * the UTC instant `utc`. Events are stored as wall time while the server runs
 * in UTC, and the time zone tables CONVERT_TZ needs may not be loaded, so the
 * EU rule is spelled out: UTC + 2 h from the last Sunday of March to the last
 * Sunday of October (01:00 UTC both), UTC + 1 h otherwise. Plain SQL (no
 * parameters), so the example also runs as is in the read-only console.
 */
export function wallNowTable(utc = 'UTC_TIMESTAMP()'): string {
  return `(
  -- Now in Warsaw wall time, the time events are stored in
  SELECT t.u + INTERVAL IF(
      t.u >= TIMESTAMP(t.mar - INTERVAL (DAYOFWEEK(t.mar) - 1) DAY, '01:00')
      AND t.u < TIMESTAMP(t.oct - INTERVAL (DAYOFWEEK(t.oct) - 1) DAY, '01:00'),
      2, 1) HOUR AS wall_now
  FROM (SELECT ${utc} AS u,
    DATE(CONCAT(YEAR(${utc}), '-03-31')) AS mar,
    DATE(CONCAT(YEAR(${utc}), '-10-31')) AS oct) t
)`;
}

export const EXAMPLE_QUERIES: readonly ExampleQuery[] = [
  {
    name: 'Files per subject',
    sql: `SELECT s.code, s.name, COUNT(m.id) AS files
FROM v_subjects s
LEFT JOIN v_topics t ON t.subject_id = s.id
LEFT JOIN v_materials m ON m.topic_id = t.id
GROUP BY s.id, s.code, s.name
ORDER BY files DESC`,
    semesterSql: `SELECT s.code, s.name, COUNT(m.id) AS files
FROM v_subjects s
LEFT JOIN v_topics t ON t.subject_id = s.id
LEFT JOIN v_materials m ON m.topic_id = t.id
WHERE s.semester = ?
GROUP BY s.id, s.code, s.name
ORDER BY files DESC`,
  },
  {
    name: 'Most active uploaders',
    sql: `SELECT u.display_name, COUNT(*) AS files
FROM v_materials m
JOIN v_users u ON u.id = m.uploader_id
GROUP BY u.id, u.display_name
ORDER BY files DESC
LIMIT 10`,
    semesterSql: `SELECT u.display_name, COUNT(*) AS files
FROM v_materials m
JOIN v_users u ON u.id = m.uploader_id
JOIN v_topics t ON t.id = m.topic_id
LEFT JOIN v_subjects s ON s.id = t.subject_id
WHERE (t.subject_id IS NULL OR s.semester = ?)
GROUP BY u.id, u.display_name
ORDER BY files DESC
LIMIT 10`,
  },
  {
    name: 'Tests and exams in the next 30 days',
    sql: `SELECT e.starts_at,
  CASE e.kind WHEN 'kolokwium' THEN 'Test' ELSE 'Exam' END AS type,
  e.subject_code, e.title
FROM v_events e
CROSS JOIN ${wallNowTable()} n
WHERE e.kind IN ('kolokwium', 'egzamin')
  AND e.starts_at >= n.wall_now
  AND e.starts_at < n.wall_now + INTERVAL 30 DAY
ORDER BY e.starts_at, e.id`,
    semesterSql: `SELECT e.starts_at,
  CASE e.kind WHEN 'kolokwium' THEN 'Test' ELSE 'Exam' END AS type,
  e.subject_code, e.title
FROM v_events e
LEFT JOIN v_subjects s ON s.id = e.subject_id
CROSS JOIN ${wallNowTable()} n
WHERE e.kind IN ('kolokwium', 'egzamin')
  AND e.starts_at >= n.wall_now
  AND e.starts_at < n.wall_now + INTERVAL 30 DAY
  AND (e.subject_id IS NULL OR s.semester = ?)
ORDER BY e.starts_at, e.id`,
  },
];

/**
 * A ready-made report as run by the simple Reports page and its CSV: the
 * plain SQL, or with a semester its filtered twin and the bound semester.
 */
export function reportQuery(
  index: number,
  semester: number | null,
): { sql: string; values?: number[] } {
  const q = EXAMPLE_QUERIES[index];
  return semester === null
    ? { sql: q.sql }
    : { sql: q.semesterSql, values: [semester] };
}

/**
 * The SQL text of a report as the console should show it: the plain SQL, or
 * the semester twin with the (validated, 1–7) semester written in, so "View
 * SQL query" opens exactly what the report ran.
 */
export function reportSqlText(index: number, semester: number | null): string {
  const q = EXAMPLE_QUERIES[index];
  if (semester === null) return q.sql;
  return q.semesterSql.replace('?', String(Math.trunc(semester)));
}
