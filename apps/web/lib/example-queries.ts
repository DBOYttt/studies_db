export interface ExampleQuery {
  name: string;
  sql: string;
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
  },
  {
    name: 'Most active uploaders',
    sql: `SELECT u.display_name, COUNT(*) AS files
FROM v_materials m
JOIN v_users u ON u.id = m.uploader_id
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
WHERE e.kind IN ('kolokwium', 'egzamin')
  AND e.starts_at >= NOW()
  AND e.starts_at < NOW() + INTERVAL 30 DAY
ORDER BY e.starts_at, e.id`,
  },
];
