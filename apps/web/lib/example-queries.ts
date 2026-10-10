export interface ExampleQuery {
  name: string;
  sql: string;
}

export const EXAMPLE_QUERIES: readonly ExampleQuery[] = [
  {
    name: 'Materiały na przedmiot',
    sql: `SELECT s.code, s.name, COUNT(m.id) AS materialy
FROM v_subjects s
LEFT JOIN v_topics t ON t.subject_id = s.id
LEFT JOIN v_materials m ON m.topic_id = t.id
GROUP BY s.id, s.code, s.name
ORDER BY materialy DESC`,
  },
  {
    name: 'Najaktywniejsi uploaderzy',
    sql: `SELECT u.display_name, COUNT(*) AS liczba_plikow
FROM v_materials m
JOIN v_users u ON u.id = m.uploader_id
GROUP BY u.id, u.display_name
ORDER BY liczba_plikow DESC
LIMIT 10`,
  },
  {
    name: 'Kolokwia z ostatnich 30 dni',
    sql: `SELECT t.id, t.title, t.created_at
FROM v_topics t
JOIN v_topic_tags tt ON tt.topic_id = t.id
JOIN v_tags g ON g.id = tt.tag_id
WHERE g.name = 'Kolokwium'
  AND t.created_at >= NOW() - INTERVAL 30 DAY
ORDER BY t.created_at DESC`,
  },
];
